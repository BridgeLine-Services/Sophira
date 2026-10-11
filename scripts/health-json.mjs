#!/usr/bin/env node
/**
 * SOPHIRA HEALTH-JSON ADAPTER (2026-10-11) — thin adapter for the owner
 * System Health view. It runs the SINGLE authoritative release gate
 * (scripts/release-gate.mjs, fast report mode) and converts its stable,
 * self-test-pinned report text into JSON. It never invents checks: if the
 * report cannot be parsed, it fails loudly instead of guessing.
 */
import { spawnSync } from "node:child_process";

const r = spawnSync("node", ["scripts/release-gate.mjs", "--fast", "--report"], {
  encoding: "utf8",
  timeout: 300000,
  maxBuffer: 32 * 1024 * 1024,
});
if (r.error) {
  console.error("The release gate could not be started: " + r.error.message);
  process.exit(2);
}
const out = (r.stdout || "") + (r.stderr || "");
const checks = [];
let current = null;
for (const line of out.split("\n")) {
  const m = line.match(/^\[[\u2713\u2717]\]\s+(PASS|FAIL|BLOCKED|NOT RUN)\s+(.+?)\s*$/);
  if (m) {
    if (current) checks.push(current);
    current = { id: checks.length + 1, name: m[2], status: m[1], detail: "" };
  } else if (current && /^\s{2,}\S/.test(line)) {
    current.detail = (current.detail ? current.detail + " " : "") + line.trim();
  }
}
if (current) checks.push(current);
const ts = out.match(/SOPHIRA RELEASE GATE — (\S+)/);
const totals = out.match(/TOTAL:\s*(\d+)\s+PASS:\s*(\d+)\s+FAIL:\s*(\d+)\s+BLOCKED:\s*(\d+)\s+NOT RUN:\s*(\d+)/);
if (checks.length === 0 || !totals || Number(totals[1]) !== checks.length) {
  console.error("The release gate report could not be parsed or did not match its own totals. Refusing to invent a result.");
  process.exit(3);
}
const count = (s) => checks.filter((c) => c.status === s).length;
const computed = { total: checks.length, pass: count("PASS"), fail: count("FAIL"), blocked: count("BLOCKED"), not_run: count("NOT RUN") };
const consistent =
  computed.total === Number(totals[1]) &&
  computed.pass === Number(totals[2]) &&
  computed.fail === Number(totals[3]) &&
  computed.blocked === Number(totals[4]) &&
  computed.not_run === Number(totals[5]);
console.log(JSON.stringify({
  generated_at: ts ? ts[1] : new Date().toISOString(),
  consistency_verified: consistent,
  checks,
  counts: computed,
}));
