#!/usr/bin/env node
/**
 * MEMBER PRESERVATION CHECK (2026-11-02).
 *
 * Answers one question with evidence: after a redeploy, rebuild, migration, or restore,
 * are the members and invitations that existed before still there, unchanged?
 *
 * Usage:
 *   node scripts/member-preservation.mjs --save before.json
 *   ... deploy / migrate ...
 *   node scripts/member-preservation.mjs --compare before.json
 *
 * It needs a database it is allowed to read (SERVICE_ROLE) and prints NO personal data:
 * counts, and ids shortened to 8 characters for comparison only.
 */
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

const URL_BASE = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SAVE = arg("save");
const COMPARE = arg("compare");
const ACK = arg("acknowledge-removed")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
const ACK_RECORDS = arg("acknowledge-removed-records")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
const SELF_TEST = args.includes("--self-test");

/**
 * PERSISTENT RECORD CENSUS (2026-11-03).
 *
 * This check used to look at members and invitations only, so a migration or restore that
 * emptied assignments, notebooks or research would have reported "preserved" - those records
 * are exactly as permanent as the member list, and the standing requirement covers them.
 *
 * The census counts rows in every user-data table. Setup state (app_config, sophira_meta,
 * owner_bootstrap) is deliberately NOT counted: copying those between deployments is the
 * mistake that creates two owners, not the goal.
 */
const CENSUS_TABLES = [
  "profiles", "invitations", "invitation_requests",
  "teachers", "teacher_profiles", "courses", "workload_selections",
  "assignments", "assignment_files", "rubric_audits", "feedback",
  "writing_samples", "writing_profiles", "essay_sessions", "responses",
  "notebooks", "notebook_sources", "notebook_notes", "notebook_questions",
  "notebook_artifacts", "notebook_evidence", "study_materials",
  "research_projects", "research_sources", "research_claims", "research_citations",
  "research_queries", "research_verifications", "academic_sources",
  "learning_patterns", "student_memories", "student_memory_evidence",
  "document_history", "provider_connections", "subject_preferences",
  "typing_attempts", "typing_profiles", "work_schedules", "work_sessions",
  "schedule_executions", "member_notifications", "notification_preferences",
  "canvas_courses", "canvas_assignments", "canvas_sync_events",
  "profile_versions", "profile_update_proposals",
];

/**
 * Tables that lost rows, or vanished entirely. Pure, so it can be exercised without a database
 * (see --self-test): a comparison that is only ever run against a healthy database proves nothing.
 */
const censusLosses = (before, now, acknowledged = []) => {
  const losses = [];
  for (const [table, was] of Object.entries(before ?? {})) {
    const is = (now ?? {})[table];
    if (acknowledged.includes(table)) continue;
    if (is === undefined || is === null) losses.push({ table, was, now: "missing" });
    else if (Number(is) < Number(was)) losses.push({ table, was, now: is });
  }
  return losses;
};

const fail = (message) => {
  console.log(`\n  ${message}\n`);
  process.exit(1);
};

/**
 * Offline self-test: proves the census comparison actually detects loss, without a database.
 * The cases that must be IGNORED matter as much as the ones that must be caught - a check that
 * shouts about ordinary growth is a check the owner learns to ignore.
 */
if (SELF_TEST) {
  const cases = [
    ["a table losing rows is a loss", { assignments: 9, notebooks: 3 }, { assignments: 4, notebooks: 3 }, [], ["assignments"]],
    ["a table that vanished is a loss", { research_sources: 12 }, {}, [], ["research_sources"]],
    ["a table emptied to zero is a loss", { feedback: 5 }, { feedback: 0 }, [], ["feedback"]],
    ["growth is not a loss", { notebooks: 2 }, { notebooks: 40 }, [], []],
    ["an unchanged count is not a loss", { courses: 4 }, { courses: 4 }, [], []],
    ["an acknowledged deletion is not a loss", { essays: 5 }, { essays: 1 }, ["essays"], []],
    ["a brand-new table is not a loss", {}, { student_memories: 7 }, [], []],
    ["one lost table among many is still reported", { a: 2, b: 9, c: 1 }, { a: 2, b: 8, c: 1 }, [], ["b"]],
  ];
  let bad = 0;
  let caught = 0;
  for (const [name, before, now, ack, want] of cases) {
    const got = censusLosses(before, now, ack).map((l) => l.table);
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) { bad++; console.log(`  FAIL  ${name}: got [${got}], want [${want}]`); }
    if (ok && want.length > 0) caught++;
  }
  console.log(`\n  preservation self-test: ${bad === 0 ? "PASS" : "FAIL"} ` +
    `(${caught} planted losses detected, ${cases.length - caught} legitimate changes correctly ignored)`);
  process.exit(bad === 0 ? 0 : 1);
}

if (!URL_BASE || !KEY) {
  fail("CANNOT VERIFY: this check needs the database address and service key.\n" +
       "  Run it where the owner's deployment settings are available. Nothing was checked.");
}

const get = async (path) => {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json();
};

const short = (id) => String(id).slice(0, 8);

/** Exact row count for one table, read from PostgREST's content-range, never from the rows. */
const countOf = async (table) => {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=id&limit=1`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact" },
    signal: AbortSignal.timeout(20000),
  });
  // 404 = the table does not exist in this database. That is a finding, not an error to swallow.
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${table} responded ${res.status}`);
  const total = (res.headers.get("content-range") ?? "").split("/")[1];
  if (total === undefined || total === "*") throw new Error(`${table} returned no row count`);
  return Number(total);
};

