/**
 * CENTRALIZED PERMISSION MATRIX (2026-11-12).
 *
 * Before this file the same question — "may this person manage that member?" — was
 * answered in a dozen places with slightly different comparisons. Adding two more
 * roles to that pattern would have guaranteed a hole. Every administrative decision
 * now comes from here, and the same rules are enforced a second time in the database
 * (migration 0048), so a crafted request cannot outvote the server.
 *
 * Nothing here reads a request body, a cookie or a React prop. Callers pass the
 * SERVER-VERIFIED actor role (from the profiles row) and the SERVER-VERIFIED target
 * role (read by the mutation itself), never a value the client supplied.
 */

import { ROLES, roleRank, normalizeRole, isStaff, type Role } from "../roles";

export { ROLES };
export type { Role };

export interface ActorContext {
  /** The acting user's id (server-verified). */
  id: string;
  /** The acting user's role (server-verified, from profiles). */
  role: Role | string;
}

export interface TargetContext {
  id: string;
  role: Role | string;
  status?: string | null;
}

export interface Decision {
  allowed: boolean;
  reason?: string;
}

/** Directory of members: Owner and Co-Owner only. Users and Testers never. */
export function canViewMemberDirectory(actorRole: Role | string | null | undefined): boolean {
  return isStaff(actorRole);
}

/** Membership contact details (email, phone): administrative only. */
export function canViewMemberContact(actorRole: Role | string | null | undefined): boolean {
  return isStaff(actorRole);
}

export function canViewPresence(actorRole: Role | string | null | undefined): boolean {
  return isStaff(actorRole);
}

/**
 * The staff-wide NETWORK MANAGEMENT authority: the member directory, role changes within a
 * Co-Owner's limits, suspending and removing a User or Tester, and the member-facing APIs.
 *
 * It is NOT the authority to issue an invitation. That reads as one label covering two
 * different powers, so it is spelled out here: invitations create accounts, the database
 * policy on `invitations` is per-issuer (`invited_by = auth.uid()`), and issuing one stays
 * Owner-only in both the route (`requireOwner`) and the page (`requireOwnerPage`). A
 * Co-Owner therefore sees no "Invite someone" link and cannot reach the page. Nothing in
 * this file may be read as widening that: `canManageInvitations` is about managing people
 * who are already in the network.
 */
export function canManageInvitations(actorRole: Role | string | null | undefined): boolean {
  return isStaff(actorRole);
}

/** Owner-only surfaces: security, billing, AI providers, integrations, database, ownership transfer. */
export function canAccessOwnerSecurity(actorRole: Role | string | null | undefined): boolean {
  return normalizeRole(actorRole) === "owner";
}

/** Operational monitoring a Co-Owner may legitimately see. */
export function canAccessAdminMonitoring(actorRole: Role | string | null | undefined): boolean {
  return isStaff(actorRole);
}

/** Testing features. Testers, Co-Owners and the Owner; never ordinary Users. */
export function canUseTesterFeatures(actorRole: Role | string | null | undefined): boolean {
  return roleRank(actorRole) >= roleRank("tester");
}

/**
 * Suspend / reinstate / permanently remove an account.
 *
 * The last-Owner guard needs a live count, so it is enforced in SQL inside the same
 * transaction as the write. This function already refuses every path that could
 * remove an owner except Owner-acting-on-Owner, which the database then checks for
 * "is there another one".
 */
export function canManageAccount(actor: ActorContext, target: TargetContext): Decision {
  const actorRole = normalizeRole(actor.role);
  const targetRole = normalizeRole(target.role);

  if (!isStaff(actorRole)) {
    return { allowed: false, reason: "Only an Owner or Co-Owner can manage member accounts." };
  }
  if (actor.id === target.id) {
    return { allowed: false, reason: "You cannot manage your own account here." };
  }
  if (targetRole === "owner" && actorRole !== "owner") {
    return { allowed: false, reason: "Only an Owner can manage another Owner." };
  }
  if (actorRole === "co_owner" && targetRole === "co_owner") {
    return { allowed: false, reason: "A Co-Owner cannot manage another Co-Owner." };
  }
  return { allowed: true };
}

export interface RoleChangeRequest {
  actor: ActorContext;
  target: TargetContext;
  nextRole: Role | string;
  /** The actor confirmed their identity in this session (needed for ownership changes). */
  recentlyAuthenticated?: boolean;
}

/**
 * Change Role, decided in one place.
 *
 * Prohibitions that matter more than any permission:
 *   - nobody changes their own role (no self-promotion, ever);
 *   - a Co-Owner may only move someone between User and Tester;
 *   - a Co-Owner may never touch a Co-Owner or an Owner;
 *   - appointing or demoting an Owner requires the Owner AND a fresh confirmation.
 */
export function canManageMemberRole(request: RoleChangeRequest): Decision {
  const { actor, target, nextRole, recentlyAuthenticated } = request;
  const actorRole = normalizeRole(actor.role);
  const targetRole = normalizeRole(target.role);

  if (!isStaff(actorRole)) {
    return { allowed: false, reason: "Only an Owner or Co-Owner can change a member's role." };
  }
  if (!nextRole || !(ROLES as readonly string[]).includes(String(nextRole))) {
    return { allowed: false, reason: "That is not one of Sophira's four roles." };
  }
  const next = normalizeRole(nextRole);
  if (actor.id === target.id) {
    return { allowed: false, reason: "You cannot change your own role. Ask another Owner to do it." };
  }
  if (next === targetRole) {
    return { allowed: false, reason: "That member already has that role." };
  }

  if (actorRole === "co_owner") {
    if (targetRole === "owner") {
      return { allowed: false, reason: "Only an Owner can change an Owner's role." };
    }
    if (targetRole === "co_owner") {
      return { allowed: false, reason: "A Co-Owner cannot change another Co-Owner's role." };
    }
    if (next !== "user" && next !== "tester") {
      return { allowed: false, reason: "A Co-Owner can only assign the User or Tester role." };
    }
    return { allowed: true };
  }

  // The actor is the Owner from here on.
  if ((next === "owner" || targetRole === "owner") && !recentlyAuthenticated) {
    return {
      allowed: false,
      reason: targetRole === "owner"
        ? "Changing an Owner's role needs you to confirm your password again in this session."
        : "Appointing an Owner needs you to confirm your password again in this session.",
    };
  }
  return { allowed: true };
}

/** Which roles this actor may offer in the Change Role dialog (drives the UI, never the server). */
export function assignableRolesFor(actor: ActorContext, target: TargetContext): Role[] {
  return ROLES.filter(
    (role) => canManageMemberRole({ actor, target, nextRole: role, recentlyAuthenticated: true }).allowed,
  );
}

/** Owner-only: ownership transfer, security, billing. */
export function canTransferOwnership(actorRole: Role | string | null | undefined): boolean {
  return normalizeRole(actorRole) === "owner";
}
