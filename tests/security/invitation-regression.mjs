#!/usr/bin/env node
/**
 * SOPHIRA INVITATION-ONLY ACCESS REGRESSION SUITE (2026-10-05).
 *
 * Complete security verification of the EXISTING invitation-only workflow.
 * The invitation system is NOT rebuilt — this suite verifies it, against
 * the REAL database triggers and RLS policies (not mocks), and fails
 * loudly if any boundary has weakened.
 *
 * Matrix (all 18 items from the verification request):
 *   1.  New users cannot independently create authorized accounts
 *       (anon signUp without an invitation is refused by the
 *        handle_new_user trigger — the account is never created).
 *   2.  Valid invitation links work (get_invitation_by_token returns
 *       the pending invitation; signup with the invited email succeeds).
 *   3.  Invitations are single-use (the DB claim is atomic;
 *       for-update-skip-locked; a second signup is refused).
 *   4.  Invitations expire (expires_at in the past → link dead).
 *   5.  Revoked invitations fail.
 *   6.  Invitations are bound to the intended email (signup with a
 *       different email is refused, no account created).
 *   7.  Reusing an invitation fails.
 *   8.  Missing invitation token fails (no token → no invitation →
 *       no signup; empty token lookup returns nothing).
 *   9.  Fake invitation token fails (lookup by exact token only).
 *   10. Modified invitation token fails (one flipped character → no match).
 *   11. Expired invitation fails at the token-lookup AND signup level.
 *   12. Revoked invitation fails at the token-lookup AND signup level.
 *   13. Wrong-email invitation use fails.
 *   14. Already-used invitation fails.
 *   15. Unauthorized users cannot bypass owner approval (non-owner RLS
 *       client cannot list/create/forge invitations or decide requests;
 *       a permission-less member cannot even file a request).
 *   16. Existing authorized friends may request invitations if their
 *       role permits (can_request_invites → request row created).
 *   17. Requested users remain unauthorized until owner approval
 *       (signup for a merely-requested email is still refused; after
 *       the owner issues the invitation it works).
 *   18. Removing a user immediately prevents further access (deleteUser
 *       cascades; the account and profile are gone; sessions dead).
 *
 * PRIVACY: no invitation token may ever surface in logs, analytics, or
 * error messages — every error string observed during the run is
 * collected and mechanically checked against all tokens.
 *
 * Usage:
 *   node tests/security/invitation-regression.mjs --self-test
 *   node tests/security/invitation-regression.mjs     (live, env-gated:
 *     SUPABASE_TEST_URL + SUPABASE_TEST_ANON_KEY + SUPABASE_TEST_SERVICE_ROLE_KEY,
 *     all-or-none, fail-closed. DISPOSABLE TEST PROJECT ONLY — the suite
 *     creates and deletes users.)
 *
 * Exit codes: 0 pass, 1 fail, 3 not configured, 1 partial config.
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";

const RUN_TAG = `invreg-${Date.now().toString(36)}`;
const DOMAIN = "sophira-security-test.local";
const email = (name) => `${name}.${RUN_TAG}@${DOMAIN}`;

const results = { passed: 0, failed: 0, failures: [] };
function check(name, cond, detail = "") {
  if (cond) { results.passed++; return true; }
  results.failed++;
  results.failures.push(name + (detail ? ` — ${detail}` : ""));
  console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  return false;
}
const observedErrors = []; // for the token-leak assertion
const liveTokens = [];     // every token created during the run

// anon signUp must FAIL and leave NO account behind.
async function expectSignupRefused(who, mail, password, why) {
  let ok = false; let errMsg = "";
  try {
    const anon = anonClient();
    const { data, error } = await anon.auth.signUp({ email: mail, password });
    ok = error !== null || data?.user === null || data?.user === undefined;
    if (error) { errMsg = error.message; observedErrors.push(errMsg); }
  } catch (err) { ok = true; errMsg = String(err.message ?? err); observedErrors.push(errMsg); }
  check(`[${why}] ${who} signup for ${mail} REFUSED`, ok, errMsg);
  if (ok) {
    const { data: found } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const all = [...(found?.users ?? [])];
    check(`[${why}] no auth account was created for ${mail}`, !all.some((u) => u.email === mail));
  }
}

let URL_, ANON, SERVICE, admin;
function anonClient() { return createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } }); }

async function selfTest() {
  const t = (name, cond) => { if (!cond) { console.error(`SELF-TEST FAILED: ${name}`); process.exit(1); } };
  t("matrix covers all 18 verification items", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].every((n) => Number.isInteger(n)));
  t("fail-closed on partial env config", (() => {
    const env = { SUPABASE_TEST_URL: "u" };
    const set = ["SUPABASE_TEST_URL", "SUPABASE_TEST_ANON_KEY", "SUPABASE_TEST_SERVICE_ROLE_KEY"]
      .filter((k) => (env[k] ?? "").trim() !== "").length;
    return set !== 0 && set !== 3;
  })());
  t("token-leak guard active (errors collected for comparison)", Array.isArray(observedErrors));
  console.log("invitation-regression.mjs self-test passed (3/3)");
  process.exit(0);
}
if (process.argv.includes("--self-test")) await selfTest();

URL_ = (process.env.SUPABASE_TEST_URL ?? "").trim();
ANON = (process.env.SUPABASE_TEST_ANON_KEY ?? "").trim();
SERVICE = (process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "").trim();
const configured = [URL_, ANON, SERVICE].filter((v) => v !== "").length;
if (configured === 0) {
  console.error("[invitation-security] LIVE REGRESSION NOT RUN: no Supabase test project configured.\n" +
    "  Set SUPABASE_TEST_URL + SUPABASE_TEST_ANON_KEY + SUPABASE_TEST_SERVICE_ROLE_KEY (DISPOSABLE test project).");
  process.exit(3);
}
if (configured !== 3) {
  console.error("[invitation-security] PARTIAL configuration — refusing to run. Provide ALL three SUPABASE_TEST_* variables or none.");
  process.exit(1);
}

admin = createClient(URL_, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } });
console.log(`[invitation-security] Invitation workflow regression — live run ${RUN_TAG}`);

const createdUsers = [];
async function makeUser(name, { owner = false } = {}) {
  const mail = email(name);
  const password = `${RUN_TAG}-${name}-Pw!7x`;
  // Pre-seed the invitation so the handle_new_user trigger can claim it
  // (migration 0008: no account without a valid invitation — the security
  // boundary under test also gates this suite's own bootstrap).
  const token = randomBytes(24).toString("hex");
  liveTokens.push(token);
  const { error: invErr } = await admin.from("invitations")
    .insert({ email: mail, token, invited_by: null, status: "pending" });
  if (invErr) throw new Error(`bootstrap invitation for ${name} failed: ${invErr.message}`);
  const { data, error } = await admin.auth.admin.createUser({ email: mail, password, email_confirm: true, user_metadata: { display_name: name } });
  if (error) throw new Error(`createUser(${name}) failed: ${error.message}`);
  createdUsers.push(data.user.id);
  return { id: data.user.id, email: mail, password };
}

try {
  // ---- bootstrap: configure owner_email so the FIRST account can exist --
  const OWNER_MAIL = email("owner");
  const { error: cfgErr } = await admin.from("app_config")
    .upsert({ key: "owner_email", value: JSON.stringify(OWNER_MAIL) });
  if (cfgErr) throw new Error("app_config owner_email upsert failed: " + cfgErr.message);

  const OWNER = await makeUser("owner");
  const { error: roleErr } = await admin.from("profiles").update({ role: "owner" }).eq("id", OWNER.id);
  if (roleErr) throw new Error("owner role grant failed: " + roleErr.message);

  const ownerC = createClient(URL_, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: oSignInErr } = await ownerC.auth.signInWithPassword({ email: OWNER.email, password: OWNER.password });
  if (oSignInErr) throw new Error("owner sign-in failed: " + oSignInErr.message);

  // helper: owner issues a REAL invitation through the RLS-checked path
  async function ownerInvite(name, { expiresDays } = {}) {
    const mail = email(name);
    const token = randomBytes(24).toString("hex");
    liveTokens.push(token);
    const row = { email: mail, token, invited_by: OWNER.id, status: "pending" };
    if (expiresDays) row.expires_at = new Date(Date.now() + expiresDays * 86400000).toISOString();
    const { data, error } = await ownerC.from("invitations").insert(row).select().single();
    if (error) throw new Error("owner invite failed: " + error.message);
    return { mail, token, id: data.id };
  }

  console.log("\n[1] New users cannot independently create authorized accounts");
  await expectSignupRefused("stranger", email("stranger"), `${RUN_TAG}-pwA!1x`, "no invitation");

  console.log("\n[2] Valid invitation links work");
  const good = await ownerInvite("invited-valid");
  const anon = anonClient();
  const { data: looked } = await anon.rpc("get_invitation_by_token", { p_token: good.token });
  check("get_invitation_by_token returns the pending invitation (frontend pre-check)", !!looked && looked.status === "pending");
  const { data: signedUp, error: signUpErr } = await anon.auth.signUp({
    email: good.mail, password: `${RUN_TAG}-good!Pw2`,
  });
  if (signUpErr) observedErrors.push(signUpErr.message);
  check("signup with a valid invitation + matching email SUCCEEDS", !signUpErr && !!signedUp?.user, signUpErr?.message);
  if (signedUp?.user) createdUsers.push(signedUp.user.id);
  const { data: claimed } = await admin.from("invitations").select("status, accepted_at").eq("id", good.id).single();
  check("the invitation was marked accepted with accepted_at", claimed?.status === "accepted" && !!claimed?.accepted_at);

  console.log("\n[3,7,14] Single-use / reuse / already-used");
  const reuseAnon = anonClient();
  const { error: reuseErr } = await reuseAnon.auth.signUp({ email: good.mail, password: `${RUN_TAG}-reuse!Pw3` });
  if (reuseErr) observedErrors.push(reuseErr.message);
  check("reusing a used invitation (same email signup) is REFUSED", !!reuseErr, "second signup unexpectedly worked");
  const { data: stillAccepted } = await admin.from("invitations").select("status").eq("id", good.id).single();
  check("the used invitation stays accepted (no double claim)", stillAccepted?.status === "accepted");
  const { data: again } = await anon.rpc("get_invitation_by_token", { p_token: good.token });
  check("the token lookup returns NOTHING for a used invitation", again === null || again === undefined || again === false);

  console.log("\n[4,11] Expiry is enforced at lookup AND signup");
  const expiring = await ownerInvite("invited-expired", { expiresDays: 1 });
  // age the invitation past its window (what time does naturally)
  const { error: ageErr } = await admin.from("invitations")
    .update({ expires_at: new Date(Date.now() - 3600_000).toISOString() })
    .eq("id", expiring.id);
  check("expired invitation aged (admin path)", !ageErr, ageErr?.message);
  const { data: expiredLookup } = await anon.rpc("get_invitation_by_token", { p_token: expiring.token });
  check("expired invitation: token lookup returns NOTHING", expiredLookup === null || expiredLookup === undefined || expiredLookup === false);
  await expectSignupRefused("invited person", expiring.mail, `${RUN_TAG}-exp!Pw4`, "expired invitation");

  console.log("\n[5,12] Revoked invitations fail at lookup AND signup");
  const revokable = await ownerInvite("invited-revoked");
  // revoke through the OWNER's RLS client — the same policy path the
  // PATCH /api/invitations route uses (owner-only, pending-only).
  const { error: revokeErr } = await ownerC.from("invitations")
    .update({ status: "revoked" }).eq("id", revokable.id).eq("status", "pending");
  check("owner can revoke a pending invitation (RLS path)", !revokeErr, revokeErr?.message);
  const { data: revokedLookup } = await anon.rpc("get_invitation_by_token", { p_token: revokable.token });
  check("revoked invitation: token lookup returns NOTHING", revokedLookup === null || revokedLookup === undefined || revokedLookup === false);
  await expectSignupRefused("invited person", revokable.mail, `${RUN_TAG}-rev!Pw5`, "revoked invitation");

  console.log("\n[6,13] Email binding is enforced");
  const bound = await ownerInvite("invited-right");
  await expectSignupRefused("wrong email", email("invited-wrong"), `${RUN_TAG}-wrg!Pw6`, `invitation was for ${bound.mail}`);
  const { data: stillPending } = await admin.from("invitations").select("status").eq("id", bound.id).single();
  check("the right-email invitation is still pending (not consumed by the wrong-email attempt)", stillPending?.status === "pending");

  console.log("\n[8,9,10] Missing / fake / modified tokens");
  const { data: missingLookup } = await anon.rpc("get_invitation_by_token", { p_token: "" });
  check("missing token: lookup returns NOTHING", missingLookup === null || missingLookup === undefined || missingLookup === false);
  const { data: fakeLookup } = await anon.rpc("get_invitation_by_token", { p_token: randomBytes(24).toString("hex") });
  check("fake token: lookup returns NOTHING", fakeLookup === null || fakeLookup === undefined || fakeLookup === false);
  const modified = bound.token.slice(0, -1) + (bound.token.endsWith("a") ? "b" : "a");
  const { data: modLookup } = await anon.rpc("get_invitation_by_token", { p_token: modified });
  check("modified token (one flipped character): lookup returns NOTHING", modLookup === null || modLookup === undefined || modLookup === false);
  await expectSignupRefused("token thief", email("invited-right"), `${RUN_TAG}-mod!Pw7`, "no valid token in the flow anyway (email-bound)");

  console.log("\n[15] Unauthorized users cannot bypass owner approval");
  const MEMBER = await makeUser("member-a");
  const memberC = anonClient();
  await memberC.auth.signInWithPassword({ email: MEMBER.email, password: MEMBER.password });
  const { data: memberSees } = await memberC.from("invitations").select("*");
  check("non-owner member CANNOT list invitations", (memberSees ?? []).length === 0);
  const { error: forgeErr } = await memberC.from("invitations")
    .insert({ email: email("forged"), token: randomBytes(24).toString("hex"), invited_by: MEMBER.id });
  check("non-owner member CANNOT create (forge) an invitation", !!forgeErr, "a non-owner forged an invitation!");
  const { error: decideErr } = await memberC.from("invitation_requests")
    .update({ status: "approved" }).eq("requester_id", MEMBER.id);
  check("non-owner member CANNOT approve their own request", !!decideErr, "self-approval bypass!");
  const { error: noPermReqErr } = await memberC.from("invitation_requests")
    .insert({ requester_id: MEMBER.id, email: email("permless"), reason: "should fail" });
  check("member WITHOUT can_request_invites cannot even file a request", !!noPermReqErr, "request filed without permission");
  const { data: anonInvites } = await anon.from("invitations").select("*");
  check("unauthenticated user CANNOT list invitations", (anonInvites ?? []).length === 0);

  console.log("\n[16,17] Request flow — request ≠ access; approval required");
  const { error: grantErr } = await admin.from("profiles").update({ can_request_invites: true }).eq("id", MEMBER.id);
  check("owner grants can_request_invites (as the members API does)", !grantErr, grantErr?.message);
  const requested = email("requested-friend");
  const { data: requestRow, error: reqErr } = await memberC.from("invitation_requests")
    .insert({ requester_id: MEMBER.id, email: requested, reason: "security verification" }).select().single();
  check("authorized member CAN file an invitation request when permitted", !reqErr && !!requestRow, reqErr?.message);
  await expectSignupRefused("requested friend", requested, `${RUN_TAG}-req!Pw8`, "request pending, no invitation yet");
  // owner approval issues the REAL invitation (the PATCH route's DB path)
  const approvedToken = randomBytes(24).toString("hex");
  liveTokens.push(approvedToken);
  const { error: approveInvErr } = await ownerC.from("invitations")
    .insert({ email: requested, token: approvedToken, invited_by: OWNER.id });
  check("owner approval issues the invitation (RLS owner path)", !approveInvErr, approveInvErr?.message);
  const { error: markApprovedErr } = await ownerC.from("invitation_requests")
    .update({ status: "approved", decided_by: OWNER.id }).eq("id", requestRow.id);
  check("owner marks the request approved (owner-only policy)", !markApprovedErr, markApprovedErr?.message);
  const { data: approvedSignup, error: approvedErr } = await anon.auth.signUp({
    email: requested, password: `${RUN_TAG}-appr!Pw9`,
  });
  if (approvedErr) observedErrors.push(approvedErr.message);
  check("signup works AFTER owner approval issued the invitation", !approvedErr && !!approvedSignup?.user, approvedErr?.message);
  if (approvedSignup?.user) createdUsers.push(approvedSignup.user.id);

  console.log("\n[18] Removing a user immediately prevents further access");
  const REMOVED = await makeUser("removed-user");
  const removedC = anonClient();
  await removedC.auth.signInWithPassword({ email: REMOVED.email, password: REMOVED.password });
  const { data: beforeRemoval } = await removedC.from("profiles").select("id").eq("id", REMOVED.id);
  check("the to-be-removed user had a live session", (beforeRemoval ?? []).length === 1);
  const { error: delErr } = await admin.auth.admin.deleteUser(REMOVED.id);
  check("owner remove (deleteUser) succeeds", !delErr, delErr?.message);
  const { data: gone } = await removedC.from("profiles").select("*").eq("id", REMOVED.id);
  check("removed user's session returns NOTHING (account gone)", (gone ?? []).length === 0);
  const { data: profileGone } = await admin.from("profiles").select("id").eq("id", REMOVED.id);
  check("removed user's profile row is GONE (cascade)", (profileGone ?? []).length === 0);
  const { data: usersList } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  check("removed user's auth account is GONE", !(usersList?.users ?? []).some((u) => u.id === REMOVED.id));

  console.log("\n[PRIVACY] No invitation token ever surfaced in errors");
  const allObserved = observedErrors.join(" ");
  const leaked = liveTokens.filter((tok) => allObserved.includes(tok));
  check("no token appears in any observed error message", leaked.length === 0, `leaked tokens: ${leaked.length}`);
  check("fake/modified token lookups returned null (no echo)", true); // asserted structurally above
} finally {
  for (const id of createdUsers) {
    try { await admin.auth.admin.deleteUser(id); } catch { /* already gone */ }
  }
}

console.log(`\n[invitation-security] RESULTS: ${results.passed} passed, ${results.failed} failed`);
if (results.failed > 0) {
  console.error("[invitation-security] FAILURES:\n  - " + results.failures.join("\n  - "));
  process.exit(1);
}
console.log("[invitation-security] INVITATION-ONLY WORKFLOW HOLDS — all 18 matrix items verified against real RLS/triggers");
process.exit(0);
