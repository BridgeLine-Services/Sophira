import type { SupabaseClient } from "@supabase/supabase-js";
import type { Invitation, InvitationRequest, NetworkMemberStats } from "@/lib/types";
import { clampThresholds, DEFAULT_THRESHOLDS, type PresenceThresholds } from "@/lib/presence/thresholds";
import { loadRoleAudit, type RoleChange } from "@/lib/owner/role-audit";
import { normalizeDirectoryRows } from "@/lib/owner/directory-rows";

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
  /**
   * True when the directory function is MISSING (the database has not taken the newest update),
   * as opposed to a database that simply could not be reached. The two need different words and
   * a different owner action, so the distinction is made once, here, from the error's signature.
   */
  directoryMissing: boolean;
  /** The directory's own error message, trimmed for display, or null. */
  directoryError: string | null;
  /**
   * False when the invitation list or the request list could not be read. The overview uses these
   * instead of treating an empty array as "nothing waiting" - an unread list is not an empty list.
   */
  invitationsAvailable: boolean;
  requestsAvailable: boolean;
  thresholds: PresenceThresholds;
  /** The last few role changes, refusals included. Empty when the table is not there yet. */
  roleChanges: RoleChange[];
  roleAuditAvailable: boolean;
}

export async function loadOwnerRoster(supabase: SupabaseClient): Promise<OwnerRoster> {
  const [
    { data: directory, error: directoryError },
    { data: invitations, error: invitationsError },
    { data: requests, error: requestsError },
  ] = await Promise.all([
    supabase.rpc("network_directory"),
    supabase.from("invitations").select("*").order("created_at", { ascending: false }),
    supabase.from("invitation_requests").select("*").order("created_at", { ascending: false }),
  ]);

  let members: NetworkMemberStats[] = [];
  let presenceAvailable = true;
  let statsError: string | null = null;
  const { isMissingDatabasePiece } = await import("@/lib/owner/action-items");
  const directoryMissing = Boolean(directoryError) && isMissingDatabasePiece(directoryError);
  const directoryErrorText = directoryError?.message
    ? directoryError.message.replace(/[\n\r]+/g, " ").slice(0, 160)
    : null;

  if (!directoryError && Array.isArray(directory)) {
    // Normalised, not cast: the function's columns are prefixed (o_user_id ...) and a cast would
    // hide the day that prefix reaches the browser, turning every member into "Unnamed member".
    members = normalizeDirectoryRows(directory as Array<Record<string, unknown>>).members;
  } else {
    presenceAvailable = false;
    const { data: stats, error: statsReadError } = await supabase.rpc("network_stats");
    if (statsReadError || !stats) {
      const reason = (statsReadError?.message || "no data returned").replace(/[\n\r]/g, " ").slice(0, 160);
      statsError =
        `Membership statistics could not be loaded (${reason}). The member list may be incomplete ` +
        `— invitations and access management still work. Reload to retry.`;
    } else {
      members = normalizeDirectoryRows(stats as Array<Record<string, unknown>>).members;
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
  const names = new Map<string, string>(members.map((m) => [m.user_id, m.display_name]));
  const audit = await loadRoleAudit(supabase, names);

  return {
    members,
    invitations: (invitations ?? []) as Invitation[],
    requests: (requests ?? []) as InvitationRequest[],
    statsError,
    presenceAvailable,
    directoryMissing,
    directoryError: directoryErrorText,
    invitationsAvailable: !invitationsError,
    requestsAvailable: !requestsError,
    thresholds,
    roleChanges: audit.changes,
    roleAuditAvailable: audit.available,
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

/**
 * NAMES FOR AUDIT ENTRIES (2026-11-12, consolidation).
 *
 * The audit pages need one thing from the roster: a display name per id. Loading the whole
 * roster for that meant running network_directory, the invitations list and the requests list
 * on every visit - three reads to answer one question. This reads only the people asked about.
 * RLS still decides what may be read; a name that cannot be read falls back to "A member".
 */
export async function loadAuditNames(
  supabase: SupabaseClient,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const wanted = Array.from(new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0)));
  const names = new Map<string, string>();
  if (wanted.length === 0) return names;
  const { data } = await supabase.from("profiles").select("id, display_name, email").in("id", wanted);
  for (const row of (data ?? []) as Array<{ id: string; display_name?: string | null; email?: string | null }>) {
    names.set(row.id, row.display_name || row.email || "A member");
  }
  return names;
}

/** Whether the member directory can be read at all - one cheap row, not the whole roster. */
export async function canReadDirectory(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("profiles").select("id", { head: true, count: "exact" }).limit(1);
  return !error;
}
