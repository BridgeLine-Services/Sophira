#!/usr/bin/env node
/**
 * Design-token drift audit (2026-11-03, phase 2).
 *
 * The redesign requires pages to use the shared semantic tokens instead of literal Tailwind
 * palette colours, so a theme change reaches every screen. This counts the literals that remain
 * and fails if the total rises above the recorded baseline (docs/design-drift.json). It is a
 * ratchet, not a rewrite: the number may go down, never up.
 *
 * It deliberately ignores the token definitions themselves and status colours that are semantic
 * (emerald/amber/red used for success/warning/error text).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { readdirSync } from "node:fs";

const SKIP = /node_modules|\.next|tests\/|scripts\/|\.agents/;
const LITERAL = /\b(?:bg|text|border|ring|from|to|via|divide|placeholder|shadow)-(?:slate|gray|zinc|neutral|stone|white|black)(?:-\d{2,3})?(?:\/\d{1,3})?\b/g;

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (SKIP.test(p)) continue;
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx|css)$/.test(e.name)) files.push(p);
  }
};
walk("src");

// A modal scrim must darken the page in both themes, so it is intentionally not a token.
const SCRIM = /\bbg-black\/\d+\b/g;

const hits = [];
let total = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const body = f.endsWith("globals.css") ? "" : src; // token definitions are the source of truth
  const m = (body.replace(SCRIM, "").match(LITERAL)) ?? [];
  if (m.length) {
    hits.push({ file: f, count: m.length });
    total += m.length;
  }
}

hits.sort((a, b) => b.count - a.count);
const baselineFile = "docs/design-drift.json";
const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, "utf8")) : null;

if (process.argv.includes("--write")) {
  writeFileSync(baselineFile, JSON.stringify({ total, byFile: hits, recorded: new Date().toISOString().slice(0, 10) }, null, 2) + "\n");
  console.log(`design-drift: recorded baseline of ${total} literal colour utilities across ${hits.length} files`);
  process.exit(0);
}

console.log(`design-drift: ${total} literal colour utilities in ${hits.length} files`);
for (const h of hits.slice(0, 12)) console.log(`  ${String(h.count).padStart(4)}  ${h.file}`);
if (baseline && total > baseline.total) {
  console.error(`\ndesign-drift: FAIL — ${total} exceeds the recorded baseline of ${baseline.total}.`);
  console.error("Use the semantic tokens (bg-card, text-ink, text-ink-soft, border-line, bg-accent, ...) instead.");
  process.exit(1);
}
console.log(`design-drift: PASS${baseline ? ` (baseline ${baseline.total}, ${baseline.total - total} fewer)` : " (no baseline recorded yet)"}`);
