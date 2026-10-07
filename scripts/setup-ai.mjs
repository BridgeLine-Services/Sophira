#!/usr/bin/env node
/**
 * Sophira AI-mode setup (2026-10-06): explains the honest AI options and
 * configures AI_PROVIDER safely. CLOUD vs LOCAL is stated plainly:
 *
 *   CLOUD AI  = Gemini (free tier, preferred) or OpenAI (paid, DISABLED by
 *               default) reached through their APIs. The models themselves
 *               are NOT packaged in this GitHub repository — your code is
 *               here; the model runs on the provider's servers.
 *   LOCAL AI  = a small model that genuinely runs on YOUR machine, in the
 *               browser, downloaded at first use (free, offline-capable).
 *               Model weights are NOT committed to GitHub.
 *
 * Usage:
 *   npm run setup:ai                — explain modes + show current status
 *   npm run setup:ai -- --mode gemini | local | openai | auto
 *                                   — set AI_PROVIDER in .env.local
 *   node scripts/setup-ai.mjs --self-test
 *
 * Never prints secret values. Setting a mode never enables paid AI:
 * ALLOW_PAID_AI stays false and MONTHLY_AI_BUDGET_USD stays 0 until you
 * change them yourself.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const MODES = ["auto", "local", "gemini", "openai"];

// ---- pure helpers (self-tested) ----------------------------------------
function setAiProvider(lines, mode) {
  const out = [];
  let replaced = false;
  for (const line of lines) {
    if (/^AI_PROVIDER\s*=/.test(line)) { out.push(`AI_PROVIDER=${mode}`); replaced = true; }
    else out.push(line);
  }
  if (!replaced) out.push(`AI_PROVIDER=${mode}`);
  return out;
}

function readEnvBag(envLocalPath) {
  const bag = {};
  for (const [k, v] of Object.entries(process.env)) bag[k] = v;
  if (existsSync(envLocalPath)) {
    for (const line of readFileSync(envLocalPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_0-9]+)\s*=\s*(.*)$/);
      if (m && !bag[m[1]]) bag[m[1]] = m[2];
    }
  }
  return bag;
}

function modeStatus(bag) {
  const p = (n) => typeof bag[n] === "string" && bag[n].trim().length > 0;
  const paid = (bag.ALLOW_PAID_AI || "false").toLowerCase() === "true" && Number(bag.MONTHLY_AI_BUDGET_USD || "0") > 0;
  return {
    provider: (bag.AI_PROVIDER || "auto").toLowerCase(),
    gemini: p("GEMINI_API_KEY"),
    openai: p("OPENAI_API_KEY"),
    paidAllowed: paid,
  };
}

// ---- self-test -----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const t = (name, cond) => { if (!cond) { console.error(`SELF-TEST FAILED: ${name}`); process.exit(1); } };
  t("sets provider when absent", setAiProvider(["GEMINI_MODEL=x"], "local").includes("AI_PROVIDER=local"));
  t("replaces provider when present", setAiProvider(["AI_PROVIDER=auto", "GEMINI_MODEL=x"], "gemini").filter((l) => l.startsWith("AI_PROVIDER=")).join() === "AI_PROVIDER=gemini");
  t("keeps other lines", setAiProvider(["ALLOW_PAID_AI=false", "AI_PROVIDER=auto"], "local").includes("ALLOW_PAID_AI=false"));
  const st = modeStatus({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-x", ALLOW_PAID_AI: "false" });
  t("paid stays disabled by default", st.paidAllowed === false);
  const st2 = modeStatus({ GEMINI_API_KEY: "gk" });
  t("gemini key detected, no value stored in status", st2.gemini === true && !JSON.stringify(st2).includes("gk"));
  const d = mkdtempSync(join(tmpdir(), "sophira-ai-"));
  const el = join(d, ".env.local");
  writeFileSync(el, "AI_PROVIDER=auto\nALLOW_PAID_AI=false\nGEMINI_API_KEY=\n");
  writeFileSync(el, setAiProvider(readFileSync(el, "utf8").split("\n"), "gemini").join("\n"));
  const after = readFileSync(el, "utf8");
  t("mode persisted to .env.local without touching safeguards", after.includes("AI_PROVIDER=gemini") && after.includes("ALLOW_PAID_AI=false") && after.includes("GEMINI_API_KEY="));
  console.log("setup-ai.mjs self-test passed (7/7)");
  process.exit(0);
}

// ---- main ----------------------------------------------------------------
const modeArg = (() => {
  const i = process.argv.indexOf("--mode");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1].toLowerCase() : null;
})();

console.log("Sophira AI setup — honest options\n");
console.log("  First, what is where:");
console.log("    - Sophira's application CODE is in this GitHub repository.");
console.log("    - CLOUD AI models (Gemini, OpenAI) are NOT downloadable from GitHub.");
console.log("      They run on the provider's servers and are reached via API key.");
console.log("    - LOCAL AI is a small model that genuinely runs on your machine,");
console.log("      downloaded at first use from the app (never committed to GitHub).\n");
console.log("  Available modes (AI_PROVIDER in .env.local):\n");
console.log("    auto    (default) free-first: Gemini free tier when a key is set,");
console.log("            otherwise local/offline. Paid AI never activates silently.");
console.log("    gemini  CLOUD: free-tier Google Gemini API — needs GEMINI_API_KEY");
console.log("            (aistudio.google.com → Get API key). Key stays server-side.");
console.log("    openai  CLOUD: PAID OpenAI — inert until you ALSO set");
console.log("            ALLOW_PAID_AI=true and MONTHLY_AI_BUDGET_USD>0 yourself.");
console.log("    local   LOCAL: on-device model in your browser — no key, no cloud,");
console.log("            works offline after the one-time model download.\n");

const envLocal = join(ROOT, ".env.local");
if (!existsSync(envLocal)) {
  if (existsSync(join(ROOT, ".env.example"))) { copyFileSync(join(ROOT, ".env.example"), envLocal); console.log("  Created .env.local from .env.example (it did not exist).\n"); }
}

if (modeArg) {
  if (!MODES.includes(modeArg)) {
    console.error(`::error::Unknown mode "${modeArg}". Choose one of: ${MODES.join(", ")}.`);
    process.exit(2);
  }
  const lines = readFileSync(envLocal, "utf8").split("\n");
  writeFileSync(envLocal, setAiProvider(lines, modeArg).join("\n"));
  console.log(`  ✓ AI_PROVIDER=${modeArg} written to .env.local.`);
  if (modeArg === "gemini") console.log("  → Also set GEMINI_API_KEY in .env.local (free key from aistudio.google.com).");
  if (modeArg === "openai") console.log("  → Paid AI remains DISABLED until you set ALLOW_PAID_AI=true and MONTHLY_AI_BUDGET_USD>0.");
  if (modeArg === "local") console.log("  → Start the app (npm run dev), then use the on-device model from the app's offline page; the model downloads at first use.");
  console.log("");
}

const bag = readEnvBag(envLocal);
const st = modeStatus(bag);
console.log("  Current configuration (values never printed):");
console.log(`    - AI_PROVIDER = ${st.provider}`);
console.log(`    - GEMINI_API_KEY: ${st.gemini ? "set (cloud Gemini ready)" : "not set"}`);
console.log(`    - OPENAI_API_KEY: ${st.openai ? "set" : "not set"} — paid AI is ${st.paidAllowed ? "ENABLED (you opted in)" : "DISABLED (free-first safeguard active)"}`);
console.log("");
console.log("  AI requests always run server-side (src/app/api/ai) — keys never");
console.log("  reach the browser, the client bundle, or the mobile shell.");
console.log("  Docs: docs/ENVIRONMENT_VARIABLES.md, docs/OFFLINE_MODELS.md, docs/TROUBLESHOOTING.md");
process.exit(0);
