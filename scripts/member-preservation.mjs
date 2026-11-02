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

const fail = (message) => {
  console.log(`\n  ${message}\n`);
  process.exit(1);
};

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

let profiles, invitations;
try {
  [profiles, invitations] = await Promise.all([
    get("profiles?select=id,status,role,email&limit=5000"),
    get("invitations?select=id,status,email&limit=5000"),
  ]);
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
};

console.log("\n  Members:", profiles.length, JSON.stringify(byStatus));
console.log("  Outstanding invitations:", outstanding.length, `(of ${invitations.length} total)`);
console.log("  Members with no email on file:", withoutEmail, "(valid records; identity is their account, not an address)");
console.log("  Duplicate identities:", duplicates.length === 0 ? "none" : duplicates.map(([e]) => e.replace(/(.{2}).*(@.*)/, "$1***$2")).join(", "));

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

  console.log(`\n  Compared with snapshot from ${before.takenAt}`);
  console.log("  Members added:", added.length, "| Members missing:", gone.length, "| Invitations lost:", lostInvitations.length);

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
  if (problems === 0) console.log("  Members and invitations preserved.");
}

if (SAVE) {
  writeFileSync(SAVE, JSON.stringify(snapshot, null, 2));
  console.log(`\n  Snapshot written to ${SAVE}. Re-run with --compare ${SAVE} after deploying.`);
}

console.log(problems === 0 ? "\n  PASS\n" : "\n  FAIL\n");
process.exit(problems === 0 ? 0 : 1);