let profiles, invitations, records;
try {
  [profiles, invitations] = await Promise.all([
    get("profiles?select=id,status,role,email&limit=5000"),
    get("invitations?select=id,status,email&limit=5000"),
  ]);
  const counted = await Promise.all(CENSUS_TABLES.map(async (t) => [t, await countOf(t)]));
  records = Object.fromEntries(counted.filter(([, n]) => n !== null));
} catch (error) {
  fail(`CANNOT VERIFY: ${error.message}. Nothing was checked.`);
}

const byStatus = profiles.reduce((acc, p) => ({ ...acc, [p.status ?? "unknown"]: (acc[p.status ?? "unknown"] ?? 0) + 1 }), {});
const outstanding = invitations.filter((i) => !["accepted", "revoked", "expired"].includes(String(i.status)));

// Duplicate identities: two member records sharing one email is how a reinstatement goes
// wrong and how one person ends up with two histories.
const emails = new Map();
for (const p of profiles) {
  const email = String(p.email ?? "").trim().toLowerCase();
  if (!email) continue;
  emails.set(email, [...(emails.get(email) ?? []), short(p.id)]);
}
const duplicates = [...emails.entries()].filter(([, ids]) => ids.length > 1);
const withoutEmail = profiles.filter((p) => !String(p.email ?? "").trim()).length;

const snapshot = {
  takenAt: new Date().toISOString(),
  members: { total: profiles.length, byStatus, ids: profiles.map((p) => short(p.id)).sort() },
  invitations: { total: invitations.length, outstanding: outstanding.length, ids: invitations.map((i) => short(i.id)).sort() },
  records,
};

console.log("\n  Members:", profiles.length, JSON.stringify(byStatus));
console.log("  Outstanding invitations:", outstanding.length, `(of ${invitations.length} total)`);
console.log("  Members with no email on file:", withoutEmail, "(valid records; identity is their account, not an address)");
console.log("  Duplicate identities:", duplicates.length === 0 ? "none" : duplicates.map(([e]) => e.replace(/(.{2}).*(@.*)/, "$1***$2")).join(", "));
const recordTotal = Object.values(records).reduce((a, b) => a + Number(b), 0);
console.log(`  Records across ${Object.keys(records).length} data tables:`, recordTotal);

let problems = 0;
if (duplicates.length > 0) {
  console.log("  PROBLEM: two member records share an email. Reinstatement must reuse the existing identity.");
  problems++;
}

if (COMPARE) {
  const before = JSON.parse(readFileSync(COMPARE, "utf8"));
  const now = new Set(snapshot.members.ids);
  const gone = before.members.ids.filter((id) => !now.has(id));
  const added = snapshot.members.ids.filter((id) => !before.members.ids.includes(id));
  const nowInv = new Set(snapshot.invitations.ids);
  const lostInvitations = before.invitations.ids.filter((id) => !nowInv.has(id));

  // A snapshot taken before the census existed has no records block; say so instead of
  // pretending the comparison covered them.
  const losses = censusLosses(before.records, records, ACK_RECORDS);
  const grew = Object.entries(records).filter(([t, n]) => before.records?.[t] !== undefined && Number(n) > Number(before.records[t]));

  console.log(`\n  Compared with snapshot from ${before.takenAt}`);
  console.log("  Members added:", added.length, "| Members missing:", gone.length, "| Invitations lost:", lostInvitations.length);
  if (before.records === undefined) {
    console.log("  Records: the earlier snapshot predates the record census, so record counts were NOT compared.");
  } else {
    console.log(`  Tables that lost rows: ${losses.length === 0 ? "none" : losses.map((l) => `${l.table} ${l.was}->${l.now}`).join(", ")}`);
    console.log("  Tables that grew:", grew.length === 0 ? "none" : grew.map(([t]) => t).join(", "));
  }

  // Losing a member or an invitation is exactly what this requirement forbids. An
  // intentional removal must be named explicitly with --acknowledge-removed.
  const unacknowledged = gone.filter((id) => !ACK.includes(id));
  if (unacknowledged.length > 0) {
    console.log(`  PROBLEM: ${unacknowledged.length} member(s) disappeared: ${unacknowledged.join(", ")}`);
    problems++;
  }
  if (lostInvitations.length > 0) {
    console.log(`  PROBLEM: ${lostInvitations.length} invitation(s) disappeared: ${lostInvitations.join(", ")}`);
    problems++;
  }
  // Losing records is the same class of failure as losing a member: both are permanent data the
  // requirement says must survive. A deliberate deletion must be named with
  // --acknowledge-removed-records <table>.
  if (losses.length > 0) {
    console.log(`  PROBLEM: ${losses.length} data table(s) lost rows: ${losses.map((l) => `${l.table} (${l.was} -> ${l.now})`).join(", ")}`);
    problems++;
  }
  if (problems === 0) console.log("  Members and invitations preserved.");
}

if (SAVE) {
  writeFileSync(SAVE, JSON.stringify(snapshot, null, 2));
  console.log(`\n  Snapshot written to ${SAVE}. Re-run with --compare ${SAVE} after deploying.`);
}

console.log(problems === 0 ? "\n  PASS\n" : "\n  FAIL\n");
process.exit(problems === 0 ? 0 : 1);
