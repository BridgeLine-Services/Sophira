/**
 * PLAIN LANGUAGE ON STUDENT SCREENS (2026-11-13, directive Part 12).
 *
 * Part 12 asks that technical implementation details never reach a student. That was
 * previously "applied to everything new", which is not an audit: it only ever proved the
 * newest screens were clean, and it could not see text buried inside TSX.
 *
 * scripts/jargon-audit.mjs extracts only the text a student can actually SEE (JSX text
 * nodes and the string props that render) from every student screen, and this test pins
 * the result at zero findings. The scanner is then self-tested, because a clean report
 * from a broken scanner would let the next screen regress silently.
 */
import { readFileSync } from "fs";
import { execFileSync } from "child_process";

type Assert = (condition: boolean, message: string) => void;

interface Finding { file: string; term: string; why: string; text: string }
interface Check { name: string; ok: boolean }

export async function runJargonTests(assert: Assert, section: (name: string) => void) {
  section("plain language: no engineering vocabulary reaches a student screen");

  // ---- the scanner works before its verdict is trusted --------------------
  const checks = JSON.parse(
    execFileSync("node", ["scripts/jargon-audit.mjs", "--selftest"], { encoding: "utf8" }),
  ) as Check[];
  assert(checks.length >= 4, `jargon: the scanner self-tests its extractor (${checks.length} checks)`);
  for (const c of checks) assert(c.ok, `jargon scanner: ${c.name}`);

  // ---- the verdict -------------------------------------------------------
  const findings = JSON.parse(
    execFileSync("node", ["scripts/jargon-audit.mjs", "--json"], { encoding: "utf8" }),
  ) as Finding[];
  assert(findings.length === 0,
    `jargon: every student screen is clear of engineering terms (found ${findings.length}: ` +
    findings.slice(0, 3).map((f) => `${f.file} -> ${f.term}`).join(", ") + ")");

  // ---- coverage: the audit must actually reach the student screens --------
  const script = readFileSync("scripts/jargon-audit.mjs", "utf8");
  const vocabulary = findJargonVocabulary();
  assert(script.includes("export const JARGON") && Object.keys(vocabulary).length >= 15,
    `jargon: the vocabulary is a real list (${Object.keys(vocabulary).length} terms), not scattered literals`);
  assert(/\/owner\/|STAFF/.test(script),
    "jargon: staff screens are excluded on purpose (technical wording belongs there)");

  // ---- the specific wording that was wrong is now right ------------------
  const owner = readFileSync("src/app/create-owner/page.tsx", "utf8");
  assert(!/bootstrap migration \(0025\)/.test(owner),
    "first-owner page: no migration number in a message a person reads");
  const signup = readFileSync("src/app/signup/page.tsx", "utf8");
  assert(!/Supabase settings/.test(signup),
    "signup page: an invited student is never told to check a vendor's settings");
  const settings = readFileSync("src/app/settings/page.tsx", "utf8");
  assert(!/Download my data \(JSON\)/.test(settings) && /Download all my data/.test(settings),
    "settings: the export button says what it does, not the file format");
  const local = readFileSync("src/app/local/page.tsx", "utf8");
  assert(!/no API key/.test(local) && !/until Supabase is connected/.test(local),
    "local mode: the page explains what is unavailable without naming infrastructure");
}

/** the vocabulary must stay a real list, not an empty object that would pass vacuously */
function findJargonVocabulary(): Record<string, string> {
  const src = readFileSync("scripts/jargon-audit.mjs", "utf8");
  const start = src.indexOf("export const JARGON = {");
  const end = src.indexOf("};", start);
  const body = src.slice(start, end);
  const terms = [...body.matchAll(/"([^"]+)":/g)].map((m) => m[1]);
  return Object.fromEntries(terms.map((t) => [t, ""]));
}
