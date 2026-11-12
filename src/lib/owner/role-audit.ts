import type { SupabaseClient } from "@supabase/supabase-js";
import { roleLabel } from "../roles";

/**
 * RECENT ROLE CHANGES (2026-11-12).
 *
 * The audit trail was being written but nothing could read it, which makes it half a
 * feature: a record exists to be looked at. This reads the last few entries for the
 * Members page.
 *
 * Two rules, both about not overstating what happened:
 *   - a REFUSED change is shown too, because "Sophira stopped this" is exactly the kind
 *     of thing an owner wants to see;
 *   - a person who is no longer in the network is named as such rather than shown as a
 *     blank or, worse, guessed.
 *
 * Read with the signed-in administrator's own session: the policy on membership_audit
 * already limits it to staff, so this cannot leak a name to a member.
 */

export interface RoleChange {
  id: string;
  at: string;
  actorName: string;
  targetName: string;
  fromRole: string;
  toRole: string;
  success: boolean;
  reason: string | null;
}

export interface RoleAuditResult {
  changes: RoleChange[];
  /** False when the table is not there yet (a database that has not taken migration 0048). */
  available: boolean;
}

const GONE = "Someone no longer in your network";

export async function loadRoleAudit(
  supabase: SupabaseClient,
  names: Map<string, string>,
  limit = 8,
): Promise<RoleAuditResult> {
  const { data, error } = await supabase
    .from("membership_audit")
    .select("id, actor_id, target_id, action, previous_role, new_role, success, failure_reason, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !Array.isArray(data)) return { changes: [], available: false };

  const changes: RoleChange[] = data.map((row: Record<string, unknown>) => {
    const actor = String(row.actor_id ?? "");
    const target = String(row.target_id ?? "");
    return {
      id: String(row.id ?? ""),
      at: String(row.created_at ?? ""),
      actorName: names.get(actor) ?? GONE,
      targetName: names.get(target) ?? GONE,
      fromRole: roleLabel(String(row.previous_role ?? "")),
      toRole: roleLabel(String(row.new_role ?? "")),
      success: row.success !== false,
      reason: typeof row.failure_reason === "string" && row.failure_reason ? row.failure_reason : null,
    };
  });

  return { changes, available: true };
}

/** One plain sentence per entry, so the owner never has to decode a row. */
export function describeRoleChange(change: RoleChange): string {
  if (!change.success) {
    return `${change.actorName} tried to change ${change.targetName} from ${change.fromRole} to ${change.toRole}. Sophira refused it: ${change.reason ?? "not allowed"}`;
  }
  return `${change.actorName} changed ${change.targetName} from ${change.fromRole} to ${change.toRole}.`;
}
