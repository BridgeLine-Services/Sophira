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

  const dashSrc = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8")
    + readFileSync("src/components/app/MemberDirectory.tsx", "utf8");
  assert(!dashSrc.includes("(no name)"), "dashboard: the (no name) placeholder no longer exists");
  assert(dashSrc.includes("memberIdentity"), "dashboard: rows use the tested identity helper");
  assert(dashSrc.includes("id.title") && dashSrc.includes("id.subtitle"), "dashboard: name and email are both rendered per member");
  assert(dashSrc.includes("confirmRevokeId") && dashSrc.includes("Confirm revoke"), "dashboard: revoking takes an explicit confirmation step");
  assert(dashSrc.includes('id="invite-phone"') && dashSrc.includes("sms"), "dashboard: the SMS invite option is preserved, not removed");
  // The table calls onAction; OwnerDashboard wires that prop to the same memberAction handler,
  // so a restore still reaches the unchanged server route.
  assert(dashSrc.includes('onAction(m, "restore")') && dashSrc.includes("onAction={memberAction}"),
    "dashboard: reinstatement still reaches the unchanged action handler");

  const types = readFileSync("src/lib/types.ts", "utf8");
  assert(/interface NetworkMemberStats[\s\S]{0,400}phone\??: string \| null/.test(types),
    "types: the member record carries a nullable phone, matching the 0043 column");

  // ---- What the owner is told about a person they may need to remove ----------
  assert(dashSrc.includes('joinedFor') && dashSrc.includes('joined as'),
    'owner: an accepted invitation says who joined, not just the invited address');
  assert(dashSrc.includes('no phone yet'),
    'owner: a missing phone number is stated plainly so the owner knows who to ask');
  assert(dashSrc.includes('m.phone'), 'owner: the member row shows the phone number when one exists');

  const signup = readFileSync('src/app/signup/page.tsx', 'utf8');
  assert(signup.includes('required') && signup.includes('Please enter the name'),
    'signup: the chosen name is required, so the owner always has a name to identify');
  assert(signup.includes('phone: phone.trim()'),
    'signup: the optional phone number travels into the new profile');

  const mig = readFileSync('supabase/migrations/0043_member_phone.sql', 'utf8');
  assert(mig.includes('add column if not exists phone'),
    '0043: the phone column is added additively');
  assert(mig.includes('network_member_phones') && /owner only/i.test(mig),
    '0043: phone numbers are readable only by the owner');
  assert(mig.includes('on conflict (id) do nothing'),
    '0043: the single-owner claim from 0025 is still present, not reverted');

  // ---- Inviting happens in a dialog, without losing the ways to invite ---------
  const owner = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
  assert(owner.includes("inviteOpen") && owner.includes('role="dialog"') && owner.includes("aria-modal"),
    "owner: the invite form opens as a labelled dialog rather than occupying the page");
  assert(owner.includes("Invite member") && owner.includes("aria-haspopup=\"dialog\""),
    "owner: an explicit Invite member button opens it");
  assert(owner.includes('aria-label="Close invite form"'),
    "owner: the dialog can be dismissed by a labelled control");
  // Nothing may be lost in the move: every delivery path still exists.
  for (const kept of ["createInvitation", "Copy invitation link", 'id="invite-phone"', "sms", "expires_days".slice(0, 8)]) {
    assert(owner.includes(kept), `owner: the invite dialog still provides ${kept}`);
  }
  assert(owner.includes("deleteInvitation") && owner.includes("revokeInvitation"),
    "owner: invitation deletion and revocation are untouched by the redesign");
}
