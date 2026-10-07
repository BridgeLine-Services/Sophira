#!/usr/bin/env node
/**
 * Sophira one-command validation (2026-10-06): npm run verify.
 *
 * Checks, in order: dependencies, manifest/.env.example sync, environment
 * configuration (AI / Supabase / search coherence — never values), native
 * URL resolution, secret hygiene, and the production build.
 * Add --fast to skip the build step. Never prints secret values.
 */
import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

const ROOT = join(import.meta.dirname, "..");
const steps = [];
let failed = 0;

function run(name, cmd, { fatal = false, cwd = ROOT } = {}) {
  console.log(`\n=== ${name} ===`);
  try {
    execSync(cmd, { cwd, stdio: "inherit" });
    steps.push([name, "PASS"]);
    return true;
  } catch {
    steps.push([name, fatal ? "FAIL" : "WARN"]);
    if (fatal) failed++;
    return false;
  }
}

console.log("Sophira verification\n");
console.log("(Values of environment variables are never printed.)");

// 1. Node + dependencies
const [major] = process.versions.node.split(".").map(Number);
if (major < 20) { console.error(`::error::Node.js >= 20 required (found ${process.versions.node})`); process.exit(1); }
steps.push(["Node.js >= 20", "PASS"]);
console.log(`  ✓ Node.js ${process.versions.node}`);
const depsOk = existsSync(join(ROOT, "node_modules/next")) && existsSync(join(ROOT, "node_modules/@supabase/ssr"));
steps.push(["Dependencies installed", depsOk ? "PASS" : "FAIL"]);
if (!depsOk) { failed++; console.log("  ✗ Dependencies missing — run: npm run setup"); }
else console.log("  ✓ Dependencies installed");

// 2. .env.example / manifest sync
run(".env.example in sync with the manifest", "node scripts/gen-env-example.mjs --check", { fatal: true });

// 3. Environment validation (AI / Supabase / search coherence)
const envOk = run("Environment configuration (local context)", "node scripts/verify-deployment.mjs --env-only", { fatal: true });
if (!envOk) console.log("  (fill the listed variables in .env.local — see docs/ENVIRONMENT_VARIABLES.md)");

// 4. Native/mobile URL resolution (dev mode — no SOPHIRA_APP_URL required)
run("Native URL resolution (dev mode)", "node scripts/native-url.mjs");

// 5. Secret hygiene
run("Secret scan (no committed secrets, client bundles stay clean)", "node scripts/secret-scan.mjs", { fatal: true });

// 6. Build
if (process.argv.includes("--fast")) {
  steps.push(["Production build", "SKIPPED (--fast)"]);
} else {
  run("Production build (next build)", "npm run build", { fatal: true });
}

// Summary
console.log("\n=== Verification summary ===");
for (const [n, r] of steps) console.log(`  ${r === "PASS" ? "✓" : r === "FAIL" ? "✗" : "…"} ${n}: ${r}`);
if (failed > 0) { console.error(`\n::error::Verification FAILED (${failed} blocking step(s)).`); process.exit(1); }
console.log("\nVerification: PASS (warnings above are optional capabilities.)");
process.exit(0);
