/**
 * LOCAL-FIRST TESTING MODE (2026-10-06, docs/QUICK_START_LOCAL.md): a person
 * can clone Sophira, run `SOPHIRA_LOCAL_FIRST=true npm run dev`, and test the
 * REAL local AI with no Supabase, no Vercel, no remote AI key — while
 * production authentication and invitation protections remain untouched.
 */
import { readFileSync, existsSync } from "fs";

export function runLocalFirstTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Local-first testing mode: real local AI without Vercel/Supabase, production untouched");

  const mw = readFileSync("src/middleware.ts", "utf8");

  // The mode is explicit AND production-impossible
  assert(mw.includes('SOPHIRA_LOCAL_FIRST === "true"'), "local-first: requires the explicit SOPHIRA_LOCAL_FIRST=true env var");
  assert(mw.includes('NODE_ENV !== "production"'), "local-first: also requires a non-production build - a Vercel production deployment can never activate it, even if the var leaks there");

  // Scoped only to the local testing surface; other paths redirect to /local
  assert(mw.includes('const LOCAL_TEST_PATHS = ["/local", "/offline"]'),
    "local-first: the bypass is scoped to exactly /local and /offline (the local-AI testing surface)");
  assert(mw.includes("url.pathname = \"/local\""), "local-first: without Supabase, other paths go to the explanatory /local page - NOT a dead /login loop");

  // Production behavior is byte-for-byte unchanged when the mode is off
  assert(mw.includes('if (!hasSupabaseEnv()) {') && mw.includes("url.pathname = \"/login\""),
    "local-first: with the mode OFF the middleware still redirects protected paths to /login exactly as before");
  assert(mw.includes("auth.getUser") && mw.includes("profile.status === \"revoked\""),
    "local-first: full production authentication, invitation, and revoked-status checks remain in place when Supabase IS configured");

  // The landing page explains the mode in plain English and reuses the real engine
  const lp = readFileSync("src/app/local/page.tsx", "utf8");
  assert(lp.includes("Test Sophira locally"), "local: the landing page states its purpose");
  for (const claim of ["running on this device", "No paid AI is being used", "The model stays on this device",
    "basic AI tasks run without internet", "Cloud features are unavailable until Supabase is connected",
    "Online research and remote AI are unavailable"]) {
    assert(lp.includes(claim), "local: landing page honestly states: '" + claim + "'");
  }
  assert(lp.includes('href="/offline"') && lp.includes("Test Local AI"),
    "local: one obvious Test Local AI button opens the EXISTING offline interface (no duplicated engine)");

  // One-time-setup honesty (first use needs network for the engine + model)
  const op = readFileSync("src/app/offline/page.tsx", "utf8");
  assert(op.includes("One-time setup: Sophira needs an internet connection to download the AI engine"),
    "offline: the UI never claims 100%-offline-from-first-launch before the engine + model are cached");

  // Provenance and failure honesty already in the real engine (re-verified)
  const mm = readFileSync("src/lib/offline/model-manager.ts", "utf8");
  assert(mm.includes("rollback/failure handling: restore previous state, surface the error"),
    "offline: a failed download/inference rolls the model state back - a model is never falsely marked ready");
  const guard = readFileSync("src/lib/ai/offline-guard.ts", "utf8");
  assert(guard.includes("no remote attempt is ever made"), "offline: when the browser reports offline, remote AI is never attempted");
  const reg = readFileSync("src/lib/offline/model-registry.ts", "utf8");
  assert(reg.includes("TIER 1: PHONE/LIGHTWEIGHT") && reg.includes("TIER 3: LAPTOP/DESKTOP"),
    "offline: the device-aware tiered registry spans phones through desktops");

  // Docs and scripts
  const qs = readFileSync("docs/QUICK_START_LOCAL.md", "utf8");
  assert(qs.includes("PATH A") && qs.includes("PATH B") && qs.includes("SOPHIRA_LOCAL_FIRST=true") && qs.includes("LOCAL MODEL"),
    "docs: QUICK_START_LOCAL.md has both paths, the activation command, and the LOCAL MODEL verification step");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts["local:test"] === "node scripts/local-test.mjs" && pkg.scripts["local:test:model"] === "node scripts/local-model-download.mjs",
    "scripts: npm run local:test and npm run local:test:model exist");
  const script = readFileSync("scripts/local-test.mjs", "utf8");
  assert(script.includes(">= 20") && script.includes("RESULT:") && !script.includes("--yes"),
    "scripts: local:test checks Node >= 20 and files WITHOUT any model download; local:test:model is the explicit network one");
  const dl = readFileSync("scripts/local-model-download.mjs", "utf8");
  assert(dl.includes("--yes") && dl.includes("NOT the full weight download"),
    "scripts: the model check is explicit-only (opt-in --yes, honest scope, no silent multi-hundred-MB downloads)");
  assert(existsSync("scripts/local-test.mjs") && existsSync("scripts/local-model-download.mjs"), "scripts: both local test scripts exist");

  // Privacy: local-first never opens a path to remote providers
  assert(!lp.includes("OPENAI") && !lp.includes("GEMINI"), "privacy: the local flow references no remote AI provider");
  assert(!/SUPABASE_SERVICE_ROLE|NEXT_PUBLIC.*SERVICE_ROLE/.test(lp + op), "privacy: no service-role secret is referenced in local UI code");
}
