#!/usr/bin/env node
/**
 * PLAIN-LANGUAGE AUDIT FOR STUDENT SCREENS (2026-11-13, directive Part 12).
 *
 * "Do not expose technical implementation details to students" is easy to state and easy to
 * break, because the text a student reads is buried inside TSX. This extracts the text a
 * student can actually SEE (JSX text nodes and the string props that render), then reports
 * any term that belongs to engineering rather than to a person.
 *
 * It deliberately does NOT scan:
 *   - owner/co-owner/tester/setup screens, where technical wording is appropriate;
 *   - comments (an engineer may name internals in a comment);
 *   - code identifiers, request bodies and query strings (not visible).
 *
 * Usage:  node scripts/jargon-audit.mjs             report
 *         node scripts/jargon-audit.mjs --json      machine-readable findings
 *         node scripts/jargon-audit.mjs --selftest  machine-readable extractor checks
 * Exit 0 always; tests/jargon.ts decides what is a failure, so this stays a reporting tool.
 * The self-test exists because a clean report from a broken scanner is worse than none.
 */
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";

const ROOT = "src/app";
const STAFF = ["/owner/", "/co-owner/", "/tester/", "/setup", "/admin/", "/api/"];

/** term -> why it is wrong for a student */
export const JARGON = {
  "Row Level Security": "a database policy name",
  "RLS": "a database policy acronym",
  "Supabase": "an infrastructure vendor",
  "SM-2": "a scheduling algorithm name",
  "interval_days": "a column name",
  "ease factor": "an algorithm term",
  "payload": "an engineering term",
  "JSON": "a data format",
  "endpoint": "an architecture term",
  "API": "an architecture term",
  "schema": "a database term",
  "migration": "a database term",
  "PGRST": "a Postgres error code",
  "postgres": "a database product",
  "SQL": "a database language",
  "localhost": "a developer address",
  "TypeError": "a programming error",
  "undefined": "a programming value",
  "stack trace": "a developer artefact",
  "env var": "a configuration term",
};

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(tsx|ts)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

/** The text a student can see, per file. */
export function visibleText(src) {
  let s = src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/^\s*import[^\n]*$/gm, " ");
  const out = [];
  // JSX text nodes: >text<  (no braces, no tags)
  for (const m of s.matchAll(/>([^<>{}]+)</g)) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  // strings passed to props/labels that render
  const VISIBLE_PROP = /\b(title|description|subtitle|label|placeholder|message|heading|note|helper|emptyTitle|emptyDescription|aria-label|alt)\s*=\s*["']([^"']+)["']/g;
  for (const m of s.matchAll(VISIBLE_PROP)) out.push(m[2]);
  // string literals that are plainly sentences shown to a person
  const SENTENCE = /["']([A-Z][^"'\\\n]{18,})["']/g;
  for (const m of s.matchAll(SENTENCE)) {
    const t = m[1];
    if (/^(use |import |use client)/.test(t)) continue;
    if (/^[A-Z_]+$/.test(t)) continue;
    out.push(t);
  }
  return out;
}

export function audit() {
  const findings = [];
  for (const file of files(ROOT)) {
    const rel = relative(process.cwd(), file).replaceAll("\\", "/");
    if (STAFF.some((p) => `/${rel}`.includes(p))) continue;
    for (const text of visibleText(readFileSync(file, "utf8"))) {
      for (const [term, why] of Object.entries(JARGON)) {
        const re = new RegExp(`(^|[^A-Za-z])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`);
        if (re.test(text)) findings.push({ file: rel, term, why, text: text.slice(0, 120) });
      }
    }
  }
  return findings;
}

/** Proves the extractor sees real screen text, ignores comments, and still catches leaks. */
function selfTest() {
  const checks = [];
  const add = (name, ok) => checks.push({ name, ok });
  const commented = `
    /** we read Supabase RLS here - a comment, never shown to a student */
    export function Card() {
      return <p>Your work is saved.</p>;
    }`;
  const seen = visibleText(commented);
  add("real screen text is extracted", seen.some((t) => t.includes("Your work is saved")));
  add("a comment naming an internal is not student-facing", !seen.some((t) => /Supabase|RLS/.test(t)));
  const leaked = visibleText(`export const X = () => <p>Saved to Supabase.</p>;`);
  add("a real leak would be flagged", leaked.some((t) => /Supabase/.test(t)));
  const prop = visibleText(`export const Y = () => <Button label="Download JSON" />;`);
  add("visible prop strings are read", prop.some((t) => /JSON/.test(t)));
  return checks;
}

if (process.argv[1] && process.argv[1].endsWith("jargon-audit.mjs")) {
  if (process.argv.includes("--selftest")) {
    console.log(JSON.stringify(selfTest(), null, 2));
    process.exit(0);
  }
  const findings = audit();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(findings, null, 2));
  } else {
    for (const f of findings) console.log(`${f.file}: "${f.term}" (${f.why}) — ${f.text}`);
    console.log(`jargon: ${findings.length} finding(s)`);
  }
}
