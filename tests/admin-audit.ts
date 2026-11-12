import { readFileSync } from "fs";
import {
  ADMIN_ACTIONS,
  AUDIT_METADATA_KEYS,
  adminActionLabel,
  describeAdminEvent,
  isAdminAction,
  providerLabel,
  sanitizeAuditMetadata,
  type AdminActionValue,
} from "../src/lib/owner/admin-audit";
import { describeAuditEntry, parseAuditFilters, RECORDED_ACTIONS } from "../src/lib/owner/audit-page";

/**
 * THE ADMINISTRATIVE HISTORY (2026-11-11).
 *
 * The owner's requirement was simple and hard: "an administrative action must be recorded whether
 * or not the member is told, and the record must not be forgeable from a browser." These tests pin
 * the parts that can be checked without a live database:
 *
 *   - the vocabulary in the code and the vocabulary in the migration cannot drift apart;
 *   - every route that records an event uses a category from that vocabulary;
 *   - metadata cannot carry a secret, whatever a caller passes;
 *   - a refusal reads as a refusal, and a delivery that did not happen is never described as sent;
 *   - the table stays append-only, and no signed-in role can write to it or call its writer.
 */

const read = (path: string): string => readFileSync(path, "utf8");

const MIGRATION = "supabase/migrations/0053_admin_audit_events.sql";
const ROLES_MIGRATION = "supabase/migrations/0048_membership_roles.sql";
const MEMBERS_ROUTE = "src/app/api/network/members/route.ts";
const INVITATIONS_ROUTE = "src/app/api/invitations/route.ts";
const ACCEPT_ROUTE = "src/app/api/invitations/accept/route.ts";
const REQUESTS_ROUTE = "src/app/api/invitation-requests/route.ts";
const CONNECTIONS = "src/lib/integrations/connections.ts";

