#!/usr/bin/env node
/**
 * Sophira legal-placeholder status (2026-10-05).
 *
 * The legal documents (docs/legal/*.md + LICENSE) are complete templates
 * with deliberately bracketed OWNER FACTS (legal entity, address,
 * jurisdiction, contact, effective date) that only the owner can fill in
 * and that require qualified attorney review (see
 * docs/legal/LEGAL_REVIEW_NOTICE.md).
 *
 * This script makes the remaining work machine-visible:
 *   node scripts/legal-status.mjs           — human-readable report
 *   node scripts/legal-status.mjs --json    — machine-readable report
 *
 * Exit code: 0 when NO placeholders remain (legal docs are complete),
 *            1 while owner facts are still bracketed (expected today).
 * CI runs it informationally (never fails the build).
 *
 * A placeholder is an ALL-CAPS bracketed token, e.g. [LEGAL ENTITY NAME].
 * Markdown links and normal prose never match the uppercase-only pattern.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PLACEHOLDER_RE = /\[([A-Z0-9][A-Z0-9 /().,:;'#-]{2,60})\]/g;

const files = ["LICENSE", ...readdirSync("docs/legal")
  .filter((f) => f.endsWith(".md"))
  .sort()
  .map((f) => join("docs/legal", f))];

const report = [];
let total = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const found = [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1].trim());
  const unique = [...new Set(found)];
  total += unique.length;
  report.push({ file, placeholders: unique });
}

const asJson = process.argv.includes("--json");
if (asJson) {
  console.log(JSON.stringify({ complete: total === 0, remaining: total, files: report }, null, 2));
} else {
  for (const r of report) {
    if (r.placeholders.length === 0) {
      console.log(`✓ ${r.file}: complete`);
    } else {
      console.log(`… ${r.file}: ${r.placeholders.length} owner fact(s) still bracketed:`);
      for (const p of r.placeholders) console.log(`    [${p}]`);
    }
  }
  console.log(total === 0
    ? "Legal documents: COMPLETE — no bracketed owner facts remain (attorney review still required before production use)."
    : `Legal documents: ${total} owner fact(s) remain — fill them in, then have qualified counsel review before production use.`);
}
process.exit(total === 0 ? 0 : 1);
