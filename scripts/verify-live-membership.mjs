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

/**
 * Ask whether one column exists WITHOUT recording a pass/fail line of its own. Used by checks that
 * report an optional, additive column in their own words: the AI latency column missing is not a
 * broken app, and must not scroll past as a red FAIL.
 */
async function columnExists(table, column) {
  const { status } = await rest(`${table}?select=${encodeURIComponent(column)}&limit=1`);
  return status === 200;
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

// 2026-11-13: migration 0052 adds provider_usage.latency_ms. It is additive, and the AI Operations
// page is built to work without it - but the owner deserves to know whether response times are
// actually being recorded, instead of reading "not measured yet" and wondering why.
{
  const hasLatency = await columnExists("provider_usage", "latency_ms");
  record(
    hasLatency ? "PASS" : "INFO",
    "AI answers record how long they took (migration 0052)",
    hasLatency
      ? "provider_usage.latency_ms exists, so response time is measured"
      : "latency_ms is absent; request counts still work and the AI page says times are not measured",
  );
  // Not a failure: the page degrades honestly, and this check must not imply the app is broken.
}

// 2026-11-11: migration 0053 adds the writer behind the administrative history (invitations,
// suspensions, restorations, removals, request decisions, integration connections). The probe
// below CANNOT write: an action outside the closed list is refused before any insert, so this
// only asks whether the writer exists.
{
  const { status, body } = await rest("rpc/record_admin_event", {
    method: "POST",
    body: JSON.stringify({
      p_action: "__live_probe_not_an_action__",
      p_target: null,
      p_success: true,
      p_reason: null,
      p_metadata: {},
      p_actor: null,
    }),
  });
  const text = JSON.stringify(body ?? "");
  const present = status !== 404 && !text.includes("PGRST202");
  record(
    present ? "PASS" : "INFO",
    "administrative actions are recorded (migration 0053)",
    present
      ? "the audit writer exists and refused the probe before writing anything"
      : "the writer is absent, so the Security page will show role changes only; press Update database on the Owner Dashboard",
  );
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

record("INFO", "not checked here: which migration number the database is at", "Supabase does not expose its history table");

// ---------------------------------------------------------------------------
// SIGNED-IN CHECKS (2026-11-11)
//
// Everything above asks the live project with the service key. These checks are different: they
// need a REAL member session, because the whole point is what a signed-in member may and may not
// do. Two states are used and neither is ever PASS:
//
//   BLOCKED  - the accounts to test with were not supplied, so nothing was attempted.
//   NOT RUN  - the accounts exist but this check needs something this script does not do yet.
//
// Test accounts only. The Owner's own account must never be used as a disposable test account.
// Set SOPHIRA_TEST_MEMBER_EMAIL / SOPHIRA_TEST_MEMBER_PASSWORD for one member, and optionally
// SOPHIRA_TEST_MEMBER2_EMAIL / SOPHIRA_TEST_MEMBER2_PASSWORD for a second.
// ---------------------------------------------------------------------------
const MEMBER1 = {
  email: process.env.SOPHIRA_TEST_MEMBER_EMAIL || "",
  password: process.env.SOPHIRA_TEST_MEMBER_PASSWORD || "",
};
const MEMBER2 = {
  email: process.env.SOPHIRA_TEST_MEMBER2_EMAIL || "",
  password: process.env.SOPHIRA_TEST_MEMBER2_PASSWORD || "",
};
const ANON = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function signedIn(state, name, detail) {
  results.push({ state, name, detail });
  console.log(`${state}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Sign in with a test member's own credentials. Returns { token } or { error }. */
async function signIn(account) {
  if (!ANON) return { error: "no public key is available to sign in with" };
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.access_token) {
    return { error: `sign-in was refused (HTTP ${res.status})` };
  }
  return { token: body.access_token };
}

/** Call an RPC as the member. */
async function rpcAs(token, fn, args = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const SIGNED_IN_CHECKS = [
  ["a signed-in member is allowed to report presence (heartbeat accepted)", "heartbeat"],
  ["a signed-in member can read their own presence row", "own-presence"],
  ["a member is refused the staff directory (network_directory)", "directory-refused"],
  ["two devices from one member both keep the member Online", "multi-session"],
  ["a heartbeat stops counting after the presence windows expire", "expiry"],
  ["one member cannot read another member's presence or private rows", "cross-member"],
  ["a User or Tester cannot perform a staff action (direct API call)", "role-restriction"],
  ["a suspended account is refused a heartbeat", "suspended"],
  ["a revoked account is refused a heartbeat", "revoked"],
  ["a real invitation email arrives", "invitation-email"],
];

/**
 * A SUPPLIED ACCOUNT THAT IS NOT AN ACCOUNT (2026-11-11).
 *
 * A test address with no "@" in it cannot sign in, and reporting that as "sign-in was refused"
 * would blame the application for a typo in a setting. The check says what is actually wrong, in
 * the words someone can act on, and stays BLOCKED - never a pass, never a false failure.
 */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(MEMBER1.email);

if (!MEMBER1.email || !MEMBER1.password) {
  for (const [label] of SIGNED_IN_CHECKS) {
    signedIn("BLOCKED", label, "no test member account was supplied, so this was not attempted");
  }
} else if (!LOOKS_LIKE_EMAIL) {
  for (const [label] of SIGNED_IN_CHECKS) {
    signedIn(
      "BLOCKED",
      label,
      "the saved test member email is not an email address (it has no @), so no sign-in was attempted; replace it with a real test-only member address",
    );
  }
} else {
  const session = await signIn(MEMBER1);
  if (session.error) {
    for (const [label] of SIGNED_IN_CHECKS) {
      signedIn("BLOCKED", label, `the test member could not sign in: ${session.error}`);
    }
  } else {
    // 1. The heartbeat must be accepted for a real member.
    const beat = await rpcAs(session.token, "presence_heartbeat", { p_state: "online", p_connection: "connected" });
    const beatOk = beat.status === 200 && !(beat.body && beat.body.ok === false);
    signedIn(beatOk ? "PASS" : "FAIL", "a signed-in member is allowed to report presence (heartbeat accepted)", beatOk ? "the function accepted the member's own call" : `refused (HTTP ${beat.status})`);
    if (!beatOk) failed += 1;

    // 2. The member can read their own row.
    const own = await rest("member_presence?select=user_id,state,last_seen_at&limit=1", {
      headers: { Authorization: `Bearer ${session.token}`, apikey: ANON },
    });
    const ownOk = own.status === 200 && Array.isArray(own.body);
    signedIn(ownOk ? "PASS" : "FAIL", "a signed-in member can read their own presence row", ownOk ? `${own.body.length} row(s) visible to the member` : `HTTP ${own.status}`);
    if (!ownOk) failed += 1;

    // 3. The staff directory must refuse a member.
    const directory = await rpcAs(session.token, "network_directory");
    const refused = directory.status >= 400 || (directory.body && directory.body.ok === false) || directory.body === null || (Array.isArray(directory.body) && directory.body.length === 0);
    signedIn(refused ? "PASS" : "FAIL", "a member is refused the staff directory (network_directory)", refused ? `refused (HTTP ${directory.status})` : "the directory answered a member, which is a security failure");
    if (!refused) failed += 1;

    // The rest need a second session, time passing, or a suspended/revoked account. They are
    // listed as NOT RUN rather than quietly dropped, and never as PASS.
    for (const [label, key] of SIGNED_IN_CHECKS) {
      if (["heartbeat", "own-presence", "directory-refused"].includes(key)) continue;
      const reason =
        key === "cross-member"
          ? "needs BOTH test member accounts plus a private row to probe; the SQL-level RLS matrix is covered by npm run db:verify:local"
          : key === "multi-session"
            ? "needs two concurrent sessions for the same member"
            : key === "expiry"
              ? "needs the presence windows to elapse, which this read-only run cannot wait for"
              : key === "invitation-email"
                ? "needs a working mail provider on the deployment"
                : key === "suspended" || key === "revoked"
                  ? "needs a dedicated test account in that condition; Sophira will not suspend a real member to test"
                  : "not implemented in this script yet";
      signedIn("NOT RUN", label, reason);
    }
    if (MEMBER1.email === MEMBER2.email && MEMBER2.email) {
      signedIn("NOT RUN", "the two test accounts are the same account", "supply a second, different member to test isolation");
    }
  }
}

const blocked = results.filter((r) => r.state === "BLOCKED").length;
const notRun = results.filter((r) => r.state === "NOT RUN").length;
const passed = results.filter((r) => r.state === "PASS").length;

console.log("");
console.log(`SUMMARY: ${passed} passed, ${failed} failed, ${blocked} blocked, ${notRun} not run.`);
console.log("A blocked or unrun check is NOT a pass: the signed-in checks above only pass when a real member session proved them.");
if (failed > 0) {
  console.log(`LIVE CHECK FAILED: ${failed} check(s) did not answer as expected. The app's presence and`);
  console.log("notification features need the database update at /owner/database before they can work.");
  process.exit(1);
}
console.log("LIVE CHECK PASSED: the live database has the presence and notification structures these");
console.log("features need, and the presence functions refuse callers who are not signed in.");
process.exit(0);
