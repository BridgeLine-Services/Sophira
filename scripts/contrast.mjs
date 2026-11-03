#!/usr/bin/env node
/**
 * WCAG contrast audit for the shipped theme tokens (2026-11-03, phase 2).
 *
 * Dark mode fails most often on text legibility, and that is measurable, so it is measured
 * rather than eyeballed. This reads the real --c-* triplets out of globals.css for BOTH themes
 * and reports the contrast ratio of every text/surface pair the owner pages actually use.
 *
 * It does not replace a visual review: layout, spacing and focus order still need human eyes.
 * It does mean a theme change that makes a label unreadable fails the build.
 */
import { readFileSync } from "node:fs";

const css = readFileSync("src/app/globals.css", "utf8");
const block = (start) => {
  const i = css.indexOf(start);
  if (i === -1) throw new Error(`theme block not found: ${start}`);
  const end = css.indexOf("}", i);
  const body = css.slice(i, end);
  const out = {};
  for (const m of body.matchAll(/--c-([a-z-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
};

const light = block(":root {");
const dark = block('[data-theme="dark"]');

const lin = (c) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// [text token, surface token, minimum, why]
const PAIRS = [
  ["ink", "paper", 4.5, "body text on the page"],
  ["ink", "card", 4.5, "card titles and values"],
  ["ink", "card-elevated", 4.5, "raised card text"],
  ["ink", "sidebar", 4.5, "sidebar labels"],
  ["ink-soft", "paper", 4.5, "secondary text"],
  ["ink-soft", "card", 4.5, "tile labels and notes"],
  ["ink-soft", "sidebar", 4.5, "sidebar group headings"],
  ["accent", "paper", 4.5, "links and section icons"],
  ["accent", "card", 4.5, "links inside cards"],
  ["accent", "accent-soft", 3, "accent text on the accent-soft surface"],
  ["success", "card", 4.5, "success state"],
  ["warn", "card", 4.5, "needs-attention state"],
  ["danger", "card", 4.5, "error state"],
  ["ink", "accent-soft", 4.5, "text on the accent-soft surface"],
  ["on-accent", "accent", 4.5, "button labels on the accent surface"],
  ["on-accent", "accent-deep", 4.5, "button labels while hovered/pressed"],
];

let worst = { ratio: Infinity };
const rows = [];
const failures = [];
for (const [name, tokens] of [["light", light], ["dark", dark]]) {
  for (const [fg, bg, min, why] of PAIRS) {
    const a = tokens[fg];
    const b = tokens[bg];
    if (!a || !b) {
      failures.push(`${name}: token missing for ${fg}/${bg} (${why})`);
      continue;
    }
    const r = ratio(a, b);
    rows.push({ theme: name, pair: `${fg} on ${bg}`, r: r.toFixed(2), min, ok: r >= min });
    if (r < worst.ratio) worst = { ratio: r, theme: name, pair: `${fg} on ${bg}`, min };
    if (r < min) failures.push(`${name}: ${fg} on ${bg} is ${r.toFixed(2)}:1, needs ${min}:1 (${why})`);
  }
}

for (const row of rows) {
  console.log(`${row.ok ? "ok  " : "FAIL"} ${row.theme.padEnd(5)} ${row.pair.padEnd(26)} ${row.r.padStart(6)}:1  (min ${row.min})`);
}
console.log(`\nworst pair: ${worst.pair} in ${worst.theme} at ${worst.ratio.toFixed(2)}:1 (min ${worst.min})`);
if (failures.length) {
  console.error(`\ncontrast: ${failures.length} pair(s) below WCAG AA`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`contrast: PASS (${rows.length} pairs, both themes)`);
