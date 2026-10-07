#!/usr/bin/env node
/**
 * Sophira deployment-readiness verifier (2026-10-05).
 *
 * Usage:
 *   node scripts/verify-deployment.mjs <URL>          — check a live deployment
 *   node scripts/verify-deployment.mjs                 — URL from $SOPHIRA_APP_URL
 *   node scripts/verify-deployment.mjs --env-only      — OFFLINE: validate this
 *                                                       machine's environment
 *                                                       against the manifest
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


// ---- live check ---------------------------------------------------------
// ---- offline environment validation (--env-only) ----------------------
// Validates process.env (plus .env.local when present, PRESENCE ONLY -
// values are never printed) against the authoritative manifest
// src/config/env.manifest.json. Mirrors src/lib/env.ts checkEnv()
// (unit-tested in tests/run.ts via tests/env-manifest.ts - keep in sync).
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "src/config/env.manifest.json"), "utf8"));

function loadDotEnv() {
  const bag = {};
  for (const [k, v] of Object.entries(process.env)) bag[k] = v;
  const dotEnvPath = join(root, ".env.local");
  if (existsSync(dotEnvPath)) {
    for (const line of readFileSync(dotEnvPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_0-9]+)\s*=\s*(.*)$/);
      if (m && !bag[m[1]]) bag[m[1]] = m[2];
    }
  }
  return bag;
}

function isUrl(v) {
  try { const u = new URL(v); return Boolean(u.hostname); } catch { return false; }
}

function evaluateEnv(env, { production, nativeRelease = false, liveTests = false }) {
  const errors = [];
  const warnings = [];
  const p = (n) => typeof env[n] === "string" && env[n].trim().length > 0;
  for (const def of manifest.variables) {
    const v = (env[def.name] ?? "").trim();
    const set = v.length > 0;
    if (set) {
      if ((def.type === "url" || def.type === "https-url") && !isUrl(v)) errors.push(`${def.name} is set but is not a valid URL`);
      if (def.type === "https-url" && !v.toLowerCase().startsWith("https://") && !(v.toLowerCase().startsWith("http://localhost") && !production)) errors.push(`${def.name} must be an https:// URL (http://localhost is allowed only in development)`);
      if (def.type === "enum" && def.enum && !def.enum.includes(v.toLowerCase())) errors.push(`${def.name} must be one of: ${def.enum.join(", ")}`);
      if (def.type === "number" && Number.isNaN(Number(v))) errors.push(`${def.name} must be a number`);
      if (def.type === "boolean" && !["true", "false"].includes(v.toLowerCase())) errors.push(`${def.name} must be "true" or "false"`);
    } else if (production && def.required === "production" && def.scope !== "ci") {
      errors.push(`${def.name} is REQUIRED in production but not set (see .env.example: ${def.section})`);
    } else if (nativeRelease && def.required === "native-release" && def.scope !== "ci" && !p(def.name)) {
      errors.push(`${def.name} is required for native RELEASE builds`);
    } else if (liveTests && def.required === "live-tests" && !p(def.name)) {
      errors.push(`${def.name} is required when RUN_LIVE_TESTS=true`);
    }
  }
  // AI coherence (free-first): paid OpenAI only when explicitly allowed.
  const provider = (env.AI_PROVIDER || "auto").toLowerCase();
  const gemini = p("GEMINI_API_KEY"), openai = p("OPENAI_API_KEY");
  const paidAllowed = (env.ALLOW_PAID_AI || "false").toLowerCase() === "true";
  const budget = Number(env.MONTHLY_AI_BUDGET_USD || "0");
  if (provider === "gemini" && !gemini) errors.push("AI_PROVIDER=gemini but GEMINI_API_KEY is not set");
  if (provider === "openai" && !openai) errors.push("AI_PROVIDER=openai but OPENAI_API_KEY is not set");
  if (provider === "openai" && !paidAllowed) warnings.push("AI_PROVIDER=openai but ALLOW_PAID_AI is not true: paid requests will NOT be sent (free-first safeguard)");
  if (paidAllowed && !openai) warnings.push("ALLOW_PAID_AI=true but OPENAI_API_KEY is not set: the paid fallback is unusable");
  if (paidAllowed && budget <= 0) warnings.push("ALLOW_PAID_AI=true but MONTHLY_AI_BUDGET_USD is 0: no paid spend is possible");
  if (provider === "auto" && !gemini && !openai) warnings.push("No AI provider key configured (GEMINI_API_KEY preferred, free tier): AI features will honestly report not-configured until one is added");
  if (env.SEARCH_PROVIDER === "custom" && !p("SEARCH_BASE_URL")) errors.push("SEARCH_PROVIDER=custom requires SEARCH_BASE_URL");
  return { ready: errors.length === 0, errors, warnings };
}

// self-test cases for the offline rules
if (process.argv.includes("--self-test")) {
  const t = (name, cond) => { if (!cond) { console.error(`SELF-TEST FAILED: ${name}`); process.exit(1); } };
  t("prod missing supabase -> error", evaluateEnv({}, { production: true }).errors.some((e) => e.startsWith("NEXT_PUBLIC_SUPABASE_URL")));
  t("prod full core -> ready", evaluateEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "s", NEXT_PUBLIC_SITE_URL: "https://app.example.com", GEMINI_API_KEY: "g" }, { production: true }).ready === true);
  t("bad https URL rejected", evaluateEnv({ NEXT_PUBLIC_SITE_URL: "http://plain.example" }, { production: true }).errors.some((e) => e.includes("https")));
  t("enum violation rejected", evaluateEnv({ AI_PROVIDER: "grok" }, {}).errors.some((e) => e.startsWith("AI_PROVIDER")));
  t("gemini without key -> error", evaluateEnv({ AI_PROVIDER: "gemini" }, {}).errors.some((e) => e.includes("GEMINI_API_KEY")));
  t("openai unpaid -> warning not error", (() => { const r = evaluateEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-x" }, {}); return r.ready === true && r.warnings.some((w) => w.includes("free-first")); })());
  t("paid allowed zero budget -> warning", evaluateEnv({ ALLOW_PAID_AI: "true", OPENAI_API_KEY: "sk-x" }, {}).warnings.some((w) => w.includes("budget") || w.includes("MONTHLY_AI_BUDGET_USD")));
  t("custom search without base -> error", evaluateEnv({ SEARCH_PROVIDER: "custom" }, {}).errors.some((e) => e.includes("SEARCH_BASE_URL")));
  t("no AI key -> honest warning", evaluateEnv({}, {}).warnings.some((w) => w.includes("No AI provider key")));
  t("live: fully configured -> ready", evaluateDeploymentReadiness({ ok: true, name: "sophira", configuration: { supabase: true, supabase_service_role: true, ai: true, search: true } }).ready === true);
  t("live: missing ai -> not ready", evaluateDeploymentReadiness({ ok: true, name: "sophira", configuration: { supabase: true, supabase_service_role: true, ai: false } }).ready === false);
  t("live: missing service role -> not ready", evaluateDeploymentReadiness({ ok: true, name: "sophira", configuration: { supabase: true, ai: true } }).ready === false);
  t("live: search optional -> still ready", evaluateDeploymentReadiness({ ok: true, name: "sophira", configuration: { supabase: true, supabase_service_role: true, ai: true, search: false } }).ready === true);
  t("live: wrong service name -> not ready", evaluateDeploymentReadiness({ ok: true, name: "something-else", configuration: { supabase: true, supabase_service_role: true, ai: true } }).ready === false);
  t("live: not ok -> not ready", evaluateDeploymentReadiness({ ok: false, name: "sophira", configuration: { supabase: true, supabase_service_role: true, ai: true } }).ready === false);
  t("live: empty payload -> not ready", evaluateDeploymentReadiness(null).ready === false);
  t("message never contains values", !evaluateEnv({ NEXT_PUBLIC_SITE_URL: "https://very-secret-host.example" }, { production: true }).errors.some((e) => e.includes("very-secret-host")));
  console.log("verify-deployment.mjs self-test passed (7 live + 10 env rules)");
  process.exit(0);
}

if (process.argv.includes("--env-only")) {
  const env = loadDotEnv();
  const production = (env.NODE_ENV ?? process.env.NODE_ENV) === "production" || process.argv.includes("--prod");
  const r = evaluateEnv(env, { production });
  console.log(`Environment validation (${production ? "production" : "development/local"} context, values never printed):`);
  if (r.warnings.length) for (const w of r.warnings) console.log(`  WARN: ${w}`);
  if (r.errors.length) {
    for (const e of r.errors) console.log(`  MISSING/INVALID: ${e}`);
    console.error(`::error::Environment NOT ready: ${r.errors.length} problem(s) listed above. .env.example lists every variable and where to get it.`);
    process.exit(1);
  }
  console.log("Environment readiness: PASS (see warnings above for optional capabilities)");
  process.exit(0);
}

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
