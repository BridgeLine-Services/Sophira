#!/usr/bin/env node
/**
 * Sophira doctor — one-command, plain-English setup checklist (2026-10-07).
 *
 * Usage:
 *   npm run doctor                                   — check this machine's environment
 *   node scripts/doctor.mjs --url https://your-site  — check a LIVE deployment
 *                                                     (URL falls back to NEXT_PUBLIC_SITE_URL)
 *   node scripts/doctor.mjs --env-file <path>        — read a specific .env file
 *   node scripts/doctor.mjs --self-test              — offline contract check
 *
 * Prints ✅ / ⚠️ / ❌ per item; every ⚠️/❌ names the exact next step in
 * simple language. NEVER prints secret values — only presence/absence.
 *
 * Exit codes: 0 = every required item is ✅ (search is optional),
 *             1 = at least one required item is ❌ or could not be confirmed,
 *             2 = usage error.
 */
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- env loading (presence only; values are never printed) -------------
function loadEnv(fileOverride) {
  const bag = {};
  for (const [k, v] of Object.entries(process.env)) bag[k] = v;
  const dotEnvPath = fileOverride ?? join(root, ".env.local");
  if (existsSync(dotEnvPath)) {
    for (const line of readFileSync(dotEnvPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_0-9]+)\s*=\s*(.*)$/);
      if (m && !bag[m[1]]) bag[m[1]] = m[2];
    }
  }
  return bag;
}

const present = (env, ...names) => names.every((n) => typeof env[n] === "string" && env[n].trim().length > 0);
const isUrl = (v) => { try { return Boolean(new URL(v).hostname); } catch { return false; } };

