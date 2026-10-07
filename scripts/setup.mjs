#!/usr/bin/env node
/**
 * Sophira one-command setup (2026-10-06): GitHub clone -> runnable app.
 *
 * Usage:
 *   npm run setup            — check Node, install deps if missing,
 *                              create .env.local from .env.example (NEVER
 *                              overwrite an existing one), validate the
 *                              configuration, and explain what's missing.
 *   node scripts/setup.mjs --self-test — verify THIS script's rules
 *
 * Never prints secret values. Everything this script tells you is
 * categorical (which variable, where to get it) — never a value.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdtempSync } from "fs";
import { execSync } from "child_process";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");

// ---- pure helpers (self-tested) ----------------------------------------
function envLocalStatus(envLocalPath) {
  if (existsSync(envLocalPath)) return "exists";
  return "missing";
}

/** Copy .env.example -> .env.local ONLY when missing. Returns action taken. */
function ensureEnvLocal(examplePath, envLocalPath) {
  if (existsSync(envLocalPath)) return "kept"; // NEVER overwrite
  if (!existsSync(examplePath)) return "no-example";
  copyFileSync(examplePath, envLocalPath);
  return "created";
}

/** Required-credential summary, categorical only (no values). */
function remainingCredentials(env) {
  const p = (n) => typeof env[n] === "string" && env[n].trim().length > 0;
  const list = [];
  const add = (name, where) => list.push({ name, where });
  if (!p("NEXT_PUBLIC_SUPABASE_URL") || !p("NEXT_PUBLIC_SUPABASE_ANON_KEY"))
    add("NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY", "Supabase → Project Settings → API");
  if (!p("SUPABASE_SERVICE_ROLE_KEY"))
    add("SUPABASE_SERVICE_ROLE_KEY (server-only)", "Supabase → Project Settings → API (service_role)");
  if (!p("GEMINI_API_KEY"))
    add("GEMINI_API_KEY (free-tier cloud AI - OPTIONAL)", "aistudio.google.com → Get API key");
  return list;
}

// ---- self-test -----------------------------------------------------------
if (process.argv.includes("--self-test")) {
  const t = (name, cond) => { if (!cond) { console.error(`SELF-TEST FAILED: ${name}`); process.exit(1); } };
  const d = mkdtempSync(join(tmpdir(), "sophira-setup-"));
  const ex = join(d, ".env.example"), el = join(d, ".env.local");
  writeFileSync(ex, "# template\nGEMINI_API_KEY=\n");
  t("missing env.local detected", envLocalStatus(el) === "missing");
  t("creates from example once", ensureEnvLocal(ex, el) === "created");
  const before = readFileSync(el, "utf8");
  writeFileSync(ex, "# template CHANGED\n");
  t("NEVER overwrites existing .env.local", ensureEnvLocal(ex, el) === "kept" && readFileSync(el, "utf8") === before);
  const none = remainingCredentials({});
  t("empty env -> supabase + gemini required", none.some((r) => r.name.includes("NEXT_PUBLIC_SUPABASE_URL")) && none.some((r) => r.name.includes("GEMINI_API_KEY")));
  const full = remainingCredentials({ NEXT_PUBLIC_SUPABASE_URL: "u", NEXT_PUBLIC_SUPABASE_ANON_KEY: "a", SUPABASE_SERVICE_ROLE_KEY: "s", GEMINI_API_KEY: "g" });
  t("configured env -> nothing remaining", full.length === 0);
  const probe = remainingCredentials({ NEXT_PUBLIC_SUPABASE_URL: "https://secret-value-marker.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "srk-value-marker-987" });
  t("summary carries no values", !JSON.stringify(probe).includes("marker"));
  console.log("setup.mjs self-test passed (7/7)");
  process.exit(0);
}

// ---- main ----------------------------------------------------------------
console.log("Sophira setup — from a fresh GitHub clone to a running app\n");

// 1. Node.js requirement
const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  console.error(`::error::Node.js >= 20 is required (found ${process.versions.node}). Install from nodejs.org, then re-run npm run setup.`);
  process.exit(1);
}
console.log(`  ✓ Node.js ${process.versions.node} (>= 20)`);

// 2. Package manager: npm (package-lock.json is committed)
if (!existsSync(join(ROOT, "package-lock.json"))) {
  console.error("::error::package-lock.json is missing — use npm (the repository's package manager).");
  process.exit(1);
}
console.log("  ✓ Package manager: npm (package-lock.json)");

// 3. Dependencies
if (!existsSync(join(ROOT, "node_modules/next"))) {
  console.log("  … Installing dependencies (npm install) — this can take a few minutes…");
  try {
    execSync("npm install", { cwd: ROOT, stdio: "inherit" });
  } catch {
    console.error("::error::npm install failed. Check your internet connection and Node version, then re-run npm run setup.");
    process.exit(1);
  }
} else {
  console.log("  ✓ Dependencies installed");
}

// 4. Local environment file
const envLocal = join(ROOT, ".env.local");
const action = ensureEnvLocal(join(ROOT, ".env.example"), envLocal);
if (action === "created") console.log("  ✓ Created .env.local from .env.example (edit it next — see step 5)");
else if (action === "kept") console.log("  ✓ Existing .env.local kept (never overwritten)");
else {
  console.error("::error::.env.example is missing — the repository is incomplete; re-download it.");
  process.exit(1);
}

// 5. Configuration check (categorical; never values)
const env = {};
for (const [k, v] of Object.entries(process.env)) env[k] = v;
if (existsSync(envLocal)) {
  for (const line of readFileSync(envLocal, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)\s*=\s*(.*)$/);
    if (m && !env[m[1]]) env[m[1]] = m[2];
  }
}
const remaining = remainingCredentials(env);
console.log("");
if (remaining.length === 0) {
  console.log("  ✓ All core credentials are set. You're ready:");
} else {
  console.log("  Credentials still needed (open .env.local and fill them in):");
  for (const r of remaining) console.log(`    - ${r.name}\n      where: ${r.where}`);
  console.log("  … or run Sophira with ZERO credentials in local-first mode:");
  console.log("        SOPHIRA_LOCAL_FIRST=true npm run dev   (on-device AI, no Supabase)");
}
console.log("");
console.log("  Next steps:");
console.log("    npm run dev        → http://localhost:3000");
console.log("    npm run setup:ai   → choose your AI mode (local vs cloud API)");
console.log("    npm run verify     → one-command validation (env + AI + build + secrets)");
console.log("    docs/QUICK_START_LOCAL.md      → total-beginner guide (no Vercel needed)");
console.log("    docs/VERCEL_DEPLOYMENT.md     → deploy to Vercel");
console.log("    docs/TROUBLESHOOTING.md       → fixes for common problems");
console.log("");
console.log("  Honest note: Sophira's CODE comes from this GitHub repository.");
console.log("  Cloud AI models (Gemini/OpenAI) are NOT in the repository — they are");
console.log("  reached through their APIs with a key. The LOCAL AI mode downloads a");
console.log("  small on-device model at first use (your machine, your data).");
process.exit(0);