export function runAdminAuditTests(assert: (cond: boolean, msg: string) => void, section: (t: string) => void) {
  const sql = read(MIGRATION);
  const rolesSql = read(ROLES_MIGRATION);

  section("Administrative history: one vocabulary, in the code and in the database");

  const vocabularyInSql = [...sql.matchAll(/^\s*'([a-z_]+)',?$/gm)].map((m) => m[1]);
  const actionBlock = sql.slice(sql.indexOf("v_actions text[]"), sql.indexOf("v_keys text[]"));
  const actionsInMigration = [...actionBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const actionsInCode = ADMIN_ACTIONS.map((a) => a.value);

  assert(actionsInMigration.length >= 13,
    `audit: the migration lists the recorded actions (found ${actionsInMigration.length})`);
  for (const action of actionsInMigration) {
    assert(actionsInCode.includes(action as AdminActionValue),
      `audit: "${action}" is recordable in the database and therefore described in the code`);
  }
  for (const action of actionsInCode) {
    if (action === "set_role") {
      assert(!actionsInMigration.includes(action),
        "audit: role changes keep their OWN writer from 0048 and were not moved into the new function");
      continue;
    }
    assert(actionsInMigration.includes(action),
      `audit: "${action}" is described in the code and is also accepted by the database, not only one of them`);
  }
  assert(vocabularyInSql.length > 0, "audit: the closed-vocabulary list was found at all");

  const keysInMigration = [...sql.slice(sql.indexOf("v_keys text[]"), sql.indexOf("v_actor uuid;"))
    .matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert(keysInMigration.length === AUDIT_METADATA_KEYS.length,
    `audit: the code and the database keep the same number of metadata keys (${keysInMigration.length} vs ${AUDIT_METADATA_KEYS.length})`);
  for (const key of AUDIT_METADATA_KEYS) {
    assert(keysInMigration.includes(key), `audit: metadata key "${key}" is kept by both the code and the database`);
  }

  assert(isAdminAction("set_role") && isAdminAction("invitation_accepted"),
    "audit: known categories are recognised");
  assert(!isAdminAction("delete_everything") && !isAdminAction("") && !isAdminAction(null),
    "audit: invented categories are refused before they reach the database");
  assert(adminActionLabel("invitation_delivery") === "Invitation email",
    "audit: the filter offers a plain name, not a database word");
  assert(adminActionLabel("custom_thing") === "custom thing",
    "audit: an unknown value degrades to readable words rather than printing an underscore");

  section("Administrative history: every route records a category the database accepts");

  const routeFiles = [MEMBERS_ROUTE, INVITATIONS_ROUTE, ACCEPT_ROUTE, REQUESTS_ROUTE, CONNECTIONS];
  let recordedSites = 0;
  for (const file of routeFiles) {
    const source = read(file);
    assert(source.includes("recordAdminEvent"),
      `audit: ${file} records its action instead of only performing it`);
    const used = [...source.matchAll(/action:\s*"([a-z_]+)"/g)].map((m) => m[1]);
    for (const action of used) {
      recordedSites += 1;
      assert(isAdminAction(action),
        `audit: ${file} records "${action}", which is in the closed vocabulary`);
    }
  }
  assert(recordedSites >= 9,
    `audit: the invitation, member and integration paths all record something (found ${recordedSites} sites)`);

  section("Administrative history: recorded AFTER the action, never before");

  const members = read(MEMBERS_ROUTE);
  assert(members.indexOf('action: "account_suspended"') > members.indexOf("const revokeSessions"),
    "audit: a suspension is recorded only after the status change and the session revocation were attempted");
  assert(members.indexOf('action: "member_removed"') > members.indexOf("auth.admin.deleteUser"),
    "audit: a removal is recorded only after the account was actually deleted");
  assert(members.indexOf('action: "account_restored"') > members.indexOf('status: "active", access_revoked_at: null'),
    "audit: a restoration is recorded only after the account was actually restored");
  assert(members.includes("success: false"),
    "audit: a refused attempt is recorded as refused instead of being silently dropped");
  assert(members.includes("member_label"),
    "audit: the member's name is captured before a removal, so the entry can still say who it was about");

  const accept = read(ACCEPT_ROUTE);
  assert(accept.indexOf('action: "invitation_accepted"') > accept.indexOf("if (!accepted)"),
    "audit: joining is recorded only for the acceptance that actually claimed the invitation");
  assert(accept.indexOf('action: "invitation_accepted"') > accept.indexOf("already_accepted"),
    "audit: the idempotent retry path stays above the record, so a repeat cannot produce a second entry");

  const invitations = read(INVITATIONS_ROUTE);
  assert(invitations.indexOf('action: "invitation_created"') > invitations.indexOf("const delivery = await deliverInvitation"),
    "audit: the invitation entry is written after delivery was attempted, so it can state the real outcome");
  assert(invitations.includes('emailResult.status !== "sent"'),
    "audit: a failed delivery gets its own refused entry rather than being folded into a success");
  assert(!/recordAdminEvent\([\s\S]{0,400}token:/.test(invitations) && !/recordAdminEvent\([\s\S]{0,400}link:/.test(invitations),
    "audit: no invitation token or working link is ever passed to the recorder");

  const connections = read(CONNECTIONS);
  assert(connections.includes('action: "integration_connected"') && connections.includes("if (!existing)"),
    "audit: a connection is recorded the first time only, so token refreshes do not bury the history");
  assert(connections.includes('action: "integration_disconnected"') && connections.includes("if (existing)"),
    "audit: a disconnect is recorded only when something was actually connected");

  section("Administrative history: metadata cannot carry a secret");

  const dirty = sanitizeAuditMetadata({
    provider: "google",
    value: true,
    password: "hunter2",
    token: "abc123",
    email: "someone@example.com",
    body: "the essay text",
    nested: { token: "abc" },
    list: ["a", "b"],
    delivery: "sent",
  });
  assert(Object.keys(dirty).sort().join(",") === "delivery,provider,value",
    "audit: only recognised keys survive, and an object or array never becomes a value");
  assert(dirty.value === "true", "audit: a boolean is stored as a readable word, not as JSON");
  assert(!("password" in dirty) && !("token" in dirty),
    "audit: a password or token passed by mistake is dropped, not truncated");
  assert(!JSON.stringify(dirty).includes("hunter2") && !JSON.stringify(dirty).includes("abc123"),
    "audit: no fragment of a dropped secret survives anywhere in the stored metadata");

  const long = sanitizeAuditMetadata({ channel: "x".repeat(500) });
  assert(long.channel.length === 120, "audit: a long value is truncated to the database's own limit");
  assert(Object.keys(sanitizeAuditMetadata({ a: "1", b: "2" })).length === 0,
    "audit: unknown keys are ignored rather than stored");
  assert(JSON.stringify(sanitizeAuditMetadata(null)) === "{}" && JSON.stringify(sanitizeAuditMetadata(undefined)) === "{}",
    "audit: missing metadata becomes an empty object, never a crash");

  section("Administrative history: one refusal, one honest sentence");

  const base = { actorName: "Alex", targetName: "Jordan", reason: null as string | null, metadata: {} as Record<string, string> };

  const refused = describeAdminEvent({ ...base, action: "account_suspended", success: false, reason: "A Co-Owner may not act on another Co-Owner." });
  assert(refused.startsWith("Alex tried to suspend Jordan's access."),
    "audit: a refused suspension says what was attempted, in the same words as a successful one");
  assert(refused.includes("Sophira refused it") && refused.includes("A Co-Owner may not act"),
    "audit: the refusal carries the server's own reason rather than a generic failure");

  assert(describeAdminEvent({ ...base, action: "account_suspended", success: true }).includes("can no longer sign in"),
    "audit: a suspension says what it means for the person");
  assert(describeAdminEvent({ ...base, action: "account_restored", success: true }).includes("can sign in again"),
    "audit: a restoration says what changed for the person");
  assert(describeAdminEvent({ ...base, action: "member_removed", success: true }).includes("along with their account"),
    "audit: a removal does not imply the person can still sign in");

  const granted = describeAdminEvent({ ...base, action: "invite_permission_changed", success: true, metadata: { value: "true" } });
  const withdrawn = describeAdminEvent({ ...base, action: "invite_permission_changed", success: true, metadata: { value: "false" } });
  assert(granted.includes("allowed Jordan to request invitations") && withdrawn.includes("stopped Jordan"),
    "audit: the invitation permission reads differently depending on which way it was changed");

  const sent = describeAdminEvent({ ...base, action: "invitation_created", success: true, metadata: { delivery: "sent", channels: "email" } });
  assert(sent.includes("The email was sent"), "audit: a provider-accepted send is described as sent");
  const unconfigured = describeAdminEvent({ ...base, action: "invitation_created", success: true, metadata: { delivery: "not_configured", channels: "email" } });
  assert(!unconfigured.toLowerCase().includes("email was sent") && unconfigured.includes("no mail provider"),
    "audit: an unconfigured provider is never described as a sent email");
  const failed = describeAdminEvent({ ...base, action: "invitation_created", success: true, reason: "the provider rejected it", metadata: { delivery: "failed", channels: "email" } });
  assert(failed.includes("could not be sent") && failed.includes("the provider rejected it"),
    "audit: a failed send carries the provider's own reason");
  const unknownOutcome = describeAdminEvent({ ...base, action: "invitation_created", success: true, metadata: { channels: "email" } });
  assert(unknownOutcome.includes("recorded separately"),
    "audit: an unknown delivery outcome is left unknown instead of being rounded up to success");

  const bothChannels = describeAdminEvent({ ...base, action: "invitation_created", success: true, metadata: { channels: "email+sms", delivery: "sent" } });
  assert(bothChannels.includes("email and text message"),
    "audit: an invitation sent two ways says so, because one channel is not the whole story");

  assert(describeAdminEvent({ ...base, action: "invitation_accepted", success: true }).startsWith("Jordan accepted"),
    "audit: joining is attributed to the person who joined, not to an administrator");

  assert(describeAdminEvent({ ...base, action: "integration_connected", success: true, metadata: { provider: "google" } }).includes("Google Drive"),
    "audit: a connection names the service in the words the settings page uses");
  assert(describeAdminEvent({ ...base, action: "integration_connected", success: true, metadata: { provider: "mystery" } }).includes("does not recognise"),
    "audit: an unrecognised service says so instead of printing a raw identifier");
  assert(providerLabel("canvas") === "Canvas" && providerLabel("") === null && providerLabel(null) === null,
    "audit: only real provider names get a label");

  const roleChange = describeAdminEvent({
    ...base, action: "set_role", success: true, metadata: {}, fromRole: "User", toRole: "Tester",
  });
  assert(roleChange === "Alex changed Jordan from User to Tester.",
    "audit: the existing role-change sentence is preserved exactly");

  for (const action of ADMIN_ACTIONS) {
    const sentence = describeAdminEvent({ ...base, action: action.value, success: true, metadata: { delivery: "sent", provider: "canvas", value: "true" }, fromRole: "User", toRole: "Tester" });
    assert(sentence.length > 20 && !sentence.includes("_"),
      `audit: "${action.value}" produces a real sentence with no database words in it ("${sentence}")`);
  }

  section("Administrative history: the page reads what was written");

  assert(RECORDED_ACTIONS.length === ADMIN_ACTIONS.length,
    "audit: the filter offers every category that can be written, and no category that cannot");
  assert(RECORDED_ACTIONS.some((a) => a.value === "invitation_created") && RECORDED_ACTIONS.some((a) => a.value === "account_restored"),
    "audit: the filter can find invitations and suspensions, not only role changes");

  const accepted = parseAuditFilters({ action: "invitation_accepted" });
  assert(accepted.action === "invitation_accepted", "audit: a real category survives filter parsing");
  const invented = parseAuditFilters({ action: "delete_database" });
  assert(invented.action === null, "audit: an invented category is dropped instead of matching nothing on purpose");
  assert(parseAuditFilters({ outcome: "refused" }).outcome === "refused",
    "audit: the refused-only filter still works");

  const removed = describeAuditEntry({
    id: "1", at: "2026-11-11T00:00:00.000Z", action: "member_removed", actorId: "a", targetId: "b",
    actorName: "Alex", targetName: "Someone no longer in your network",
    fromRole: "User", toRole: "User", success: true, reason: null,
    metadata: { member_label: "Jordan" },
  });
  assert(removed.includes("Jordan"),
    "audit: a removed member is still named from the label stored at the time, not lost forever");

  const roleEntry = describeAuditEntry({
    id: "2", at: "2026-11-11T00:00:00.000Z", action: "set_role", actorId: "a", targetId: "b",
    actorName: "Alex", targetName: "Jordan", fromRole: "Tester", toRole: "Co-Owner",
    success: false, reason: "Only an Owner may appoint a Co-Owner.", metadata: {},
  });
  assert(roleEntry.includes("from Tester to Co-Owner") && roleEntry.includes("Only an Owner may appoint"),
    "audit: existing role history still reads exactly as it did");

  section("Administrative history: append-only, and not reachable from a member's session");

  assert(/create or replace function public\.record_admin_event\(/.test(sql),
    "audit: the writer is a database function, so the rules live in the database");
  assert(/security definer/.test(sql) && /set search_path = public/.test(sql),
    "audit: the writer is SECURITY DEFINER with a pinned search_path, like the role function");
  assert(/revoke all on function public\.record_admin_event[\s\S]*from public, anon, authenticated/.test(sql),
    "audit: no signed-in role and no anonymous caller can execute the writer");
  assert(/grant execute on function public\.record_admin_event[\s\S]*to service_role/.test(sql),
    "audit: only the server's service role may execute it");
  assert(/revoke insert, update, delete on public\.membership_audit from anon, authenticated/.test(sql),
    "audit: the table's write grants are removed, not only its write policies");
  assert(/if not public\.is_staff\(\)/.test(sql),
    "audit: a signed-in caller who is not staff is refused even if grants were ever widened");
  assert(/interval '5 seconds'/.test(sql),
    "audit: an identical event written twice within moments is treated as a retry");

  assert(!/create policy[^;]*for (insert|update|delete|all) on public\.membership_audit/i.test(sql),
    "audit: this migration adds no write policy, so a browser still cannot insert its own history");
  assert(!/insert\s+into\s+public\.membership_audit/i.test(sql.replace(/insert into public\.membership_audit[\s\S]*?returning id into v_id;/, "")),
    "audit: the only INSERT in this file is the function's own, after every check");
  assert(!/create table/i.test(sql),
    "audit: no second audit table was created - the existing one was extended");
  assert(!/drop table/i.test(sql) && !/drop column/i.test(sql),
    "audit: nothing existing was dropped");
  assert(!/\b(password|passwd|secret|api_key|access_token|refresh_token)\b/i.test(sql.replace(/--.*$/gm, "")),
    "audit: the migration stores no credential column or value");

  assert(/create table if not exists public\.membership_audit/.test(rolesSql) &&
    /create policy membership_audit_staff_read/.test(rolesSql),
    "audit: the original table and its staff-only read policy are still the ones in place");
  assert(!/for (insert|update|all) on public\.membership_audit/i.test(rolesSql),
    "audit: the original migration still grants no write policy");

  // Reading: staff only in the database, Owner only on the page.
  const securityPage = read("src/app/owner/security/page.tsx");
  assert(securityPage.includes("requireOwnerPage"),
    "audit: the history page is still Owner-only");
  assert(/is_staff\(\)/.test(rolesSql.slice(rolesSql.indexOf("membership_audit_staff_read"))),
    "audit: the database's own read policy is the staff check, not a page decision");
  assert(securityPage.includes("failed sign-in") && securityPage.includes("Not recorded"),
    "audit: the page states plainly that failed sign-ins are not recorded instead of implying a quiet history");
  assert(!/Not recorded yet: sign-ins and failed sign-in attempts, invitation emails/i.test(securityPage),
    "audit: the page no longer lists invitations and suspensions as unrecorded, because they are recorded now");
}