// ---- pure evaluation ----------------------------------------------------
// Mirrors src/lib/ai/provider.ts (AI order: selfhost → gemini free tier →
// openai only when paid use is explicitly allowed) and src/lib/deployment.ts.
// Keep in sync. `live` is null (offline) or { health, setupStatus }.
export function evaluateDoctor(env, live) {
  const items = [];

  // 1. Supabase connected
  {
    let ok = false, detail, next = null;
    if (live) {
      ok = live.health?.configuration?.supabase === true;
      detail = ok ? "the live deployment reports Supabase connected" : "the live deployment reports Supabase NOT configured";
      next = ok ? null : "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (Supabase dashboard → Project Settings → API) in Vercel → Settings → Environment Variables, then redeploy.";
    } else {
      ok = present(env, "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY") && isUrl(env.NEXT_PUBLIC_SUPABASE_URL || "");
      detail = ok ? "Supabase URL + anon key are set" : "Supabase URL and/or anon key are missing";
      next = ok ? null : "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your environment (Supabase dashboard → Project Settings → API).";
    }
    items.push({ name: "Supabase connected", required: true, ok, detail, next });
  }

  // 2. Migrations applied
  {
    let status = "unknown", detail, next;
    if (live) {
      const applied = live.setupStatus?.probe?.migrationsPresent === true || live.setupStatus?.checklist?.migrationsCurrent === true;
      status = applied ? "ok" : "fail";
      detail = applied ? "the database reports the Sophira schema present and current" : "the live database is NOT initialized (the Sophira tables are missing)";
      next = applied ? null : "Open /setup on the deployment and click \"Set Up Sophira\" — the app applies its own migrations (0001-0026). If the button is unavailable, connect the Vercel project to its Supabase project with the official Supabase integration first.";
    } else if (present(env, "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")) {
      status = "unknown"; // the REST probe is a network call, done by main(), not here
      detail = "checking requires a live database probe";
      next = null;
    } else {
      detail = "cannot check without a live URL or a service-role key";
      next = "Run \"npm run doctor -- --url https://your-deployment\" for the live check, or open /setup — it reports migration status honestly.";
    }
    items.push({ name: "Migrations applied", required: true, ok: status === "ok", status, detail, next });
  }

  // 3. Owner account exists
  {
    let status = "unknown", detail, next;
    if (live) {
      const owner = live.setupStatus?.probe?.ownerAccount;
      if (owner === "active") { status = "ok"; detail = "the owner account exists and is active"; }
      else if (owner === "revoked") { status = "fail"; detail = "the owner account is REVOKED"; next = "Open Supabase → Authentication → Users and restore the owner's access, or use the owner recovery procedure (migration 0026)."; }
      else if (owner === "none") { status = "fail"; detail = "no owner account exists yet"; next = "Open /create-owner on the deployment and register — the FIRST account becomes the owner (no invitation needed)."; }
      else { status = "unknown"; detail = "the deployment could not determine owner status (database likely uninitialized)"; next = "Finish \"Set Up Sophira\" on /setup first, then re-run the doctor."; }
    } else if (present(env, "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")) {
      detail = "checking requires a live database probe";
      next = null;
    } else {
      detail = "cannot check without a live URL or a service-role key";
      next = "Run \"npm run doctor -- --url https://your-deployment\", or simply open /create-owner: it honestly reports whether owner creation is available.";
    }
    items.push({ name: "Owner account exists", required: true, ok: status === "ok", status, detail, next });
  }

  // 4. AI provider working (order mirrors src/lib/ai/provider.ts)
  {
    let ok = false, detail, next = null;
    if (live) {
      ok = live.health?.configuration?.ai === true;
      detail = ok ? "the live deployment reports a working AI provider" : "the live deployment reports NO working AI provider";
    } else {
      const selfhost = present(env, "LOCAL_LLM_BASE_URL");
      const gemini = present(env, "GEMINI_API_KEY");
      const openai = present(env, "OPENAI_API_KEY");
      const paidAllowed = env.ALLOW_PAID_AI === "true" || (Number.isFinite(parseFloat(env.MONTHLY_AI_BUDGET_USD || "0")) && parseFloat(env.MONTHLY_AI_BUDGET_USD || "0") > 0);
      if (selfhost) { ok = true; detail = "self-hosted inference server configured (LOCAL_LLM_BASE_URL) — no key needed"; }
      else if (gemini) { ok = true; detail = "Gemini free-tier key configured (GEMINI_API_KEY)"; }
      else if (openai && paidAllowed) { ok = true; detail = "paid OpenAI key configured with paid use explicitly allowed"; }
      else if (openai) { ok = false; detail = "an OPENAI_API_KEY is present but is IGNORED (ALLOW_PAID_AI=false, budget 0 — zero-billing, fail closed)"; }
      else { ok = false; detail = "no AI provider is configured"; }
    }
    if (!ok) next = "Set LOCAL_LLM_BASE_URL (free — your own Ollama/vLLM/LM Studio server, no key) or GEMINI_API_KEY (free tier) in your environment. Paid OpenAI only works if you also set ALLOW_PAID_AI=true.";
    items.push({ name: "AI provider working", required: true, ok, detail, next });
  }

  // 5. Search provider configured (OPTIONAL)
  {
    let ok = false, detail, next = null;
    if (live) {
      ok = live.health?.configuration?.search === true;
      detail = ok ? "web-search provider configured on the deployment" : "no web-search provider configured on the deployment";
    } else {
      ok = present(env, "SEARCH_PROVIDER", "SEARCH_API_KEY");
      detail = ok ? "search provider + key are set" : "search provider and/or key are not set";
    }
    if (!ok) next = "Optional: for live web research set SEARCH_PROVIDER (brave or tavily) and SEARCH_API_KEY. Without it, research reports honestly instead of fabricating sources — nothing else breaks.";
    items.push({ name: "Search provider configured (optional)", required: false, ok, detail, next });
  }

  // 6. Production URL set
  {
    const url = (env.NEXT_PUBLIC_SITE_URL || "").trim();
    const ok = isUrl(url);
    const detail = ok ? `production URL is set (${url})` : "NEXT_PUBLIC_SITE_URL is not set to a valid URL";
    const next = ok ? null : "Set NEXT_PUBLIC_SITE_URL to your deployed address (e.g. https://sophira.vercel.app) — it is used in invitation links.";
    items.push({ name: "Production URL set", required: true, ok, detail, next });
  }

  const failed = items.filter((i) => i.required && i.ok !== true);
  return { items, ready: failed.length === 0, failed };
}

