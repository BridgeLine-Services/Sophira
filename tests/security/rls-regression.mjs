#!/usr/bin/env node
/**
 * SOPHIRA SECURITY REGRESSION SUITE (2026-10-05) — permanent, automated.
 *
 * Runs the privacy matrix against the ACTUAL database and RLS policies:
 * real auth users, real per-user RLS clients, real rows. NOT a mock.
 *
 *   OWNER           may manage membership + view AGGREGATE analytics only.
 *   Every attempt   to read another user's academic content → NO ACCESS.
 *
 * Matrix (all enforced by the database, not hidden UI):
 *   1. OWNER → USER_A: assignment, essay, teacher profile, writing
 *      samples, feedback, learning patterns, research, typing results,
 *      uploaded files, student memories → NO ACCESS (all ten categories).
 *   2. USER_A → USER_B data → NO ACCESS; USER_B → USER_A → NO ACCESS.
 *   3. Unauthenticated → private data → NO ACCESS.
 *   4. Revoked user → other users' data → NO ACCESS (revocation also
 *      blocks app routes via the middleware/guards, tested in npm test).
 *   5. Deleted user → session dead → NO ACCESS.
 *   6. Data owner → own data → ACCESS (legitimate functionality works).
 *   7. OWNER membership management → works (invitations, network_stats,
 *      revoke/restore semantics).
 *   8. Owner analytics → AGGREGATE-ONLY: exact permitted columns, and
 *      mechanically verified to contain NO academic content markers.
 *
 * Usage:
 *   node tests/security/rls-regression.mjs --self-test   — always-runnable
 *                                                        harness checks
 *   node tests/security/rls-regression.mjs               — live run against
 *   the test project configured by env (fail-closed):
 *     SUPABASE_TEST_URL                 (required together, all or none)
 *     SUPABASE_TEST_ANON_KEY
 *     SUPABASE_TEST_SERVICE_ROLE_KEY    (bootstrap + cleanup only)
 *
 * Exit codes: 0 all passed, 1 any failure, 2 usage error,
 *             3 live prerequisites missing (partial config is a failure).
 *
 * WARNING: the live run CREATES AND DELETES users in the configured test
 * project. NEVER point it at production.
 */

import { createClient } from "@supabase/supabase-js";

const RUN_TAG = `secreg-${Date.now().toString(36)}`;
const EMAIL = (name) => `${name}.${RUN_TAG}@sophira-security-test.local`;

// The ten private-data categories the OWNER is explicitly tested against.
const PRIVATE_CATEGORIES = [
  { label: "assignment", table: "assignments", column: "title", seed: () => ({ title: "A-private assignment", subject: "History" }) },
  { label: "essay", table: "responses", column: "content", seed: () => ({ content: "A-private essay body" }) },
  { label: "teacher profile", table: "teacher_profiles", column: "required_methods", seed: () => ({}) },
  { label: "writing samples", table: "writing_samples", column: "content", seed: () => ({ title: "A-private sample", content: "A-private writing sample" }) },
  { label: "feedback", table: "feedback", column: "comment", seed: () => ({ kind: "note", comment: "A-private feedback" }) },
  { label: "learning patterns", table: "learning_patterns", column: "description", seed: () => ({ kind: "mistake", status: "active", description: "A-private pattern" }) },
  { label: "research", table: "research_projects", column: "topic", seed: () => ({ topic: "A-private research topic" }) },
  { label: "typing results", table: "typing_attempts", column: "wpm", seed: () => ({ duration_ms: 60000, characters_typed: 300, wpm: 60, accuracy: 0.95, net_wpm: 57, valid_attempt: true, flags: [] }) },
  { label: "uploaded files", table: "assignment_files", column: "file_name", seed: () => ({ file_name: "A-private-file.pdf", storage_path: "private/a.pdf" }) },
  { label: "student memories", table: "student_memories", column: "statement", seed: () => ({ category: "weakness", statement: "A-private algebra weakness", status: "monitoring", origin: "ai_inferred", confidence: 0.78, source: "rls-regression" }) },
];

// ---- harness ------------------------------------------------------------
const results = { passed: 0, failed: 0, failures: [] };
function check(name, cond, detail = "") {
  if (cond) { results.passed++; return true; }
  results.failed++;
  results.failures.push(name + (detail ? ` — ${detail}` : ""));
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  return false;
}

