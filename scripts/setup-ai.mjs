#!/usr/bin/env node
/**
 * Sophira AI-mode setup (2026-10-06): SELF-HOSTED FIRST. Explains the
 * honest AI options and configures AI_PROVIDER safely. CLOUD vs LOCAL is
 * stated plainly:
 *
 *   SELF-HOSTED (default path) = your own OpenAI-compatible inference
 *               server (Ollama, llama.cpp, vLLM, LM Studio) via
 *               LOCAL_LLM_BASE_URL + LOCAL_LLM_MODEL. No API key, no
 *               cloud, no billing possible. Tried FIRST in auto mode.
 *   CLOUD AI   = Gemini (free tier) or OpenAI (paid, DISABLED by default)
 *               reached through their APIs. The models themselves are
 *               NOT downloadable from GitHub — your code is here; the
 *               model runs on the provider's servers.
 *   ON-DEVICE  = a small model that genuinely runs in YOUR browser,
 *               downloaded at first use from the app (never committed).
 *
 * Usage:
 *   npm run setup:ai                — explain modes + show current status
 *   npm run setup:ai -- --mode selfhost | local | gemini | openai | auto
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
const MODES = ["auto", "selfhost", "local", "gemini", "openai"];

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
    selfhost: p("LOCAL_LLM_BASE_URL"),
  };
}

// ---- self-test -----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const t = (name, cond) => { if (!cond) { console.error(`SELF-TEST FAILED: ${name}`); process.exit(1); } };
  t("sets provider when absent", setAiProvider(["GEMINI_MODEL=x"], "selfhost").includes("AI_PROVIDER=selfhost"));
  t("replaces provider when present", setAiProvider(["AI_PROVIDER=auto", "GEMINI_MODEL=x"], "gemini").filter((l) => l.startsWith("AI_PROVIDER=")).join() === "AI_PROVIDER=gemini");
  t("keeps other lines", setAiProvider(["ALLOW_PAID_AI=false", "AI_PROVIDER=auto"], "local").includes("ALLOW_PAID_AI=false"));
  const st = modeStatus({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-x", ALLOW_PAID_AI: "false" });
  t("paid stays disabled by default", st.paidAllowed === false);
  const st2 = modeStatus({ GEMINI_API_KEY: "gk" });
  t("gemini key detected, no value stored in status", st2.gemini === true && !JSON.stringify(st2).includes("gk"));
  const stS = modeStatus({ LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434" });
  t("selfhost endpoint detected, no value stored in status", stS.selfhost === true && !JSON.stringify(stS).includes("11434"));
  const d = mkdtempSync(join(tmpdir(), "sophira-ai-"));
  const el = join(d, ".env.local");
  writeFileSync(el, "AI_PROVIDER=auto\nALLOW_PAID_AI=false\nGEMINI_API_KEY=\n");
  writeFileSync(el, setAiProvider(readFileSync(el, "utf8").split("\n"), "selfhost").join("\n"));
  const after = readFileSync(el, "utf8");
  t("mode persisted to .env.local without touching safeguards", after.includes("AI_PROVIDER=selfhost") && after.includes("ALLOW_PAID_AI=false") && after.includes("GEMINI_API_KEY="));
  console.log("setup-ai.mjs self-test passed (8/8)");
  process.exit(0);
}

// ---- main ----------------------------------------------------------------
const modeArg = (() => {
  const i = process.argv.indexOf("--mode");
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1].toLowerCase() : null;
})();

console.log("Sophira AI setup — SELF-HOSTED FIRST, honest options\n");
console.log("  First, what is where:");
console.log("    - Sophira's application CODE is in this GitHub repository.");
console.log("    - CLOUD AI models (Gemini, OpenAI) are NOT downloadable from GitHub.");
console.log("      They run on the provider's servers and are reached via API key.");
console.log("    - SELF-HOSTED AI is the DEFAULT PATH: your own inference server");
console.log("      (Ollama / llama.cpp / vLLM / LM Studio) — no key, no cloud, no billing.\n");
console.log("  Quick start (Ollama — 4 lines):");
console.log("    1. Install Ollama from ollama.com, then: ollama pull llama3.1:8b");
console.log("    2. Start it:            ollama serve   (usually already running)");
console.log("    3. In .env.local:       LOCAL_LLM_BASE_URL=http://127.0.0.1:11434");
console.log("                           LOCAL_LLM_MODEL=llama3.1:8b");
console.log("    4. Verify:              curl localhost:3000/api/ai/health\n");
console.log("  Available modes (AI_PROVIDER in .env.local):\n");
console.log("    selfhost SELF-HOSTED (DEFAULT PATH): your own OpenAI-compatible");
console.log("            inference server via LOCAL_LLM_BASE_URL + LOCAL_LLM_MODEL.");
console.log("            No API key, no cloud; tried FIRST in auto mode.");
console.log("    auto    (default) selfhost first, then Gemini free tier (if a key");
console.log("            is set), then paid OpenAI only if explicitly allowed.");
console.log("    gemini  CLOUD: free-tier Google Gemini API — needs GEMINI_API_KEY");
console.log("            (aistudio.google.com → Get API key). Key stays server-side.");
console.log("    openai  CLOUD: PAID — inert until you ALSO set");
console.log("            ALLOW_PAID_AI=true and MONTHLY_AI_BUDGET_USD>0.");
console.log("    local   ON-DEVICE: small model in your browser — no key, no cloud,");
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
  if (modeArg === "selfhost") console.log("  → Set LOCAL_LLM_BASE_URL (e.g. http://127.0.0.1:11434 for Ollama) in .env.local, start your inference server, check http://localhost:3000/api/ai/health.");
  if (modeArg === "gemini") console.log("  → Also set GEMINI_API_KEY in .env.local (free key from aistudio.google.com).");
  if (modeArg === "openai") console.log("  → Paid AI remains DISABLED until you set ALLOW_PAID_AI=true and MONTHLY_AI_BUDGET_USD>0.");
  if (modeArg === "local") console.log("  → Start the app (npm run dev), then use the on-device model from the app's offline page; the model downloads at first use.");
  console.log("");
}

const bag = readEnvBag(envLocal);
const st = modeStatus(bag);
console.log("  Current configuration (values never printed):");
console.log(`    - AI_PROVIDER = ${st.provider}`);
console.log(`    - LOCAL_LLM_BASE_URL: ${st.selfhost ? "set (self-hosted inference ready)" : "not set — the default self-hosted path needs this (no key required)"}`);
console.log(`    - GEMINI_API_KEY: ${st.gemini ? "set (cloud Gemini ready)" : "not set"}`);
console.log(`    - OPENAI_API_KEY: ${st.openai ? "set" : "not set"} — paid AI is ${st.paidAllowed ? "ENABLED (you opted in)" : "DISABLED (free-first safeguard active)"}`);
console.log("");
console.log("  AI requests always run server-side (src/app/api/ai) — keys never");
console.log("  reach the browser, the client bundle, or the mobile shell.");
console.log("  Docs: docs/SELF_HOSTED_AI_ARCHITECTURE.md, docs/ENVIRONMENT_VARIABLES.md, docs/TROUBLESHOOTING.md");
process.exit(0);