// ---- REST probes (offline mode with a service-role key) -----------------
async function restProbe(env, table, query) {
  const url = `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return { ok: false, status: res.status };
  const rows = await res.json();
  return { ok: true, rows };
}

// ---- self-test ----------------------------------------------------------
function selfTest() {
  const cases = [];
  // empty env → nothing ready
  const r0 = evaluateDoctor({}, null);
  if (r0.ready) throw new Error("self-test: empty environment must not be ready");
  if (r0.items.length !== 6) throw new Error("self-test: exactly six checks expected");
  for (const item of r0.items) {
    if (!item.ok && !item.next) throw new Error(`self-test: failing check "${item.name}" must name a next step`);
  }
  // fully-configured env → ready offline (DB checks unknown → not ready, so assert the split)
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-anon",
    SUPABASE_SERVICE_ROLE_KEY: "service-service",
    GEMINI_API_KEY: "gemini-gemini",
    NEXT_PUBLIC_SITE_URL: "https://sophira.vercel.app",
  };
  const r1 = evaluateDoctor(env, null);
  const okNames = r1.items.filter((i) => i.ok).map((i) => i.name);
  for (const want of ["Supabase connected", "AI provider working", "Production URL set"]) {
    if (!okNames.includes(want)) throw new Error(`self-test: configured env should pass "${want}"`);
  }
  // live mode: full live truth → ready
  const r2 = evaluateDoctor(env, {
    health: { ok: true, name: "sophira", configuration: { supabase: true, supabase_service_role: true, ai: true, search: false } },
    setupStatus: { probe: { migrationsPresent: true, ownerAccount: "active" }, checklist: { migrationsCurrent: true } },
  });
  if (!r2.ready) throw new Error("self-test: fully-configured live deployment must be ready");
  // live mode: uninitialized DB → not ready, migrations + owner named
  const r3 = evaluateDoctor(env, {
    health: { ok: true, name: "sophira", configuration: { supabase: true, ai: true } },
    setupStatus: { probe: { migrationsPresent: false, ownerAccount: "unknown" }, checklist: { migrationsCurrent: false } },
  });
  if (r3.ready) throw new Error("self-test: uninitialized database must not be ready");
  // paid key ignored by default (zero-billing)
  const r4 = evaluateDoctor({ OPENAI_API_KEY: "sk-test", NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x" }, null);
  const aiItem = r4.items.find((i) => i.name === "AI provider working");
  if (aiItem.ok) throw new Error("self-test: paid key without ALLOW_PAID_AI must be IGNORED");
  // value-leak rule: this script must never print values, only names/presence.
  const src = readFileSync(fileURLToPath(import.meta.url), "utf8");
  if (/console\.log\([^)]*env\.[A-Z_]+/.test(src)) throw new Error("self-test: a console statement prints an env VALUE directly");
  if (/console\.log\([^)]*process\.env\.[A-Z_]+/.test(src)) throw new Error("self-test: a console statement prints a process.env VALUE directly");
  console.log("doctor self-test: PASS (six checks, next-step rules, zero-billing, no value printing)");
}

// ---- main ---------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-test")) { selfTest(); return; }
  const urlIdx = args.indexOf("--url");
  const urlArg = urlIdx !== -1 ? args[urlIdx + 1] : null;
  const envIdx = args.indexOf("--env-file");
  const envFile = envIdx !== -1 ? args[envIdx + 1] : null;
  const env = loadEnv(envFile);
  const liveUrl = (urlArg || env.NEXT_PUBLIC_SITE_URL || "").trim();

  let live = null;
  if (isUrl(liveUrl)) {
    const health = await fetch(`${liveUrl.replace(/\/$/, "")}/api/health`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => null);
    const setupStatus = await fetch(`${liveUrl.replace(/\/$/, "")}/api/setup-status`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()).catch(() => null);
    if (health || setupStatus) live = { health, setupStatus };
    else console.log(`⚠️  Could not reach ${liveUrl} — falling back to offline environment checks only.\n`);
  }

  const report = evaluateDoctor(env, live);

  // offline REST probes when we have a service-role key but no live app
  if (!live && present(env, "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")) {
    try {
      const cfg = await restProbe(env, "app_config", "select=key&limit=1");
      const mig = report.items.find((i) => i.name === "Migrations applied");
      if (cfg.ok) { mig.ok = true; mig.status = "ok"; mig.detail = "the database has the Sophira app_config table (schema present)"; mig.next = null; }
      else { mig.status = "fail"; mig.detail = "the database has no Sophira schema (probe could not read app_config)"; mig.next = "Run \"npm run db:migrate\" from this machine, or open /setup on the deployment and click \"Set Up Sophira\"."; }
      const owner = await restProbe(env, "profiles", "select=role&role=eq.owner&limit=1");
      const own = report.items.find((i) => i.name === "Owner account exists");
      if (owner.ok && Array.isArray(owner.rows) && owner.rows.length > 0) { own.ok = true; own.status = "ok"; own.detail = "an owner account exists in the database"; own.next = null; }
      else if (owner.ok) { own.status = "fail"; own.detail = "no owner account exists in the database yet"; own.next = "Open /create-owner and register — the FIRST account becomes the owner (no invitation needed)."; }
      // keep the honest fallback for non-array/failed probes
    } catch { /* probes are optional diagnostics — the items keep their offline answers */ }
    report.failed = report.items.filter((i) => i.required && i.ok !== true);
    report.ready = report.failed.length === 0;
  }

  console.log("Sophira doctor — setup checklist\n");
  for (const item of report.items) {
    const mark = item.ok ? "✅" : (item.required ? "❌" : "⚠️");
    console.log(`${mark} ${item.name}`);
    console.log(`   ${item.detail}`);
    if (!item.ok && item.next) console.log(`   Next step: ${item.next}\n`);
    else console.log("");
  }
  if (report.ready) console.log("All required checks passed. Sophira is ready to use.");
  else console.log("Not ready yet — complete the ❌ items above, then run \"npm run doctor\" again.");
  process.exit(report.ready ? 0 : 1);
}

main().catch((e) => { console.error(e?.message ?? e); process.exit(2); });
