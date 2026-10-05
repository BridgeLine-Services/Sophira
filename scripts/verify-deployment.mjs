#!/usr/bin/env node
/**
 * Sophira deployment-readiness verifier (2026-10-05).
 *
 * Usage:
 *   node scripts/verify-deployment.mjs <URL>          — check a live deployment
 *   node scripts/verify-deployment.mjs                 — URL from $SOPHIRA_APP_URL
 *   node scripts/verify-deployment.mjs --self-test     — verify THIS script's rules
 *
 * Exit codes: 0 ready, 1 not ready / unreachable, 2 usage error.
 *
 * The readiness rules mirror src/lib/deployment.ts (unit-tested in
 * tests/run.ts — keep both in sync). No dependencies: plain Node fetch,
 * so the release workflow can run it before npm ci.
 */
// ---- rules (mirror of src/lib/deployment.ts) --------------------------
function evaluateDeploymentReadiness(health) {
  const h = health ?? {};
  const cfg = h.configuration ?? {};
  const missing = [];
  if (cfg.supabase !== true) missing.push("Supabase (auth + database)");
  if (cfg.supabase_service_role !== true) missing.push("Supabase service-role key (AI/extract/account routes)");
  if (cfg.ai !== true) missing.push("AI provider key");
  if (h.ok !== true) missing.push("the /api/health response did not report ok");
  if (h.name && h.name !== "sophira") missing.push(`unexpected service name "${h.name}" — this is not a Sophira deployment`);
  const optional_missing = [];
  if (cfg.search !== true) optional_missing.push("web-search provider (research degrades gracefully — not blocking)");
  return {
    ready: missing.length === 0,
    missing,
    optional_missing,
    detail: missing.length === 0
      ? `Deployment fully configured${optional_missing.length ? ` (optional: ${optional_missing.join("; ")})` : ""}.`
      : `Deployment NOT ready: ${missing.join("; ")}.`,
  };
}

// ---- self-test ---------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const t = (name, cond) => { if (!cond) { console.error(`SELF-TEST FAILED: ${name}`); process.exit(1); } };
  t("fully configured → ready",
    evaluateDeploymentReadiness({ ok: true, name: "sophira", configuration: { supabase: true, supabase_service_role: true, ai: true, search: true } }).ready === true);
  t("missing ai → not ready",
    evaluateDeploymentReadiness({ ok: true, name: "sophira", configuration: { supabase: true, supabase_service_role: true, ai: false } }).ready === false);
  t("missing service role → not ready",
    evaluateDeploymentReadiness({ ok: true, name: "sophira", configuration: { supabase: true, ai: true } }).ready === false);
  t("search optional → still ready",
    evaluateDeploymentReadiness({ ok: true, name: "sophira", configuration: { supabase: true, supabase_service_role: true, ai: true, search: false } }).ready === true);
  t("wrong service name → not ready",
    evaluateDeploymentReadiness({ ok: true, name: "something-else", configuration: { supabase: true, supabase_service_role: true, ai: true } }).ready === false);
  t("not ok → not ready",
    evaluateDeploymentReadiness({ ok: false, name: "sophira", configuration: { supabase: true, supabase_service_role: true, ai: true } }).ready === false);
  t("empty payload → not ready",
    evaluateDeploymentReadiness(null).ready === false);
  console.log("verify-deployment.mjs self-test passed (7/7)");
  process.exit(0);
}

// ---- live check ---------------------------------------------------------
const url = (process.argv[2] ?? process.env.SOPHIRA_APP_URL ?? "").replace(/\/+$/, "");
if (!url || !/^https?:\/\//.test(url)) {
  console.error("Usage: node scripts/verify-deployment.mjs <URL>   (or set SOPHIRA_APP_URL)");
  process.exit(2);
}
if (url === "https://sophira.example.com") {
  console.error("::error::The placeholder URL must be replaced with the real deployment URL first.");
  process.exit(1);
}

try {
  const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    console.error(`::error::/api/health returned HTTP ${res.status} — the deployment is not healthy. Refusing to release.`);
    process.exit(1);
  }
  const health = await res.json();
  const verdict = evaluateDeploymentReadiness(health);
  console.log(verdict.detail);
  if (verdict.optional_missing.length) console.log(`Optional: ${verdict.optional_missing.join("; ")}`);
  if (!verdict.ready) {
    console.error(`::error::Release blocked — the target deployment is not configured: ${verdict.missing.join("; ")}`);
    process.exit(1);
  }
  console.log("Deployment readiness: PASS");
} catch (err) {
  console.error(`::error::Could not reach ${url}/api/health (${err.message}) — refusing to release against an unreachable deployment.`);
  process.exit(1);
}
