#!/usr/bin/env node
/**
 * Generates .env.example from the AUTHORITATIVE manifest
 * (src/config/env.manifest.json). Keep .env.example generated, never
 * hand-edited, so it can never disagree with the code.
 *
 * Usage:
 *   node scripts/gen-env-example.mjs          — (re)write .env.example
 *   node scripts/gen-env-example.mjs --check  — exit 1 if out of sync
 *
 * Placeholders only - NEVER real secrets (secret-scan.mjs enforces).
 */
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "src/config/env.manifest.json"), "utf8"));

const lines = [
  "# Sophira environment template - GENERATED from src/config/env.manifest.json",
  "# (npm run env:example checks sync; never hand-edit this file).",
  "# Copy to .env.local for development. For Vercel, set Production/Preview",
  "# values in the dashboard or run: vercel env pull .env.local",
  "# NEVER commit real secrets.",
  "",
];

for (const sec of manifest.sections) {
  const vars = manifest.variables.filter((v) => v.section === sec.id);
  if (!vars.length) continue;
  lines.push(`# ---- ${sec.title} ----`);
  for (const v of vars) {
    if (v.note) lines.push(`# ${v.note}`);
    if (v.required === "internal") {
      lines.push(`# ${v.name}: set by repo scripts - not user configuration.`);
      lines.push("");
      continue;
    }
    const req =
      v.required === "production" ? " (REQUIRED for a production deployment)"
      : v.required === "native-release" ? " (only for native/mobile release builds - GitHub Actions secrets, not Vercel)"
      : v.required === "live-tests" ? " (only when RUN_LIVE_TESTS=true)"
      : v.required === "conditional" ? " (required only when SEARCH_PROVIDER=custom)"
      : "";
    if (req) lines.push(`# ${req.trim()}`);
    const value = v.default !== undefined && v.default !== "" ? v.default : (v.placeholder || "");
    lines.push(`${v.name}=${value}`);
    lines.push("");
  }
}
lines.push("# Reminder: ALLOW_PAID_AI=false + MONTHLY_AI_BUDGET_USD=0 guarantee zero AI billing.", "");
const out = lines.join("\n");

if (process.argv.includes("--check")) {
  const current = readFileSync(join(root, ".env.example"), "utf8");
  if (current !== out) {
    console.error("env: .env.example is OUT OF SYNC with src/config/env.manifest.json - run: node scripts/gen-env-example.mjs");
    process.exit(1);
  }
  console.log("env: .env.example is in sync with the manifest.");
  process.exit(0);
}
writeFileSync(join(root, ".env.example"), out);
console.log("env: .env.example regenerated from the manifest.");
