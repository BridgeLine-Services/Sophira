/**
 * THE FOUR SOPHIRA ROLES (2026-11-12).
 *
 * The application shipped with two roles, `owner` and `user`. Everything else the
 * owner needed — a colleague who can manage members but must not touch billing, a
 * tester who may use pre-release features but must not see anyone's work — had to
 * be expressed as "owner" (too much power) or "user" (no power at all).
 *
 * This module is the single source of truth for the role vocabulary, the ordering,
 * and the plain-English description shown in the Change Role dialog. It is PURE: no
 * database, no network, no React. Server authorization lives in
 * src/lib/auth/permissions.ts and is mirrored in the database (migration 0048), so a
 * frontend cannot award itself a role by editing a request.
 */

export const ROLES = ["user", "tester", "co_owner", "owner"] as const;
export type Role = (typeof ROLES)[number];

/** Roles that carry administrative authority over the network. */
export const STAFF_ROLES: readonly Role[] = ["co_owner", "owner"];

const RANK: Record<Role, number> = { user: 0, tester: 1, co_owner: 2, owner: 3 };

export const ROLE_LABELS: Record<Role, string> = {
  user: "User",
  tester: "Tester",
  co_owner: "Co-Owner",
  owner: "Owner",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  user: "Normal Sophira: their own courses, teachers, assignments and answers. No sight of anyone else's work and no administrative access.",
  tester: "Normal Sophira plus approved testing features and a feedback channel. Still no access to other members, roles or settings.",
  co_owner: "Can see the member directory, invite people, approve requests, and suspend or reinstate Users and Testers. Cannot touch Co-Owners or the Owner, cannot assign administrator roles, and cannot open anyone's academic work.",
  owner: "Everything: all roles, invitations, system configuration, integrations, AI providers, security and billing.",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Unknown or legacy values are treated as the LOWEST privilege, never as staff. */
export function normalizeRole(value: unknown): Role {
  return isRole(value) ? value : "user";
}

export function roleRank(role: Role | string | null | undefined): number {
  return RANK[normalizeRole(role)];
}

export function isStaff(role: Role | string | null | undefined): boolean {
  return isStaffRole(normalizeRole(role));
}

function isStaffRole(role: Role): boolean {
  return role === "owner" || role === "co_owner";
}

/** True when `actor` holds at least the authority of `required`. */
export function roleAtLeast(actor: Role | string | null | undefined, required: Role): boolean {
  return roleRank(actor) >= RANK[required];
}

export function roleLabel(role: Role | string | null | undefined): string {
  return ROLE_LABELS[normalizeRole(role)];
}

/**
 * The access a role gains or loses, in the owner's own words, for the confirmation
 * step. Derived from the descriptions above so the dialog cannot drift from them.
 */
export function describeRoleChange(from: Role, to: Role): { gains: string[]; loses: string[] } {
  const gains: string[] = [];
  const loses: string[] = [];
  const up = RANK[to] > RANK[from];
  // 2026-11-12: the comparison must always be OLD vs NEW. It used to swap them for a
  // demotion, which reported a Co-Owner losing the directory as "gaining" it — exactly
  // backwards, on the one screen where the owner decides whether to take access away.
  const target = to;   // what they become
  const other = from;  // what they are now

  const CAPS: Array<{ min: Role; gain: string; lose: string }> = [
    { min: "co_owner", gain: "See the member directory and manage members", lose: "See the member directory and manage members" },
    { min: "co_owner", gain: "Invite people and decide membership requests", lose: "Invite people and decide membership requests" },
    { min: "tester", gain: "Use approved testing features", lose: "Use approved testing features" },
    { min: "owner", gain: "Full Owner Dashboard access, including security and billing", lose: "Full Owner Dashboard access, including security and billing" },
  ];

  for (const cap of CAPS) {
    const had = RANK[other] >= RANK[cap.min];
    const has = RANK[target] >= RANK[cap.min];
    if (!had && has) gains.push(cap.gain);
    if (had && !has) loses.push(cap.lose);
  }
  // A change between two roles of the same administrative tier (owner <-> co_owner)
  // is still a real change of authority even though the capability list is equal.
  if (gains.length === 0 && loses.length === 0) {
    if (up) gains.push(ROLE_DESCRIPTIONS[to]);
    else loses.push(ROLE_DESCRIPTIONS[from]);
  }
  return { gains, loses };
}