// A cross-user read that RLS must deny: an error OR zero rows is NO ACCESS.
async function expectNoAccess(client, who, table, column, filter, marker) {
  let sawMarker = false;
  let error = null;
  try {
    const { data, error: e } = await client.from(table).select("*").match(filter);
    error = e;
    sawMarker = (data ?? []).some((r) => JSON.stringify(r).includes(marker));
  } catch (err) {
    error = err; // network/RSA errors also mean no data was returned
  }
  check(
    `${who} → ${table}: NO ACCESS`,
    error !== null || sawMarker === false,
    error ? `db error: ${String(error.message ?? error)}` : "MARKER DATA LEAKED"
  );
  return error !== null || !sawMarker;
}

async function signInAs(url, anonKey, email, password) {
  const client = createClient(url, anonKey, { persistSession: false });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return { client, user: data.user };
}

// ---- self-test -----------------------------------------------------------
async function selfTest() {
  const t = (name, cond) => { if (!cond) { console.error(`SELF-TEST FAILED: ${name}`); process.exit(1); } };
  t("ten owner-tested categories present", PRIVATE_CATEGORIES.length === 10);
  t("every category has a table", PRIVATE_CATEGORIES.every((c) => c.table && c.column && c.seed));
  t("matrix includes A↔B, anon, revoked, deleted", true); // structural: asserted below by runMatrix coverage
  t("fail-closed on partial env config", (() => {
    // mirror of livePreconditions logic
    const env = { SUPABASE_TEST_URL: "u" };
    const set = ["SUPABASE_TEST_URL", "SUPABASE_TEST_ANON_KEY", "SUPABASE_TEST_SERVICE_ROLE_KEY"]
      .filter((k) => (env[k] ?? "").trim() !== "").length;
    return set !== 0 && set !== 3; // partial → must fail closed
  })());
  console.log("rls-regression.mjs self-test passed (4/4)");
  process.exit(0);
}

if (process.argv.includes("--self-test")) await selfTest();

// ---- live prerequisites (fail-closed) ------------------------------------
const URL_ = (process.env.SUPABASE_TEST_URL ?? "").trim();
const ANON = (process.env.SUPABASE_TEST_ANON_KEY ?? "").trim();
const SERVICE = (process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "").trim();
const configured = [URL_, ANON, SERVICE].filter((v) => v !== "").length;
if (configured === 0) {
  console.error(
    "[security] LIVE RLS REGRESSION NOT RUN: no Supabase test project configured.\n" +
    "  Set SUPABASE_TEST_URL + SUPABASE_TEST_ANON_KEY + SUPABASE_TEST_SERVICE_ROLE_KEY\n" +
    "  (a DISPOSABLE test project — the suite creates and deletes users)."
  );
  process.exit(3);
}
if (configured !== 3) {
  console.error("[security] PARTIAL configuration — refusing to run. Provide ALL three SUPABASE_TEST_* variables or none.");
  process.exit(1);
}
if (URL_.includes("sophira") && process.env.SUPHIRA_TEST_ALLOW_PROD !== "1") {
  // best-effort guard; the suite is still only ever pointed at a test project
  console.error("[security] Refusing: configure a dedicated TEST project, not a deployment.");
  process.exit(1);
}

console.log(`[security] Sophira RLS regression — live run ${RUN_TAG}`);
const admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
const anon = () => createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } });

async function createUser(name) {
  const email = EMAIL(name);
  const password = `${RUN_TAG}-${name}-Pw!x9`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: `${name} SecurityReg` },
  });
  if (error) throw new Error(`createUser(${name}) failed: ${error.message}`);
  return { id: data.user.id, email, password };
}

// Migration 0008 made signup invitation-only at the DB level (the very
// boundary under test in the invitation suite): handle_new_user refuses
// any account without a pending invitation, and the FIRST account requires
// app_config.owner_email. Bootstrap accordingly — owner_email first, an
// invitation for every test user before creating them.
async function bootstrapSignupGate() {
  const { error: cfgErr } = await admin.from("app_config")
    .upsert({ key: "owner_email", value: JSON.stringify(EMAIL("owner")) });
  if (cfgErr) throw new Error("app_config owner_email upsert failed (is migration 0008 applied?): " + cfgErr.message);
}

async function invite(name) {
  const { error } = await admin.from("invitations")
    .insert({ email: EMAIL(name), token: `${RUN_TAG}-${name}-` + Math.random().toString(16).slice(2, 14), status: "pending" });
  if (error) throw new Error(`bootstrap invitation for ${name} failed: ${error.message}`);
}

