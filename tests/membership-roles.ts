import { readFileSync } from "fs";
import {
  ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, isRole, normalizeRole, roleRank, roleAtLeast, roleLabel,
  describeRoleChange, isStaff, type Role,
} from "../src/lib/roles";
import {
  canAccessOwnerSecurity, canAccessAdminMonitoring, canManageAccount, canManageInvitations,
  canManageMemberRole, canUseTesterFeatures, canViewMemberContact, canViewMemberDirectory,
  canViewPresence, canTransferOwnership, assignableRolesFor,
} from "../src/lib/auth/permissions";

/**
 * Four-role authorization (2026-11-12).
 *
 * The owner asked for four functioning roles. These tests pin the RULES — including the ones
 * that are really anti-rules: nobody promotes themselves, a Co-Owner cannot appoint another
 * Co-Owner, and nobody can remove the last Owner.
 */
export function runMembershipRoleTests(assert: (cond: boolean, msg: string) => void, section: (t: string) => void) {
  section("1. Four roles exist, and an unknown role is never staff");

  assert(ROLES.length === 4, "roles: there are exactly four roles");
  assert(ROLES.join(",") === "user,tester,co_owner,owner", "roles: User, Tester, Co-Owner and Owner, in ascending order");
  assert(ROLE_LABELS.co_owner === "Co-Owner", "roles: the Co-Owner label is written the way the owner says it");
  assert(Object.values(ROLE_DESCRIPTIONS).every((d) => d.length > 40),
    "roles: every role explains itself in one plain sentence for the Change Role dialog");

  assert(isRole("owner") && isRole("co_owner") && isRole("tester") && isRole("user"),
    "roles: all four are recognised");
  assert(!isRole("admin") && !isRole("superuser") && !isRole("") && !isRole(null),
    "roles: invented names are not roles");
  assert(normalizeRole("owner") === "owner", "roles: a known role survives normalisation");
  assert(normalizeRole("administrator") === "user", "roles: an unknown stored value degrades to the LOWEST privilege");
  assert(normalizeRole(undefined) === "user" && normalizeRole(null) === "user",
    "roles: a missing role is never treated as staff");

  assert(roleRank("user") < roleRank("tester") && roleRank("tester") < roleRank("co_owner")
    && roleRank("co_owner") < roleRank("owner"), "roles: the ordering is User < Tester < Co-Owner < Owner");
  assert(roleAtLeast("co_owner", "co_owner") && roleAtLeast("owner", "co_owner") && !roleAtLeast("tester", "co_owner"),
    "roles: roleAtLeast compares authority, not equality");
  assert(isStaff("owner") && isStaff("co_owner") && !isStaff("tester") && !isStaff("user"),
    "roles: only Owner and Co-Owner are administrative");
  assert(roleLabel("co_owner") === "Co-Owner" && roleLabel("nonsense") === "User",
    "roles: labels degrade honestly instead of printing a raw value");

  section("2. What each role may do");
  assert(canViewMemberDirectory("owner") && canViewMemberDirectory("co_owner"),
    "access: Owner and Co-Owner see the member directory");
  assert(!canViewMemberDirectory("tester") && !canViewMemberDirectory("user"),
    "access: Testers and Users never see the directory");
  assert(canViewMemberContact("co_owner") && !canViewMemberContact("tester"),
    "access: membership contact details are administrative only");
  assert(canViewPresence("co_owner") && !canViewPresence("user"),
    "access: presence is administrative information");
  section("The invitation authority is stated where it is enforced");
  {
    const route = readFileSync("src/app/api/invitations/route.ts", "utf8");
    const pageSrc = readFileSync("src/app/owner/invitations/page.tsx", "utf8");
    const membersPage = readFileSync("src/app/owner/members/page.tsx", "utf8");
    const shell = readFileSync("src/components/app/AppShell.tsx", "utf8");
    const doc = readFileSync("docs/MEMBERSHIP_ROLES_AND_PRESENCE.md", "utf8");
    assert(/requireOwner\(/.test(route) && !/requireNetworkManagement\(/.test(route),
      "invitations: issuing one is Owner-only at the route, not staff-wide");
    assert(/requireOwnerPage\(/.test(pageSrc),
      "invitations: the page is Owner-only, so a Co-Owner cannot reach it by typing the address");
    assert(/profile\.role === "owner" && \(/.test(membersPage),
      "invitations: the Members page shows the invite link to the Owner only");
    assert(/href: "\/owner\/invitations"[^}]*minimum:/.test(shell) === false,
      "invitations: the navigation entry carries no staff minimum, so a Co-Owner never sees it");
    assert(/href: "\/owner\/members"[^}]*minimum: "co_owner"/.test(shell),
      "invitations: the directory itself stays open to a Co-Owner");
    assert(!/co_owner` \| See the member directory, invite people/.test(doc),
      "invitations: the documented role table no longer grants a Co-Owner the invite screen");
    assert(/Only the Owner issues invitations/.test(doc),
      "invitations: the document says plainly who invites, so the mismatch cannot silently return");
  }

  assert(canManageInvitations("co_owner") && !canManageInvitations("user"),
    "access: invitations are administrative");
  assert(canAccessOwnerSecurity("owner") && !canAccessOwnerSecurity("co_owner"),
    "access: security and billing stay Owner-only");
  assert(canAccessAdminMonitoring("co_owner") && !canAccessAdminMonitoring("user"),
    "access: Co-Owners may monitor, plain members may not");
  assert(canUseTesterFeatures("tester") && canUseTesterFeatures("co_owner") && !canUseTesterFeatures("user"),
    "access: testing features belong to Testers and above, never to ordinary Users");
  assert(canTransferOwnership("owner") && !canTransferOwnership("co_owner"),
    "access: ownership transfer is Owner-only");

  section("3. Nobody promotes themselves");
  const owner = { id: "a", role: "owner" as Role };
  const co = { id: "c", role: "co_owner" as Role };
  const tester = { id: "t", role: "tester" as Role };
  const user = { id: "u", role: "user" as Role };

  assert(!canManageMemberRole({ actor: user, target: { id: "u", role: "user" }, nextRole: "owner", recentlyAuthenticated: true }).allowed,
    "roles: a User cannot make themselves Owner");
  assert(!canManageMemberRole({ actor: user, target: { id: "u", role: "user" }, nextRole: "tester", recentlyAuthenticated: true }).allowed,
    "roles: a User cannot even make themselves a Tester");
  assert(!canManageMemberRole({ actor: co, target: { id: "c", role: "co_owner" }, nextRole: "owner", recentlyAuthenticated: true }).allowed,
    "roles: a Co-Owner cannot promote themselves to Owner");
  assert(!canManageMemberRole({ actor: owner, target: { id: "a", role: "owner" }, nextRole: "co_owner", recentlyAuthenticated: true }).allowed,
    "roles: even an Owner cannot change their own role");
  assert(
    canManageMemberRole({ actor: owner, target: { id: "u", role: "user" }, nextRole: "tester", recentlyAuthenticated: false }).allowed,
    "roles: an Owner may promote an ordinary member without a fresh password (only ownership needs it)",
  );

  section("4. A Co-Owner runs members but never administrators");
  assert(canManageMemberRole({ actor: co, target: { id: "u", role: "user" }, nextRole: "tester" }).allowed,
    "roles: a Co-Owner may move a User to Tester");
  assert(canManageMemberRole({ actor: co, target: { id: "t", role: "tester" }, nextRole: "user" }).allowed,
    "roles: a Co-Owner may move a Tester back to User");
  const coPromotes = canManageMemberRole({ actor: co, target: { id: "u", role: "user" }, nextRole: "co_owner" });
  assert(!coPromotes.allowed && /Co-Owner/.test(coPromotes.reason ?? ""),
    "roles: a Co-Owner may not appoint another Co-Owner, and is told why");
  assert(!canManageMemberRole({ actor: co, target: { id: "o2", role: "owner" }, nextRole: "user" }).allowed,
    "roles: a Co-Owner may never demote an Owner");
  assert(!canManageMemberRole({ actor: co, target: { id: "c2", role: "co_owner" }, nextRole: "user" }).allowed,
    "roles: a Co-Owner may not demote another Co-Owner");

  section("5. Ownership changes need a deliberate confirmation");
  const appoint = canManageMemberRole({ actor: owner, target: { id: "u", role: "user" }, nextRole: "owner" });
  assert(!appoint.allowed && /confirm/i.test(appoint.reason ?? ""),
    "roles: appointing an Owner without a fresh confirmation is refused, with a plain reason");
  assert(canManageMemberRole({ actor: owner, target: { id: "u", role: "user" }, nextRole: "owner", recentlyAuthenticated: true }).allowed,
    "roles: with the confirmation, an Owner may appoint another Owner");
  assert(!canManageMemberRole({ actor: owner, target: { id: "o2", role: "owner" }, nextRole: "co_owner" }).allowed,
    "roles: demoting an Owner also needs the confirmation");
  assert(canManageMemberRole({ actor: owner, target: { id: "o2", role: "owner" }, nextRole: "co_owner", recentlyAuthenticated: true }).allowed,
    "roles: with the confirmation, an Owner may change another Owner's role (the last-Owner guard lives in the database)");

  section("6. Invalid and no-op requests are refused, not silently accepted");
  assert(!canManageMemberRole({ actor: owner, target: { id: "u", role: "user" }, nextRole: "admin" }).allowed,
    "roles: an invented role name is refused");
  assert(!canManageMemberRole({ actor: owner, target: { id: "u", role: "user" }, nextRole: "user" }).allowed,
    "roles: asking for the role someone already has is refused rather than reported as a change");
  assert(!canManageMemberRole({ actor: tester, target: { id: "u", role: "user" }, nextRole: "tester" }).allowed,
    "roles: a Tester has no role authority at all");

  section("7. The role dialog only offers what the server would accept");
  assert(assignableRolesFor(owner, { id: "u", role: "user" }).join(",") === "tester,co_owner,owner",
    "roles: an Owner is offered Tester, Co-Owner and Owner for a User (not the role they already have)");
  assert(assignableRolesFor(co, { id: "u", role: "user" }).join(",") === "tester",
    "roles: a Co-Owner is offered only Tester for a User");
  assert(assignableRolesFor(co, { id: "c2", role: "co_owner" }).length === 0,
    "roles: a Co-Owner is offered nothing for another Co-Owner");
  assert(assignableRolesFor(user, { id: "u2", role: "user" }).length === 0,
    "roles: a plain member is offered nothing at all");
  assert(assignableRolesFor(owner, { id: "a", role: "owner" }).length === 0,
    "roles: nobody is offered a change to their own role");

  section("8. Account actions follow the same ladder");
  assert(canManageAccount({ id: "c", role: "co_owner" }, { id: "u", role: "user" }).allowed,
    "access: a Co-Owner may suspend or reinstate a User");
  assert(canManageAccount({ id: "c", role: "co_owner" }, { id: "t", role: "tester" }).allowed,
    "access: a Co-Owner may suspend or reinstate a Tester");
  assert(!canManageAccount({ id: "c", role: "co_owner" }, { id: "c2", role: "co_owner" }).allowed,
    "access: a Co-Owner may not touch another Co-Owner");
  assert(!canManageAccount({ id: "c", role: "co_owner" }, { id: "o", role: "owner" }).allowed,
    "access: a Co-Owner may not touch an Owner");
  assert(!canManageAccount({ id: "a", role: "owner" }, { id: "a", role: "owner" }).allowed,
    "access: nobody manages their own account here");
  assert(!canManageAccount({ id: "u", role: "user" }, { id: "u2", role: "user" }).allowed,
    "access: a plain member manages nobody");

  section("9. The dialog explains the change in the owner's words");
  const up = describeRoleChange("user", "co_owner");
  assert(up.gains.some((g) => /member directory/i.test(g)),
    "roles: promoting to Co-Owner says they gain the member directory");
  assert(up.gains.some((g) => /invite/i.test(g)), "roles: promoting to Co-Owner says they gain invitations");
  const down = describeRoleChange("co_owner", "user");
  assert(down.loses.some((g) => /member directory/i.test(g)),
    "roles: demoting from Co-Owner says they lose the member directory");
  assert(down.loses.length > 0 && down.gains.length === 0,
    "roles: a demotion reports losses and no gains");
  const own = describeRoleChange("co_owner", "owner");
  assert(own.gains.some((g) => /Owner Dashboard/i.test(g)),
    "roles: becoming Owner says they gain the full Owner Dashboard");

  section("10. The database enforces the same rules, not just the interface");
  const sql = readFileSync("supabase/migrations/0048_membership_roles.sql", "utf8");
  assert(/role in \('user', 'tester', 'co_owner', 'owner'\)/.test(sql),
    "database: the profiles check constraint now accepts all four roles");
  assert(/guard_profile_privileges/.test(sql) && /raise exception/i.test(sql),
    "database: a trigger refuses role, status and permission changes from an ordinary session");
  assert(/Only an Owner or Co-Owner can change a role/.test(sql),
    "database: self-promotion is refused in the database, with a plain message");
  assert(/v_actor = p_target/.test(sql) && /your own role/i.test(sql.replace(/'/g, "'")),
    "database: changing your own role is refused inside the function too");
  assert(/v_owner_count <= 1/.test(sql) && /only Owner/i.test(sql),
    "database: the last active Owner cannot be demoted");
  assert(/guard_last_owner/.test(sql),
    "database: the last-Owner guard also covers the existing revoke and delete paths");
  assert(/membership_audit/.test(sql) && /create policy membership_audit_staff_read/.test(sql),
    "database: role changes are recorded in an audit table readable by staff");
  assert(!/for (insert|update|all) on public\.membership_audit/i.test(sql),
    "database: the audit table is append-only — no insert or update policy exists");
  assert(/security definer/.test(sql),
    "database: the role function runs as definer so it can audit atomically");
  assert(!/password|token|secret/i.test(sql.replace(/--.*$/gm, "")),
    "database: the migration contains no credentials or secrets");

  section("11. Authorization is enforced on the server, never in the interface alone");
  const route = readFileSync("src/app/api/network/roles/route.ts", "utf8");
  assert(route.includes("requireStaff"), "roles API: the caller is authenticated and authorised server-side");
  assert(route.includes("canManageMemberRole") && route.includes("set_member_role"),
    "roles API: the decision is checked both in code and inside the database transaction");
  assert(!/body\.actor_role|body\.role_of_caller/.test(route),
    "roles API: the actor's own role is never taken from the request body");
  assert(route.includes("from(\"profiles\")") && route.includes("select(\"id, role, status\")"),
    "roles API: the target's current role is read from the database, not from the request");
  const guard = readFileSync("src/lib/supabase/guard.ts", "utf8");
  assert(guard.includes("requireStaff") && guard.includes("requireNetworkManagement") && guard.includes("requireTester"),
    "guards: staff, network-management and tester guards exist and share the matrix");
  assert(/result\.data\.profile\.role !== "owner"/.test(guard),
    "guards: the existing owner-only guard is unchanged, so no owner-only route quietly widened");
  assert(guard.includes("canViewMemberDirectory(result.data.profile.role)") &&
    guard.includes("canManageInvitations(result.data.profile.role)"),
    "guards: the staff guards ask the permission matrix instead of comparing strings");

  section("12. The navigation shows only what the person may open");
  const shell = readFileSync("src/components/app/AppShell.tsx", "utf8");
  assert(shell.includes("minimum?: NavRole") && shell.includes("canSeeNavItem"),
    "nav: every Owner-Dashboard entry declares the lowest role that may open it");
  assert(/\{ href: "\/owner\/members", label: "Members", icon: Users, minimum: "co_owner" \}/.test(shell),
    "nav: Members is the entry a Co-Owner may open");
  assert(/\{ href: "\/owner\/security", label: "Security and billing"/.test(shell) &&
    !/\/owner\/security", label: "Security and billing", icon: ShieldCheck, minimum/.test(shell),
    "nav: security and billing have no staff minimum, so they stay Owner-only");
  const ctx = readFileSync("src/lib/owner/page-context.ts", "utf8");
  assert(ctx.includes("requireStaffPage") && /profile\.role !== "owner" && profile\.role !== "co_owner"/.test(ctx),
    "pages: the members page accepts an Owner or a Co-Owner and redirects everyone else");
  assert(/if \(profile\.role !== "owner"\) redirect\("\/dashboard"\)/.test(ctx),
    "pages: the original owner-only page gate is untouched");
}
