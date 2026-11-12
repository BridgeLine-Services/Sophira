/**
 * MEMBERSHIP NOTIFICATIONS, GLOBAL PRESENCE AND THE MEMBER-VISIBLE NOTIFICATION CENTRE
 * (2026-11-13).
 *
 * The owner's spec for this cycle: a member must know when something important happens to
 * their own account or invitation request, the Owner must have reliable presence, a Co-Owner
 * must be able to do their authorized membership work, and nobody may see administrative
 * information belonging to someone else.
 *
 * These tests pin the decisions that make those true. They are deliberately about behaviour
 * and boundaries, not about markup: every notification must be a known event, addressed to the
 * person it concerns, without a token; presence must be reported once by the shell rather than
 * by whichever page happens to be open; and a failure to notify must never be reported as a
 * failure of the invitation or role change that already succeeded.
 */
import { readFileSync, readdirSync } from "node:fs";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  KINDS,
  PRESENTATION_LABELS,
  categoryEnabled,
  presentationGroup,
  presentationLabel,
  safeLink,
  validate,
  type NotificationCategory,
} from "../src/lib/notifications/store";
import {
  ACCOUNT_RESTORED_NOTE,
  invitationAcceptedNote,
  roleChangedNote,
} from "../src/lib/notifications/membership-notes";

const read = (path: string) => readFileSync(path, "utf8");

const MEMBERSHIP_KINDS = [
  "invitation_request_approved",
  "invitation_request_rejected",
  "invitation_accepted",
  "membership_role_changed",
  "account_restored",
] as const;

