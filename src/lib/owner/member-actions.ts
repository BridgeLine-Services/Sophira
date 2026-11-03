import type { NetworkMemberStats } from "@/lib/types";

/**
 * Member actions (2026-11-03, phase 1).
 *
 * One implementation of the membership mutation and its refresh, used by the dashboard and the
 * dedicated Members page. The endpoint, payload and error handling are unchanged: this only
 * moved the fetch so both screens cannot drift apart.
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

/** Re-reads the member list. Returns null when the read failed, so callers keep what they have. */
export async function fetchMembers(): Promise<NetworkMemberStats[] | null> {
  try {
    const res = await fetch("/api/network/stats", { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { members?: NetworkMemberStats[] };
    return Array.isArray(json?.members) ? json.members : null;
  } catch {
    return null;
  }
}
