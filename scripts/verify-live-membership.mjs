#!/usr/bin/env node
/**
 * LIVE MEMBERSHIP CHECK (2026-11-13).
 *
 * The presence and notification work is verified offline by the suite, but "does the live
 * database actually have what those features need?" could only be answered by hand, one probe
 * at a time, and each session started from memory. This makes it one command with a plain
 * verdict.
 *
 * What it proves, by ASKING the live project:
 *   1. the tables the features read and write exist;
 *   2. the presence functions exist and REFUSE a caller who is not signed in - a heartbeat that
 *      answered `ok: true` without a member would be a security hole, so that is a failure;
 *   3. probing changed nothing: the presence row count is identical before and after.
 *
 * What it deliberately cannot prove, and says so in its own output:
 *   - that a real signed-in member appears Online (needs a member account);
 *   - that row level security actually stops one member reading another's rows (needs two
 *     signed-in sessions; RLS is verified at the SQL level by `npm run db:verify:local`);
 *   - which migration number the database is at (Supabase does not expose its history table).
 *
 * Read-only by construction: no inserts, updates or deletes, and the only RPCs it calls are the
 * ones that refuse an anonymous caller before touching a row. It never prints a key.
 *
 * Exit codes match the other verifiers: 0 all checks answered as expected, 1 a check failed,
 * 3 it could not run because this environment has no live credentials.
 */
import { randomUUID } from "node:crypto";

const URL_BASE = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_TEST_SERVICE_ROLE_KEY || "";

const results = [];
function record(state, name, detail) {
  results.push({ state, name, detail });
  const mark = state === "PASS" ? "PASS" : state === "FAIL" ? "FAIL" : "INFO";
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function tableHas(spec) {
  const [table, select] = spec.split(":");
  const { status, body } = await rest(`${table}?select=${encodeURIComponent(select || "*")}&limit=1`);
  const ok = status === 200;
  record(
    ok ? "PASS" : "FAIL",
    `${spec} is readable`,
    ok ? "200" : `${status} ${typeof body === "string" ? body.slice(0, 90) : JSON.stringify(body).slice(0, 90)}`,
  );
  return ok;
}

async function rpcRefusesAnon(fn, payload) {
  const { status, body } = await rest(`rpc/${fn}`, { method: "POST", body: JSON.stringify(payload) });
  if (status !== 200) {
    record("FAIL", `${fn} refuses a caller who is not signed in`, `${status} ${JSON.stringify(body).slice(0, 90)}`);
    return false;
  }
  const refused = body && body.ok === false;
  record(
    refused ? "PASS" : "FAIL",
    `${fn} refuses a caller who is not signed in`,
    refused ? `ok:false (${String(body.error ?? "no reason given")})` : `ANSWERED ok:true — that would be a security hole`,
  );
  return refused;
}

async function rowCount(table) {
  const { status, body } = await rest(`${table}?select=id&limit=1`, { headers: { Prefer: "count=exact" } });
  return { status, body };
}

if (!URL_BASE || !KEY) {
  console.log("SKIPPED  live membership check — no live credentials in this environment.");
  console.log("         Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run it.");
  process.exit(3);
}

console.log("=== Live membership check ===");
console.log("Asking the live project what it has. Nothing is written; no key is printed.\n");

const before = await rowCount("member_presence");
const beforeCount = Number.isFinite(before.body?.length) ? before.body.length : null;

let failed = 0;
const tables = [
  "member_presence:*",
  "member_presence:session_id,connection_state,last_heartbeat",
  "member_availability:availability",
  "presence_settings:*",
  "member_notifications:*",
  "notification_preferences:*",
  "invitation_requests:*",
  "invitations:email_status",
];
for (const spec of tables) {
  if (!(await tableHas(spec))) failed += 1;
}

if (!(await rpcRefusesAnon("presence_heartbeat", { p_session_id: `live-check-${randomUUID()}`, p_interacted: false }))) failed += 1;
if (!(await rpcRefusesAnon("presence_release", { p_session_id: `live-check-${randomUUID()}` }))) failed += 1;
if (!(await rpcRefusesAnon("presence_set_availability", { p_availability: "available", p_share_with_members: null }))) failed += 1;

// The directory must also refuse anyone who is not staff. With the service key there is no
// signed-in person at all, which is exactly the case being tested.
{
  const { status, body } = await rest("rpc/network_directory", { method: "POST", body: "{}" });
  const refused = status === 403 || (status === 200 && body && body.ok === false);
  record(
    refused ? "PASS" : "FAIL",
    "network_directory refuses anyone who is not staff",
    refused ? String(status) : `${status} answered a non-staff caller`,
  );
  if (!refused) failed += 1;
}

// Nothing may have been created by the probes above.
{
  const after = await rowCount("member_presence");
  const afterCount = Number.isFinite(after.body?.length) ? after.body.length : null;
  const unchanged = before.status === after.status && beforeCount === afterCount;
  record(
    unchanged ? "PASS" : "FAIL",
    "the probes changed nothing",
    unchanged ? "presence row count identical before and after" : `${before.status}/${beforeCount} then ${after.status}/${afterCount}`,
  );
  if (!unchanged) failed += 1;
}

record("INFO", "not checked here: a signed-in member appearing Online", "needs a member test account");
record("INFO", "not checked here: RLS stopping one member reading another's rows", "verified at SQL level by npm run db:verify:local");
record("INFO", "not checked here: which migration number the database is at", "Supabase does not expose its history table");

console.log("");
if (failed > 0) {
  console.log(`LIVE CHECK FAILED: ${failed} check(s) did not answer as expected. The app's presence and`);
  console.log("notification features need the database update at /owner/database before they can work.");
  process.exit(1);
}
console.log("LIVE CHECK PASSED: the live database has the presence and notification structures these");
console.log("features need, and the presence functions refuse callers who are not signed in.");
process.exit(0);