export function runMembershipNotificationTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): void {
  section("membership notices (known events, own inbox, no secrets)");

  // Every membership event is a real, known kind in the existing account category. No new
  // category was invented, so the database's fixed list and the member's existing
  // preferences keep working and nobody's settings are silently reset.
  for (const kind of MEMBERSHIP_KINDS) {
    assert(kind in KINDS, `notifications: ${kind} is a registered event, not free text`);
    assert(KINDS[kind] === "account", `notifications: ${kind} uses the existing account category`);
    const accepted = validate({ kind: kind as never, title: "Something happened", dedupeKey: `key-${kind}` });
    assert(accepted.ok && accepted.value.category === ("account" as NotificationCategory),
      `notifications: a server may store ${kind} once it words it`);
  }
  assert((CATEGORIES as string[]).length === 6,
    "notifications: the stored category list is unchanged, so no migration was needed");
  assert(/invitation/i.test(CATEGORY_LABELS.account) && /security/i.test(CATEGORY_LABELS.account),
    "notifications: the account category says what it now covers, in the member's words");

  // Presentation grouping keeps invitation news out of the security noise without changing
  // what is stored or what a preference controls.
  assert(presentationGroup("invitation_request_approved") === "membership",
    "notifications: invitation news is grouped under invitations and membership");
  assert(presentationGroup("membership_role_changed") === "membership",
    "notifications: a role change is membership news");
  assert(presentationGroup("account_security") === "security",
    "notifications: a security notice stays under account and security");
  assert(presentationGroup("due_soon") === "deadlines" && presentationGroup("canvas_assignment_new") === "canvas",
    "notifications: the existing headings still describe the existing events");
  assert(Object.values(PRESENTATION_LABELS).every((label) => label.length > 3),
    "notifications: every heading is readable text");
  assert(presentationLabel("invitation_accepted") === PRESENTATION_LABELS.membership,
    "notifications: the centre can ask for one notice's heading");

  // Wording: plain, and it describes what changed for THIS member.
  const coOwner = roleChangedNote("co_owner");
  assert(/Co-Owner/.test(coOwner.title), "wording: the new role is named in the title");
  assert(/manage members/i.test(coOwner.body) && /Owner/i.test(coOwner.body),
    "wording: a Co-Owner is told what they gained and what stays with the Owner");
  assert(/no longer/.test(roleChangedNote("user").body),
    "wording: a demotion says plainly that administrative access is gone, without alarm");
  assert(/testing/i.test(roleChangedNote("tester").body), "wording: a Tester is told what they can use");
  assert(/Owner/.test(roleChangedNote("owner").title), "wording: an Owner is told they hold ownership");
  assert(/restored/i.test(ACCOUNT_RESTORED_NOTE.title) && /sign in/i.test(ACCOUNT_RESTORED_NOTE.body),
    "wording: a restored member is told they can sign in again");
  const joined = invitationAcceptedNote("friend@example.com");
  assert(joined.body.includes("friend@example.com") && /joined/i.test(joined.body),
    "wording: the inviter is told who actually joined");
  assert(!/[a-f0-9]{32,}/i.test(joined.body), "wording: no token is ever part of a notice");

  // A notice can never become a redirect, and never travels outside the app.
  assert(safeLink("https://example.com/invite") === null, "notifications: an external link is still refused");
  assert(categoryEnabled({ categories: { account: false }, email_enabled: true }, "account") === false,
    "notifications: turning membership notices off is respected");

  section("membership notices (one server helper, honest outcomes)");

  const helper = read("src/lib/notifications/notify.ts");
  assert(helper.includes("validate(input)"),
    "notify: only a wordable, registered event can be recorded");
  assert(helper.includes("notificationCategoryEnabled"),
    "notify: the member's own preference is checked before anything is written");
  assert(helper.includes("insertNotification") && helper.includes("createAdminClient"),
    "notify: the verified privileged channel is used first, with the documented fallback");
  assert(helper.includes('error.code === "23505"'),
    "notify: a duplicate is reported as already sent, not as a failure");
  assert(/console\.error/.test(helper),
    "notify: a missed notice is logged so it can be diagnosed, never silently discarded");
  assert(!/throw new Error/.test(helper),
    "notify: the helper never throws, so a courtesy cannot break the operation it follows");
  assert(helper.includes("the member turned these notices off"),
    "notify: a preference is reported as a skip, not dressed up as delivery");

  const privileged = read("src/lib/db-privileged.ts");
  assert(/insert into public\.member_notifications[\s\S]*values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7\)/.test(privileged),
    "db: the notice insert is fixed SQL with bound parameters");
  assert(privileged.includes("on conflict (user_id, dedupe_key) do nothing"),
    "db: a retry cannot create a second copy of the same notice");
  assert(privileged.includes("NOTIFICATION_CATEGORIES"),
    "db: only the database's own categories can be written");

  section("membership notices (the route that decides a request)");

  const requests = read("src/app/api/invitation-requests/route.ts");
  assert(/requireNetworkManagement\(supabase\)/.test(requests),
    "requests: the staff-wide LIST uses the same authority as deciding, so a Co-Owner sees what they may act on");
  const getBranch = requests.slice(requests.indexOf("export async function GET"), requests.indexOf("export async function POST"));
  assert(getBranch.includes("staff.ok"), "requests: staff read the whole list");
  assert(getBranch.includes('.eq("requester_id", guard.data.user.id)'),
    "requests: everyone else still reads only their own requests");
  assert(!/profile\.role === "owner"/.test(getBranch),
    "requests: a plain role comparison no longer decides who may see the list");
  assert(requests.includes("invitation_request_approved") && requests.includes("invitation_request_rejected"),
    "requests: both decisions produce a notice for the requester");
  assert(/dedupeKey: `invitation-request-\$\{req\.id\}-approved`/.test(requests)
      && /dedupeKey: `invitation-request-\$\{req\.id\}-rejected`/.test(requests),
    "requests: the dedupe key derives from the request and the decision");
  const approvalNotice = requests.slice(
    requests.indexOf('kind: "invitation_request_approved"'),
    requests.indexOf('dedupeKey: `invitation-request-${req.id}-approved`') + 60,
  );
  assert(approvalNotice.length > 100 && !/token/i.test(approvalNotice),
    "requests: the approval notice never carries the invitation token");
  assert(requests.includes("decision_note") && !/body:[\s\S]{0,80}decision_note/.test(requests),
    "requests: the administrative note is not copied into the requester's notice");
  assert(requests.includes("notification: notice"),
    "requests: the API reports what happened to the notice instead of pretending");

  section("membership notices (accepting and revoking)");

  const accept = read("src/app/api/invitations/accept/route.ts");
  assert(/kind: "invitation_accepted"/.test(accept), "accept: the inviter is told when someone joins");
  assert(accept.indexOf("invitation_accepted") > accept.indexOf("if (!accepted)"),
    "accept: the notice is written only after the invitation was atomically claimed");
  assert(/already_accepted: true/.test(accept) && accept.indexOf("invitation_accepted") > accept.indexOf("already_accepted"),
    "accept: a retried acceptance does not send a second 'they joined' notice");
  assert(/dedupeKey: `invitation-\$\{invitation\.id\}-accepted`/.test(accept),
    "accept: the dedupe key is the invitation itself");
  assert(!/token: invitation\.token/.test(accept) || !/notifyMember[\s\S]{0,400}token/.test(accept),
    "accept: no token is included in the notice");

  const invitations = read("src/app/api/invitations/route.ts");
  assert(invitations.includes('status: "revoked"'),
    "revoke: a revoked invitation still stops working, unchanged");
  assert(/if \(uErr\) return NextResponse\.json/.test(invitations),
    "revoke: a failed revocation is reported as a failure, not as a cancellation");

  section("membership notices (role change, restore and revocation)");

  const roles = read("src/app/api/network/roles/route.ts");
  assert(roles.includes("roleChangedNote") && /kind: "membership_role_changed"/.test(roles),
    "roles: the affected member is told, in the shared wording");
  assert(roles.lastIndexOf("notifyMember") > roles.indexOf("if (result.ok !== true)"),
    "roles: a refused change can never produce a success notice");
  assert(/dedupeKey: `role-\$\{userId\}/.test(roles),
    "roles: the notice is keyed by the change, so a retry is silent");

  const members = read("src/app/api/network/members/route.ts");
  assert(/kind: "account_restored"/.test(members), "members: a restored member is told after the restore succeeded");
  assert(members.lastIndexOf("notifyMember") > members.indexOf('case "restore"'),
    "members: the restore notice comes after the restore, never instead of it");
  assert(/NO IN-APP NOTICE ON REVOCATION/.test(members),
    "members: revocation deliberately writes no notice, because a revoked member cannot read one");
  assert(!/notifyMember[\s\S]{0,200}case "remove"/.test(members),
    "members: removing an account does not attempt a notice to a deleted inbox");
  assert(/revoke_all_sessions/.test(members),
    "members: revocation still invalidates sessions immediately; nothing was delayed for a notice");

  section("global presence (one loop, every role, every screen)");

  const shell = read("src/components/app/AppShell.tsx");
  assert(/usePresenceReporter\(\{/.test(shell) && shell.includes('fetch("/api/network/presence")'),
    "presence: the shared shell starts the heartbeat and reads the owner's cadence");
  assert(/enabled: Boolean\(userId\) && presenceWindow !== null && !signingOut/.test(shell),
    "presence: nothing is reported before the member is confirmed, and nothing after signing out");
  assert(shell.includes('variant?: "workspace" | "owner"') && shell.includes("presenceWindow"),
    "presence: the same shell serves the owner environment, so an Owner is reported there too");
  assert(!/localStorage/.test(read("src/lib/presence/use-presence-reporter.ts")),
    "presence: the identifier stays per-tab, never a stored device id");

  const reporter = read("src/lib/presence/use-presence-reporter.ts");
  assert(reporter.includes("let shared") && reporter.includes("holders"),
    "presence: one loop is shared by every mounted shell, so a route change cannot start a second one");
  assert(reporter.includes("HANDOVER_MS"),
    "presence: leaving a page does not release the session while another page is taking over");
  assert(reporter.includes('res.status === 403'),
    "presence: a refused account stops reporting instead of retrying forever");
  assert(reporter.includes('"visibilitychange"') && reporter.includes('"online"'),
    "presence: returning to the tab or reconnecting reports immediately");
  assert(reporter.includes('"pagehide"') && reporter.includes('method: "DELETE"'),
    "presence: a closing tab releases its session explicitly");
  assert(reporter.includes("document.hidden"),
    "presence: a hidden tab does not claim to be present");
  assert(!/presence_release/.test(reporter),
    "presence: the browser talks to the API, never straight to a database function");

  const panel = read("src/components/app/MembersPanel.tsx");
  assert(panel.includes("usePresenceFeed") && !panel.includes("usePresenceReporter"),
    "presence: the Owner's members page no longer keeps a second heartbeat alive");
  assert(panel.includes("fetchMembers") && panel.includes("updatedAt"),
    "presence: the directory still refreshes and still says how old its picture is");

  section("the notification centre (own notices only, readable, no colour-only meaning)");

  const page = read("src/app/notifications/page.tsx");
  assert(page.includes("listNotifications(supabase, user.id)"),
    "notifications: the page reads only the signed-in member's rows");
  assert(page.includes("safeLink"), "notifications: every link is validated before it is offered");
  assert(page.includes("presentationLabel") && page.includes("Unread"),
    "notifications: notices are grouped by heading and state read/unread in words");
  assert(page.includes("Nothing here yet"), "notifications: the empty state explains what will appear");
  assert(read("src/app/notifications/error.tsx").includes("Nothing has been lost"),
    "notifications: a failed load says nothing was lost");

  const api = read("src/app/api/notifications/route.ts");
  assert(/requireUser\(supabase\)/.test(api) && !/body\.user_id/.test(api),
    "notifications: the member is taken from the session, never from the request");
  assert(!/kind|categories:\s*body\.categories\s*\?\?/.test(api.slice(api.indexOf("export async function POST"), api.indexOf("export async function PUT"))),
    "notifications: the client cannot post an event kind, so it cannot invent a notice");

  const prefs = read("src/components/app/NotificationPreferences.tsx");
  assert(prefs.includes('method: "PUT"') && prefs.includes("/api/notifications"),
    "preferences: saving goes through the existing protected notification API");
  assert(prefs.includes("Saved.") && prefs.includes("couldn't save your choices"),
    "preferences: a save is confirmed, and a failure is stated rather than assumed");
  assert(prefs.includes('roles:') === false && prefs.includes("!== false"),
    "preferences: an absent category means on, so a new one never arrives switched off");
  assert(read("src/app/settings/page.tsx").includes("<NotificationPreferences />"),
    "preferences: the control is reachable from Settings");

  const dash = read("src/app/dashboard/page.tsx");
  assert(dash.includes("member_notifications") && dash.includes("See all notifications"),
    "dashboard: the member sees their own unread count and a way to the centre");
  assert(dash.includes("couldn&apos;t check your notifications"),
    "dashboard: an unreadable inbox says it could not be checked, not that it is empty");
  assert(!/network_directory/.test(dash) && !/owner\/members/.test(dash),
    "dashboard: the member view does not borrow the administrative directory");

  section("notifications (the table was not recreated and RLS was not weakened)");

  const sql = read("supabase/migrations/0042_member_notifications.sql");
  assert(/create table if not exists public\.member_notifications/.test(sql),
    "schema: the table is still created by the migration that owns it");
  assert(/using \(auth\.uid\(\) = user_id\)/.test(sql), "schema: a member still reads only their own rows");
  const noticePolicies = sql.slice(
    sql.indexOf('"member_notifications own read"'),
    sql.indexOf("on public.notification_preferences"),
  );
  assert(noticePolicies.length > 200 && !/for insert/i.test(noticePolicies),
    "schema: no insert policy exists on the notification table, so a browser cannot invent a notice");
  assert(!/for delete/i.test(sql), "schema: notices still cannot be deleted, so history survives");

  const migrations = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
  const createsTable = migrations.filter((f) =>
    /create table if not exists public\.member_notifications/.test(read(`supabase/migrations/${f}`)),
  );
  assert(createsTable.length === 1,
    "schema: exactly one migration creates the notification table, so nothing was recreated");
  assert(migrations.length === 51,
    "schema: this cycle needed no new migration, because every new event fits the existing fields");
}
