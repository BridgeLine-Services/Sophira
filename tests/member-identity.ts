import { readFileSync } from "fs";
import { memberIdentity } from "../src/lib/member-identity";

export function runMemberIdentityTests(assert: (cond: boolean, msg: string) => void) {
  const named = memberIdentity({ display_name: "Ada Smith", email: "ada@school.edu", user_id: "u1" });
  assert(named.title === "Ada Smith", "identity: a member with a name is shown by name");
  assert(named.subtitle === "ada@school.edu", "identity: the email is always visible under the name");
  assert(named.initials === "AS", "identity: initials use first and last word");
  assert(named.nameMissing === false && named.identityIncomplete === false, "identity: complete account is not flagged");

  const blank = memberIdentity({ display_name: "   ", email: "sam@school.edu", user_id: "u2" });
  assert(blank.title === "sam@school.edu", "identity: a blank name falls back to the email, not a placeholder");
  assert(blank.nameMissing === true, "identity: a missing name is recorded so the owner can ask for one");
  assert(blank.subtitle.includes("Name not set"), "identity: the owner is told the name is missing, in plain words");
  assert(!blank.title.includes("jsmith") && blank.title.includes("@"), "identity: the email is shown whole, never turned into an invented name");

  const none = memberIdentity({ display_name: "", email: null, user_id: "u3" });
  assert(none.title === "Unnamed member", "identity: no name and no email still renders something honest");
  assert(none.identityIncomplete === true, "identity: an account with no name or email is flagged, not hidden");
  assert(none.initials === "?", "identity: the avatar degrades to a neutral mark");
  assert(!none.title.includes("(no name)"), "identity: the old (no name) placeholder is gone");

  const single = memberIdentity({ display_name: "Prince", email: null });
  assert(single.initials === "PR", "identity: a single-word name yields two initials");
  assert(single.subtitle === "No email on file", "identity: a missing email is stated, not left silent");

  const dash = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
  assert(!dash.includes("(no name)"), "dashboard: the (no name) placeholder no longer exists");
  assert(dash.includes("memberIdentity"), "dashboard: rows use the tested identity helper");
  assert(dash.includes("id.title") && dash.includes("id.subtitle"), "dashboard: name and email are both rendered per member");
  assert(dash.includes("confirmRevokeId") && dash.includes("Confirm revoke"), "dashboard: revoking takes an explicit confirmation step");
  assert(dash.includes('id="invite-phone"') && dash.includes("sms"), "dashboard: the SMS invite option is preserved, not removed");
  assert(dash.includes("memberAction(m, \"restore\")"), "dashboard: reinstatement still calls the unchanged action handler");

  const types = readFileSync("src/lib/types.ts", "utf8");
  assert(!/interface NetworkMemberStats[\s\S]{0,400}phone:/.test(types),
    "types: no phone field was invented for members (no such data is collected)");
}
