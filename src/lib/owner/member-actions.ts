import type { NetworkMemberStats, Role } from "@/lib/types";
import type { PresenceThresholds } from "@/lib/presence/thresholds";

/**
 * Member actions (2026-11-03, phase 1; refreshed 2026-11-12).
 *
 * One implementation of the membership mutations and the refresh, used by the dashboard
 * and the dedicated Members page, so the two screens cannot drift apart.
 */

export type MemberAction = "revoke" | "restore" | "set_invite_permission" | "remove";

export async function postMemberAction(
  action: MemberAction,
  userId: string,
  value?: boolean,
): Promise<string | null> {
  const res = await fetch("/api/network/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, user_id: userId, value }),
  });
  if (res.ok) return null;
  let message = "The action failed.";
  try {
    const json = (await res.json()) as { error?: string };
    if (json?.error) message = json.error;
  } catch {
    /* an error body that is not JSON keeps the generic message */
  }
  return message;
}

/** The exact shape /api/network/stats returns. One definition, used by the client. */
export interface MemberListResponse {
  members: NetworkMemberStats[];
  presenceAvailable: boolean;
  thresholds: PresenceThresholds | null;
  statsError: string | null;
}

/**
 * Re-reads the member list.
 *
 * THE BUG THIS FIXES (2026-11-12): the route answered `{ data: { members } }` while this
 * function read `json.members`, so EVERY refresh returned null and the owner kept seeing
 * the rows loaded on page load. A member could be suspended and still read "active" until
 * a manual reload. The list is now read from the top level, `data.members` is still
 * accepted for compatibility, and a response that contains neither is reported as a
 * failure instead of being passed off as current data.
 */
export async function fetchMembers(): Promise<MemberListResponse | null> {
  try {
    const res = await fetch("/api/network/stats", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      members?: NetworkMemberStats[];
      data?: { members?: NetworkMemberStats[] };
      presenceAvailable?: boolean;
      thresholds?: PresenceThresholds | null;
      statsError?: string | null;
    };
    const members = Array.isArray(json?.members)
      ? json.members
      : Array.isArray(json?.data?.members)
        ? json.data.members
        : null;
    if (!members) return null;
    return {
      members,
      presenceAvailable: json.presenceAvailable !== false,
      thresholds: json.thresholds ?? null,
      statsError: json.statsError ?? null,
    };
  } catch {
    return null;
  }
}

export interface RoleChangeResult {
  ok: boolean;
  error?: string;
  summary?: string;
}

/**
 * Change Role. Nothing is reported as done until the server answers ok — the caller must
 * refresh the list afterwards and show what the server confirms, not what was clicked.
 */
export async function changeMemberRole(
  userId: string,
  role: Role,
  confirmOwner = false,
): Promise<RoleChangeResult> {
  try {
    const res = await fetch("/api/network/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, role, confirm_owner: confirmOwner }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; summary?: string };
    if (!res.ok) {
      return { ok: false, error: json.error ?? "The role change could not be saved. Nothing was changed." };
    }
    return { ok: true, summary: json.summary };
  } catch {
    return { ok: false, error: "Sophira could not be reached, so nothing was changed. Try again." };
  }
}
