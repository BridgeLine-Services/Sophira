/**
 * ONE PLACE THAT ANSWERS "WHERE IS THIS PERSON'S HOME?" (2026-11-12).
 *
 * Before this module the answer was assembled in four different ways:
 *   - AppShell hardcoded `owner -> /owner`, `co_owner -> /owner/members` (which is a
 *     member list, not a dashboard) and labelled every one of them "Owner Dashboard";
 *   - the mobile drawer used a third string ("Members");
 *   - a Tester had no dashboard entry at all, even though /tester existed;
 *   - the announcement page sent everyone back to /co-owner, whatever their rank.
 *
 * A Co-Owner therefore landed in the member directory, was told they were looking at the
 * "Owner Dashboard", and could not get back to their own workspace.
 *
 * This module is the single answer. It is PURE: no database, no React, no browser, no
 * "use client" directive, so the server pages and the client shell can both read it and
 * cannot drift apart. It derives everything from the SERVER-VERIFIED role that the page
 * already read; it never reads a role supplied by the browser, and a hidden link is never
 * treated as the security boundary (every destination authorises again on the server -
 * see src/lib/owner/page-context.ts).
 *
 * FAIL CLOSED: an unknown, missing or unreadable role gets NO dashboard entry. A member
 * gets none by definition, and nobody is ever shown another rank's dashboard.
 */
import { normalizeRole, type Role } from "../roles";

export interface DashboardEntry {
  /** Where this rank's dashboard lives. */
  href: string;
  /** The label in the owner's own words. Never "Owner Dashboard" for anyone else. */
  label: string;
}

/**
 * The four ranks and their dashboards. `user` deliberately maps to null: a member's home
 * is their workspace (/dashboard), which is not an administrative dashboard and must not
 * be presented as one.
 */
export const ROLE_DASHBOARDS: Readonly<Record<Role, DashboardEntry | null>> = {
  owner: { href: "/owner", label: "Owner Dashboard" },
  co_owner: { href: "/co-owner", label: "Co-Owner Dashboard" },
  tester: { href: "/tester", label: "Tester Dashboard" },
  user: null,
};

/**
 * The dashboard for a role, or null when there is none to show.
 *
 * `null`/`undefined` means "not known yet" (the profile has not resolved) and returns
 * null, so the sidebar draws no rank-specific entry while it waits instead of guessing
 * and flashing the wrong one. Anything unrecognised is normalised to `user` by
 * src/lib/roles.ts, which also has no dashboard.
 */
export function dashboardForRole(role: Role | string | null | undefined): DashboardEntry | null {
  if (role === null || role === undefined) return null;
  return ROLE_DASHBOARDS[normalizeRole(role)];
}

/**
 * Where the Sophira logo, the back button and "home" go for this rank: the rank's own
 * dashboard when it has one, otherwise the personal workspace.
 */
export function adminHomeFor(role: Role | string | null | undefined): string {
  return dashboardForRole(role)?.href ?? "/dashboard";
}

/**
 * Which navigation environment this rank belongs in.
 *
 * `owner` is the administrative environment (the grouped staff sidebar). The Owner and a
 * Co-Owner work inside it; a Tester and an ordinary member work in the academic
 * workspace and only ever see their own dashboard entry there.
 */
export function environmentFor(role: Role | string | null | undefined): "owner" | "workspace" {
  const normalized = role === null || role === undefined ? "user" : normalizeRole(role);
  return normalized === "owner" || normalized === "co_owner" ? "owner" : "workspace";
}

/**
 * The "back to where I came from" destination for a staff page both staff ranks may open
 * (Announcements, QA triage). Owner -> /owner, Co-Owner -> /co-owner, everyone else ->
 * their workspace. This is what stops Announcements sending the Owner to the Co-Owner's
 * workspace and the Co-Owner to /owner, where they are not allowed.
 */
export function staffBackHrefFor(role: Role | string | null | undefined): string {
  return adminHomeFor(role);
}
