import { describeRoleChange, loadRoleAudit, type RoleChange } from "../src/lib/owner/role-audit";

/**
 * THE ROLE-CHANGE LOG (2026-11-12).
 *
 * The audit table was being written and nothing could read it, so the trail existed only in
 * theory. These tests are about the reader being honest: a refused change is shown as a
 * refusal, a person no longer in the network is named as such, and a database that has not
 * taken migration 0048 says so instead of looking like "no changes have ever happened".
 */
export async function runRoleAuditTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
) {
  section("1. A change is described as what happened, in one sentence");
  const succeeded: RoleChange = {
    id: "a1", at: "2026-11-12T10:00:00Z", actorName: "Dana Owner", targetName: "Sam Member",
    fromRole: "User", toRole: "Co-Owner", success: true, reason: null,
  };
  assert(
    describeRoleChange(succeeded) === "Dana Owner changed Sam Member from User to Co-Owner.",
    "audit: a successful change names the actor, the person and both roles",
  );

  const refused: RoleChange = { ...succeeded, success: false, reason: "Refused: this is the only active Owner." };
  const refusedText = describeRoleChange(refused);
  assert(/tried to change/.test(refusedText), "audit: a refusal reads as an attempt, not as a change");
  assert(/Sophira refused it/.test(refusedText), "audit: the refusal is attributed to Sophira, not to the person");
  assert(refusedText.includes("Refused: this is the only active Owner."),
    "audit: the stored reason is repeated verbatim, never paraphrased into something stronger or weaker");

  const noReason: RoleChange = { ...refused, reason: null };
  assert(/not allowed/.test(describeRoleChange(noReason)),
    "audit: a refusal with no stored reason still says it was refused rather than silently reading as success");

  section("2. Rows map to names, and a departed person is named honestly");
  const rows = [
    { id: "r1", actor_id: "u1", target_id: "u2", action: "set_role", previous_role: "user",
      new_role: "tester", success: true, failure_reason: null, created_at: "2026-11-12T09:00:00Z" },
    { id: "r2", actor_id: "u1", target_id: "u3", action: "set_role", previous_role: "owner",
      new_role: "user", success: false, failure_reason: "Refused: this is the only active Owner.",
      created_at: "2026-11-12T08:00:00Z" },
  ];
  const fake = {
    from() {
      return {
        select() {
          return {
            order() {
              return { limit: async () => ({ data: rows, error: null }) };
            },
          };
        },
      };
    },
  };
  const names = new Map<string, string>([["u1", "Dana Owner"], ["u2", "Sam Member"]]);
  const result = await loadRoleAudit(fake as never, names);
  assert(result.available === true, "audit: a readable table reports itself as available");
  assert(result.changes.length === 2, "audit: every row returned is kept, refusals included");
  assert(result.changes[0].targetName === "Sam Member", "audit: a known member is named");
  assert(result.changes[1].targetName === "Someone no longer in your network",
    "audit: a person who left is not shown as a blank, and not guessed");
  assert(result.changes[1].success === false && result.changes[1].reason !== null,
    "audit: the refused row keeps both its outcome and its reason");
  assert(result.changes[0].fromRole === "User" && result.changes[0].toRole === "Tester",
    "audit: stored role keys are rendered as the words the Owner sees everywhere else");

  section("3. A database without the table is stated, not disguised as an empty history");
  const broken = {
    from() {
      return {
        select() {
          return {
            order() {
              return { limit: async () => ({ data: null, error: { message: "relation does not exist" } }) };
            },
          };
        },
      };
    },
  };
  const missing = await loadRoleAudit(broken as never, names);
  assert(missing.available === false && missing.changes.length === 0,
    "audit: an unreadable table is reported as unavailable rather than as 'no changes ever'");
}

/**
 * 2026-11-12: the audit list must not describe the situation from before a change.
 *
 * Both halves matter: after the Owner changes a role, the list has to reflect it; and because a
 * Co-Owner can also change a role while the Owner is reading, there has to be a way to read the
 * list again without reloading the whole page. Neither can be satisfied by client state, because
 * the list is rendered on the server.
 */
export function runRoleAuditFreshnessTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
): void {
  section("4. The role-change list is never one change out of date");
  const { readFileSync } = require("fs") as typeof import("fs");
  const panel = readFileSync("src/components/app/MembersPanel.tsx", "utf8");
  const log = readFileSync("src/components/app/RoleChangeLog.tsx", "utf8");

  assert(/useRouter/.test(panel),
    "audit: the Members panel can ask the server for a fresh render");
  // The refresh must follow a SUCCESSFUL change only: refreshing after a refusal would imply
  // something was written when the database refused it.
  const handler = panel.slice(panel.indexOf("const result = await changeMemberRole"), panel.indexOf("const result = await changeMemberRole") + 700);
  assert(/if \(result\.ok\) router\.refresh\(\)/.test(handler),
    "audit: the list is re-rendered only after a change the server accepted");
  assert(!/router\.refresh\(\)[\s\S]{0,80}else/.test(handler),
    "audit: a refused change does not trigger a refresh that would imply it was recorded");

  assert(/router\.refresh\(\)/.test(log),
    "audit: the list has its own way to be read again");
  assert(/Refresh this list/.test(log),
    "audit: that control is a visible, labelled button rather than a hidden gesture");
  assert(/useTransition/.test(log) && /Reading again/.test(log),
    "audit: while it re-reads, the button says so instead of looking stuck");
  assert(/This is what Sophira has recorded as of now/.test(log),
    "audit: after re-reading, the list says what moment it describes");
  assert(/disabled=\{pending\}/.test(log),
    "audit: the button cannot be pressed repeatedly while a read is in flight");
}
