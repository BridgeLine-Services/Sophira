import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireNetworkManagement } from "@/lib/supabase/guard";
import { clampThresholds, DEFAULT_THRESHOLDS, type PresenceThresholds } from "@/lib/presence/thresholds";
import type { Invitation, NetworkMemberStats } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Staff-only, privacy-safe member directory (workflow §22; four roles 2026-11-12).
 *
 * Returns membership metadata ONLY: how to identify a person (name, email, phone and
 * whether that phone was confirmed), their role, their account condition, presence, and
 * aggregate counts. It never returns another member's academic content — the per-user RLS
 * policies on every content table are untouched.
 *
 * RESPONSE CONTRACT (fixed 2026-11-12): this route used to answer
 * `{ data: { members, invitations } }` while the client read `json.members`. Every refresh
 * after a member action silently failed and the owner kept looking at stale rows. The list
 * is now at the TOP level, and `data` is kept as an identical mirror so an older caller
 * cannot break. tests/member-refresh-contract.ts fails if the two ever drift again.
 */
export async function GET() {
  const supabase = createClient();
  const guard = await requireNetworkManagement(supabase);
  if (!guard.ok) return guard.response;

  // The directory function reads auth.users for the email/verified-phone flag inside the
  // database (SECURITY DEFINER). auth.users is never exposed to the browser, no service
  // key is used here, and the function itself re-checks that the caller is staff.
  const { data: directory, error } = await supabase.rpc("network_directory");

  let members: NetworkMemberStats[] = [];
  let presenceAvailable = true;
  let statsError: string | null = null;

  if (!error && Array.isArray(directory)) {
    members = directory as unknown as NetworkMemberStats[];
  } else {
    // Presence is new. On a database that has not taken migration 0050 yet, the owner must
    // still see their members rather than an empty page, so fall back to the older
    // statistics function and SAY that presence is unavailable instead of inventing it.
    presenceAvailable = false;
    const fallback = await supabase.rpc("network_stats");
    if (fallback.error) {
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }
    members = (fallback.data || []) as NetworkMemberStats[];
    statsError = "Presence could not be read from the database yet, so it is shown as Unknown. Member details are complete.";
  }

  const thresholds = await readThresholds(supabase);

  const { data: invitations } = await supabase
    .from("invitations")
    .select("*")
    .order("created_at", { ascending: false });

  const invitationList = (invitations ?? []) as Invitation[];
  const payload = { members, invitations: invitationList, presenceAvailable, thresholds, statsError };

  return NextResponse.json(payload);
}

/** Owner-tuned thresholds, honest defaults if the table is unreadable. */
async function readThresholds(
  supabase: ReturnType<typeof createClient>,
): Promise<PresenceThresholds> {
  try {
    const { data } = await supabase
      .from("presence_settings")
      .select(
        "heartbeat_interval_seconds, connection_timeout_seconds, active_threshold_seconds, idle_threshold_seconds, session_expiration_seconds, presence_update_interval_seconds",
      )
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
