import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invitation, InvitationRequest, NetworkMemberStats } from "@/lib/types";

/**
 * Owner roster loader (2026-11-03, phase 1).
 *
 * The same three reads the owner dashboard already performs, extracted so each dedicated page
 * loads only what it shows. A statistics failure is reported, never rendered as zeros, and a
 * phone-directory failure never hides the member list - phones are a convenience, membership
 * is the record.
 */
export interface OwnerRoster {
  members: NetworkMemberStats[];
  invitations: Invitation[];
  requests: InvitationRequest[];
  statsError: string | null;
}

export async function loadOwnerRoster(supabase: SupabaseClient): Promise<OwnerRoster> {
  const [{ data: members, error: mErr }, { data: invitations }, { data: requests }] = await Promise.all([
    supabase.rpc("network_stats"),
    supabase.from("invitations").select("*").order("created_at", { ascending: false }),
    supabase.from("invitation_requests").select("*").order("created_at", { ascending: false }),
  ]);

  const statsError = mErr || !members
    ? `Membership statistics could not be loaded (${(mErr?.message || "no data returned").replace(/[\n\r]/g, " ").slice(0, 160)}). The member list may be incomplete — invitations and access management still work. Reload to retry.`
    : null;

  const { data: phones } = await supabase.rpc("network_member_phones");
  const phoneById = new Map<string, string>(
    ((phones ?? []) as Array<{ user_id: string; phone: string }>).map((r) => [r.user_id, r.phone])
  );

  return {
    members: ((members ?? []) as NetworkMemberStats[]).map((m) => ({
      ...m,
      phone: phoneById.get(m.user_id) ?? m.phone ?? null,
    })),
    invitations: (invitations ?? []) as Invitation[],
    requests: (requests ?? []) as InvitationRequest[],
    statsError,
  };
}
