// Stage 5 release audit: evidence gathering, not opinion.
// Reports RLS coverage, client-bundle exposure, raw-error leakage, and
// accessibility signals. Exit code is 0 always: this prints facts for the report.
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join, extname } from "path";

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

const sqlFiles = walk("supabase/migrations").filter((f) => f.endsWith(".sql"));
const allSql = sqlFiles.map((f) => readFileSync(f, "utf8")).join("\n");

// ---- RLS coverage ----
const tables = [...allSql.matchAll(/create table (?:if not exists )?public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
const uniq = [...new Set(tables)];
const rlsOn = new Set([...allSql.matchAll(/alter table public\.([a-z0-9_]+)\s+enable row level security/gi)].map((m) => m[1].toLowerCase()));
const noRls = uniq.filter((t) => !rlsOn.has(t.toLowerCase()));
const policies = [...allSql.matchAll(/create policy/gi)].length;
console.log(`RLS: ${uniq.length} tables, ${rlsOn.size} with RLS enabled, ${policies} policies`);
console.log(`RLS: tables WITHOUT row level security: ${noRls.length ? noRls.join(", ") : "none"}`);

// ---- client bundle exposure ----
const bundles = walk(".next/static").filter((f) => extname(f) === ".js");
const forbidden = ["SUPABASE_SERVICE_ROLE_KEY", "service_role", "SUPABASE_SECRET_KEY", "CANVAS_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_SECRET"];
const leaks = [];
for (const f of bundles) {
  const src = readFileSync(f, "utf8");
  for (const s of forbidden) if (src.includes(s)) leaks.push(`${s} in ${f}`);
}
const tokenLeaks = [];
for (const f of bundles) {
  const src = readFileSync(f, "utf8");
  for (const s of ["refresh_token", "access_token"]) {
    // A property name is only a problem when it is READ out of a payload, so report the count.
    const n = (src.match(new RegExp(s, "g")) || []).length;
    if (n > 0) tokenLeaks.push(`${s} x${n} in ${f.split("/").pop()}`);
  }
}
console.log(`BUNDLE: ${bundles.length} client chunks scanned`);
console.log(`BUNDLE: secret names found: ${leaks.length ? leaks.join("; ") : "none"}`);
console.log(`BUNDLE: token field references: ${tokenLeaks.length ? tokenLeaks.slice(0, 4).join("; ") : "none"}`);

// ---- raw error leakage in UI ----
const clientFiles = walk("src/app").concat(walk("src/components")).filter((f) => /\.tsx$/.test(f));
const stackish = [];
const rawErr = [];
for (const f of clientFiles) {
  const src = readFileSync(f, "utf8");
  if (/\.stack\b|Error\(\)\.stack|stackTrace/.test(src)) stackish.push(f);
  if (/\{[a-zA-Z_.]*\b(err|error|e)\.message\}/.test(src)) rawErr.push(f);
  if (/console\.error/.test(src)) rawErr.push(`${f} (console.error)`);
}
console.log(`UI: components rendering a raw error message: ${rawErr.length ? [...new Set(rawErr)].slice(0, 6).join(", ") : "none"}`);
console.log(`UI: components exposing stack traces: ${stackish.length ? stackish.join(", ") : "none"}`);

// ---- accessibility signals ----
let aria = 0, labels = 0, dialogs = 0, alt = 0, focusVisible = 0, buttonsNoLabel = 0;
for (const f of clientFiles) {
  const src = readFileSync(f, "utf8");
  aria += (src.match(/aria-[a-z]+=/g) || []).length;
  labels += (src.match(/<label[^>]*htmlFor=/g) || []).length;
  dialogs += (src.match(/role="dialog"/g) || []).length;
  alt += (src.match(/alt=/g) || []).length;
  focusVisible += (src.match(/focus-visible:/g) || []).length;
  // Icon-only buttons: a <button> with no text and no aria-label is unusable by screen reader.
  const btns = src.match(/<button[\s\S]*?<\/button>/g) || [];
  buttonsNoLabel += btns.filter((b) => !/aria-label|>[^<]*[A-Za-z]{2}/.test(b)).length;
}
const css = ["src/app/globals.css"].filter(existsSync).map((f) => readFileSync(f, "utf8")).join("\n");
console.log(`A11Y: aria attributes=${aria}, labelled inputs=${labels}, dialogs with role=${dialogs}, alt text=${alt}, focus-visible utilities=${focusVisible}`);
console.log(`A11Y: icon-only buttons without a label: ${buttonsNoLabel}`);
console.log(`A11Y: prefers-reduced-motion handled in CSS: ${/prefers-reduced-motion/.test(css) ? "yes" : "NO"}`);
console.log(`A11Y: files using sr-only (screen-reader text): ${clientFiles.filter((f) => readFileSync(f, "utf8").includes("sr-only")).length}`);

// ---- live-integration honesty ----
const testFiles = walk("tests").filter((f) => f.endsWith(".ts"));
const blocked = testFiles.filter((f) => /BLOCKED|requires a live|live (google|microsoft|canvas)/i.test(readFileSync(f, "utf8")));
console.log(`LIVE: test files declaring live/provider-dependent coverage: ${blocked.length} (${blocked.map((f) => f.split("/").pop()).join(", ")})`);
