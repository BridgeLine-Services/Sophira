#!/usr/bin/env node
/**
 * Static accessibility audit (2026-11-03, phase 2), via the TypeScript AST rather than regexes.
 *
 * Regexes produced mostly false positives here: a control wrapped in <label>, or a button
 * labelled {f.label}, looked nameless. The parser sees the real structure:
 *
 *   1. a <button> whose children are only icons and which has no aria-label/title
 *      (an expression child such as {label} counts as text - it renders something)
 *   2. a form control with no aria-label, aria-labelledby, id, or wrapping <label>
 *   3. role="dialog" without aria-modal and an accessible name
 *
 * Ratchet: --write records the current count in docs/a11y-baseline.json; the count may only fall.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import ts from "typescript";

const files = [];
const walkDir = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = `${d}/${e.name}`;
    if (e.isDirectory()) walkDir(p);
    else if (e.name.endsWith(".tsx")) files.push(p);
  }
};
walkDir("src");

const findings = [];
const ATTR_NAMES = new Set(["aria-label", "aria-labelledby", "title"]);
const attr = (node, name) => node.attributes.properties.find(
  (a) => ts.isJsxAttribute(a) && a.name.getText() === name);

function scanSource(f, src) {
  const found = [];
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node, inLabel = false) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const tag = opening.tagName.getText(sf);
      const wrapsInLabel = inLabel || tag === "label";

      // Text anywhere in the subtree counts - <button><span><BookOpen/> Courses</span></button> is
      // labelled, and only a button with no text at any depth is nameless.
      const subtreeHasText = (n) => {
        let found = false;
        const scan = (c) => {
          if (found) return;
          if (ts.isJsxText(c) && c.getText(sf).trim().length > 0) { found = true; return; }
          if (ts.isJsxExpression(c) && c.expression && !ts.isJsxAttribute(c.parent)) { found = true; return; }
          ts.forEachChild(c, scan);
        };
        ts.forEachChild(n, scan);
        return found;
      };

      const spreadsProps = opening.attributes.properties.some((a) => ts.isJsxSpreadAttribute(a));

      if (tag === "button" && ts.isJsxElement(node)) {
        const named = [...ATTR_NAMES].some((n) => attr(opening, n));
        const text = node.children.map((c) => c.getText(sf)).join(" ").toLowerCase();
        if (!subtreeHasText(node) && !named && !text.includes("sr-only")) {
          found.push({ f, line: line(node), rule: "button without accessible name" });
        }
      }

      if (["input", "select", "textarea"].includes(tag)) {
        const type = (attr(opening, "type")?.initializer?.getText(sf) ?? "").replace(/["'{}]/g, "");
        const exempt = ["hidden", "submit", "button", "file"].includes(type)
          || Boolean(attr(opening, "hidden"));
        const named = [...ATTR_NAMES].some((n) => attr(opening, n))
          || Boolean(attr(opening, "id"))
          || Boolean(attr(opening, "aria-labelledby"));
        // A shared primitive spreads its props, so its label arrives from the caller.
        if (!exempt && !named && !wrapsInLabel && !spreadsProps) {
          found.push({ f, line: line(node), rule: `<${tag}> without label` });
        }
      }

      const role = attr(opening, "role")?.initializer?.getText(sf) ?? "";
      if (role.includes("dialog")) {
        const modal = Boolean(attr(opening, "aria-modal"));
        const named = [...ATTR_NAMES].some((n) => attr(opening, n));
        if (!modal || !named) found.push({ f, line: line(node), rule: "dialog missing aria-modal or name" });
      }

      ts.forEachChild(node, (c) => visit(c, wrapsInLabel || tag === "label"));
      return;
    }
    ts.forEachChild(node, (c) => visit(c, inLabel));
  };
  visit(sf);
  return found;
}

if (process.argv.includes("--self-test")) {
  // Fixtures: the audit must find exactly the planted defects, or a clean run means nothing.
  const bad = `
    export const X = () => (
      <div role="dialog" aria-label="Settings">
        <button onClick={() => go()}><Trash2 /></button>
        <input type="checkbox" checked={on} onChange={f} />
        <select value={v}><option>a</option></select>
        <button onClick={g}><span><Icon /> Save</span></button>
        <label>Name <input value={n} /></label>
        <button onClick={h} aria-label="Close"><X /></button>
      </div>
    );`;
  const got = scanSource("fixture.tsx", bad);
  const rules = got.map((g) => g.rule).sort();
  const want = ["<input> without label", "<select> without label", "button without accessible name",
                "dialog missing aria-modal or name"];
  const ok = JSON.stringify(rules) === JSON.stringify(want.sort());
  console.log(ok
    ? `a11y self-test: PASS (${got.length} planted defects found, none invented)`
    : `a11y self-test: FAIL\n  got  ${JSON.stringify(rules)}\n  want ${JSON.stringify(want.sort())}`);
  process.exit(ok ? 0 : 1);
}

for (const f of files) {
  const src = readFileSync(f, "utf8");
  findings.push(...scanSource(f, src));
}


const byRule = {};
for (const x of findings) byRule[x.rule] = (byRule[x.rule] ?? 0) + 1;

if (process.argv.includes("--write")) {
  writeFileSync("docs/a11y-baseline.json",
    JSON.stringify({ total: findings.length, byRule, recorded: new Date().toISOString().slice(0, 10) }, null, 2) + "\n");
  console.log(`a11y: recorded baseline of ${findings.length} findings`);
  process.exit(0);
}
console.log(`a11y: ${findings.length} findings across ${new Set(findings.map((x) => x.f)).size} files`);
for (const [r, c] of Object.entries(byRule)) console.log(`  ${String(c).padStart(3)}  ${r}`);
if (process.argv.includes("--list")) for (const x of findings) console.log(`${x.f}:${x.line}  ${x.rule}`);

const base = existsSync("docs/a11y-baseline.json") ? JSON.parse(readFileSync("docs/a11y-baseline.json", "utf8")) : null;
if (base && findings.length > base.total) {
  console.error(`\na11y: FAIL — ${findings.length} exceeds the recorded baseline of ${base.total}`);
  process.exit(1);
}
console.log(`a11y: PASS${base ? ` (baseline ${base.total})` : " (no baseline yet)"}`);
