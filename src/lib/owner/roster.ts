import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invitation, InvitationRequest, NetworkMemberStats } from "@/lib/types";
import { clampThresholds, DEFAULT_THRESHOLDS, type PresenceThresholds } from "@/lib/presence/thresholds";

/**
 * Owner roster loader (2026-11-03, phase 1; extended 2026-11-12).
 *
 * The same three reads the owner dashboard already performs, extracted so each dedicated page
 * loads only what it shows. A statistics failure is reported, never rendered as zeros, and a
 * phone-directory failure never hides the member list - phones are a convenience, membership
 * is the record.
 *
 * 2026-11-12: the primary read is now network_directory(), which adds presence and the
 * verified-phone flag. If that function is missing (a database that has not taken the newest
 * migration), the roster falls back to network_stats() and says presence is unavailable
 * rather than showing every member as Offline.
 */
export interface OwnerRoster {
  members: NetworkMemberStats[];
  invitations: Invitation[];
  requests: InvitationRequest[];
  statsError: string | null;
  presenceAvailable: boolean;
  thresholds: PresenceThresholds;
}

export async function loadOwnerRoster(supabase: SupabaseClient): Promise<OwnerRoster> {
  const [{ data: directory, error: directoryError }, { data: invitations }, { data: requests }] =
    await Promise.all([
      supabase.rpc("network_directory"),
      supabase.from("invitations").select("*").order("created_at", { ascending: false }),
      supabase.from("invitation_requests").select("*").order("created_at", { ascending: false }),
    ]);

  let members: NetworkMemberStats[] = [];
  let presenceAvailable = true;
  let statsError: string | null = null;

  if (!directoryError && Array.isArray(directory)) {
    members = directory as unknown as NetworkMemberStats[];
  } else {
    presenceAvailable = false;
    const { data: stats, error: statsReadError } = await supabase.rpc("network_stats");
    if (statsReadError || !stats) {
      const reason = (statsReadError?.message || "no data returned").replace(/[\n\r]/g, " ").slice(0, 160);
      statsError =
        `Membership statistics could not be loaded (${reason}). The member list may be incomplete ` +
        `— invitations and access management still work. Reload to retry.`;
    } else {
      members = stats as unknown as NetworkMemberStats[];
      statsError =
        "Presence is not available from this database yet, so it is shown as Unknown. Everything else is complete.";
    }
  }

  // Phones: the directory function already carries them. The dedicated phone call remains
  // only as a fallback for a member whose row predates it, so nothing regresses.
  if (presenceAvailable && members.every((m) => m.phone === undefined)) {
    const { data: phones } = await supabase.rpc("network_member_phones");
    const byId = new Map<string, { phone: string; verified: boolean }>(
      ((phones ?? []) as Array<{ user_id: string; phone: string; verified?: boolean }>).map((r) => [
        r.user_id,
        { phone: r.phone, verified: r.verified === true },
      ]),
    );
    members = members.map((m) => {
      const found = byId.get(m.user_id);
      return { ...m, phone: found?.phone ?? m.phone ?? null, phone_verified: m.phone_verified ?? found?.verified ?? false };
    });
  }

  const thresholds = await loadThresholds(supabase);

  return {
    members,
    invitations: (invitations ?? []) as Invitation[],
    requests: (requests ?? []) as InvitationRequest[],
    statsError,
    presenceAvailable,
    thresholds,
  };
}

async function loadThresholds(supabase: SupabaseClient): Promise<PresenceThresholds> {
  try {
    const { data } = await supabase
      .from("presence_settings")
      .select("heartbeat_interval_seconds, connection_timeout_seconds, active_threshold_seconds, idle_threshold_seconds, session_expiration_seconds, presence_update_interval_seconds")
      .eq("id", 1)
      .maybeSingle();
    if (!data) return DEFAULT_THRESHOLDS;
    const row = data as Record<string, number>;
    return clampThresholds({
      heartbeatIntervalSeconds: row.heartbeat_interval_seconds,
      connectionTimeoutSeconds: row.connection_timeout_seconds,
      activeThresholdSeconds: row.active_threshold_seconds,
      idleThresholdSeconds: row.idle_threshold_seconds,
      sessionExpirationSeconds: row.session_expiration_seconds,
      presenceUpdateIntervalSeconds: row.presence_update_interval_seconds,
    });
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}