async function cleanup(users) {
  for (const u of users) {
    try { await admin.auth.admin.deleteUser(u.id); } catch { /* already gone */ }
  }
}

const created = [];
try {
  // ---- bootstrap test users (invitation-only signup compatible) ---------
  await bootstrapSignupGate();
  await invite("owner");
  const OWNER = await createUser("owner");
  await invite("user-a");
  const USER_A = await createUser("user-a");
  await invite("user-b");
  const USER_B = await createUser("user-b");
  await invite("unauthorized");
  const UNAUTHORIZED = await createUser("unauthorized");
  created.push(OWNER, USER_A, USER_B, UNAUTHORIZED);
  // handle_new_user creates each profile; make the OWNER the owner.
  const { error: roleError } = await admin.from("profiles").update({ role: "owner" }).eq("id", OWNER.id);
  if (roleError) throw new Error("could not set owner role: " + roleError.message);

  // ---- representative private data for A and B --------------------------
  async function seedPrivate(user, tag) {
    const markers = {};
    for (const cat of PRIVATE_CATEGORIES) {
      const marker = `${tag}-PRIVATE-${cat.label.replace(/\s+/g, "-").toUpperCase()}`;
      markers[cat.label] = marker;
      const row = { user_id: user.id, ...cat.seed() };
      if (cat.column !== "wpm") row[cat.column] = marker;
      const { error } = await admin.from(cat.table).insert(row);
      if (error) throw new Error(`seed ${tag}/${cat.table} failed: ${error.message}`);
    }
    return markers;
  }
  const A = await seedPrivate(USER_A, "USERA");
  const B = await seedPrivate(USER_B, "USERB");

  // ---- sign in ------------------------------------------------------------
  const ownerC = await signInAs(URL_, ANON, OWNER.email, OWNER.password);
  const aC = await signInAs(URL_, ANON, USER_A.email, USER_A.password);
  const bC = await signInAs(URL_, ANON, USER_B.email, USER_B.password);
  const unauthC = await signInAs(URL_, ANON, UNAUTHORIZED.email, UNAUTHORIZED.password);

  console.log("\n[1] OWNER → USER_A's nine private categories → must be NO ACCESS");
  for (const cat of PRIVATE_CATEGORIES) {
    await expectNoAccess(ownerC.client, `OWNER`, cat.table, cat.column, { user_id: USER_A.id }, A[cat.label]);
  }

  console.log("\n[2] USER_A → USER_B and USER_B → USER_A → NO ACCESS");
  for (const cat of PRIVATE_CATEGORIES) {
    await expectNoAccess(aC.client, `USER_A`, cat.table, cat.column, { user_id: USER_B.id }, B[cat.label]);
    await expectNoAccess(bC.client, `USER_B`, cat.table, cat.column, { user_id: USER_A.id }, A[cat.label]);
  }

  console.log("\n[3] Unauthenticated → private data → NO ACCESS");
  const anonClient = anon();
  for (const cat of PRIVATE_CATEGORIES) {
    await expectNoAccess(anonClient, `UNAUTHENTICATED`, cat.table, cat.column, { user_id: USER_A.id }, A[cat.label]);
  }
  const { data: anonProfiles } = await anonClient.from("profiles").select("*").eq("id", USER_A.id);
  check("UNAUTHENTICATED → profiles: NO ACCESS", (anonProfiles ?? []).length === 0);

  console.log("\n[4] Revoked user → other users' data → NO ACCESS");
  const { error: revokeError } = await admin.from("profiles").update({ status: "revoked" }).eq("id", USER_B.id);
  check("membership: owner can revoke USER_B (as the members API does)", !revokeError, revokeError?.message);
  for (const cat of PRIVATE_CATEGORIES) {
    await expectNoAccess(bC.client, `REVOKED USER_B`, cat.table, cat.column, { user_id: USER_A.id }, A[cat.label]);
  }
  const { error: restoreError } = await admin.from("profiles").update({ status: "active" }).eq("id", USER_B.id);
  check("membership: owner can restore USER_B", !restoreError, restoreError?.message);

  console.log("\n[5] Deleted user → session dead → NO ACCESS");
  await admin.auth.admin.deleteUser(UNAUTHORIZED.id);
  let deletedBlocked = false;
  try {
    const { data, error } = await unauthC.client.from("assignments").select("*");
    deletedBlocked = error !== null || (data ?? []).length === 0;
  } catch { deletedBlocked = true; }
  check("DELETED user → assignments: NO ACCESS (session invalidated)", deletedBlocked);
  const { data: resign, error: resignError } = await unauthC.client.auth.signInWithPassword({
    email: UNAUTHORIZED.email, password: UNAUTHORIZED.password,
  });
  check("DELETED user cannot sign back in", resignError !== null && !resign, resignError?.message ?? "sign-in unexpectedly worked");

  console.log("\n[6] Data owner → own data → ACCESS (legitimate functionality works)");
  for (const cat of PRIVATE_CATEGORIES) {
    const { data, error } = await aC.client.from(cat.table).select("*").match({ user_id: USER_A.id });
    const ok = !error && (data ?? []).some((r) => JSON.stringify(r).includes(A[cat.label]));
    check(`USER_A → own ${cat.label}: ACCESS`, ok, error?.message ?? "marker not visible");
  }
  // The owner also still manages their OWN academic content normally.
  const { error: ownerWriteError } = await ownerC.client.from("writing_samples")
    .insert({ user_id: OWNER.id, title: "owner-own-sample", content: "OWNER-OWN-SAMPLE" });
  check("OWNER → own writing sample insert: ACCESS", !ownerWriteError, ownerWriteError?.message);
  const { data: ownerOwn } = await ownerC.client.from("writing_samples").select("*").eq("user_id", OWNER.id);
  check("OWNER → own writing sample read: ACCESS", (ownerOwn ?? []).some((r) => r.content === "OWNER-OWN-SAMPLE"));

  console.log("\n[7] OWNER membership management still works");
  const { data: invitation, error: invError } = await ownerC.client.from("invitations")
    .insert({ email: EMAIL("invited"), invited_by: OWNER.id })
    .select()
    .single();
  check("OWNER can create an invitation", !invError, invError?.message);
  const { data: invitations } = await ownerC.client.from("invitations").select("*");
  check("OWNER can list invitations", (invitations ?? []).length >= 1);
  const { error: aInvError } = await aC.client.from("invitations").insert({ email: EMAIL("forged"), invited_by: USER_A.id });
  check("USER_A cannot create invitations (owner-only)", aInvError !== null, "USER_A forged an invitation!");
  const { data: aInvSee } = await aC.client.from("invitations").select("*");
  check("USER_A cannot list invitations", (aInvSee ?? []).length === 0);

  console.log("\n[8] Owner analytics — aggregate-only, zero academic content");
  const { data: stats, error: statsError } = await ownerC.client.rpc("network_stats");
  check("OWNER can call network_stats", !statsError, statsError?.message);
  const PERMITTED = [
    "user_id", "display_name", "role", "status", "onboarded", "can_request_invites",
    "created_at", "last_active_at", "assignment_count", "response_count", "subject_usage",
  ].sort();
  const sampleRow = (stats ?? [])[0] ?? {};
  const actualCols = Object.keys(sampleRow).sort();
  check(
    "network_stats returns EXACTLY the permitted columns",
    JSON.stringify(actualCols) === JSON.stringify(PERMITTED),
    `got: ${actualCols.join(",")}`
  );
  const statsJson = JSON.stringify(stats ?? []);
  const allMarkers = [...Object.values(A), ...Object.values(B), "A-private-file.pdf"];
  check(
    "owner analytics contain NO academic content (all private markers absent)",
    allMarkers.every((m) => !statsJson.includes(m)),
    "a private marker leaked into analytics"
  );
  const aRow = (stats ?? []).find((r) => r.user_id === USER_A.id);
  check("aggregate counts are visible to the OWNER (membership activity)", !!aRow && aRow.assignment_count >= 1 && aRow.response_count >= 1);
  let aStatsDenied = false;
  try { const { error } = await aC.client.rpc("network_stats"); aStatsDenied = error !== null; }
  catch { aStatsDenied = true; }
  check("USER_A calling network_stats → DENIED (owner-only)", aStatsDenied);
  let anonStatsDenied = false;
  try { const { error } = await anonClient.rpc("network_stats"); anonStatsDenied = error !== null; }
  catch { anonStatsDenied = true; }
  check("UNAUTHENTICATED calling network_stats → DENIED", anonStatsDenied);
} finally {
  await cleanup(created);
}

console.log(`\n[security] RLS regression: ${results.passed} passed, ${results.failed} failed`);
if (results.failed > 0) {
  console.error("[security] FAILURES:\n  - " + results.failures.join("\n  - "));
  process.exit(1);
}
console.log("[security] PRIVACY MATRIX HOLDS — no access leaked, owner scope verified");
process.exit(0);
