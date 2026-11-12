/**
 * RECORDING AN ADMINISTRATIVE EVENT (2026-11-11). SERVER ONLY.
 *
 * Every caller here has already done the real operation and already knows who did it: the routes
 * verify the signed-in staff member with `requireStaff` / `requireNetworkManagement` before they
 * touch anything. This module turns that verified fact into one audit row.
 *
 * Three rules, all of them about not lying in a record:
 *
 *   1. NEVER before the operation. Every call site records after the write it describes has
 *      succeeded, so a failed action cannot leave a "done" entry behind.
 *   2. NEVER from the browser. The table has no write policy and the database function is
 *      executable by `service_role` only, so the only writer is this server module. The actor id
 *      arrives from the authenticated session, never from a request body.
 *   3. NEVER silently. If the record cannot be written, the caller's own result is unchanged and
 *      this returns "unavailable" - the action really happened, and pretending the record exists
 *      would be worse than saying nothing.
 *
 * The verified direct connection is preferred (it is the channel the rest of the privileged
 * server code uses); the service-role client is the fallback for deployments without it.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { insertAdminAudit, privilegedChannelReachable } from "@/lib/db-privileged";
import { isAdminAction, sanitizeAuditMetadata } from "./admin-audit";

export type AuditWriteResult = "recorded" | "duplicate" | "unavailable";

export interface AdminEventInput {
  action: string;
  /** The signed-in administrator's own id, as established by the route's guard. */
  actorId: string | null;
  /** The member the action was taken on, when there is one. */
  targetId?: string | null;
  /** False only for a refused attempt, which is still worth recording. */
  success?: boolean;
  /** Plain words shown to the owner. Never a token, an address book or a document. */
  reason?: string | null;
  metadata?: Record<string, unknown>;
}

function logUnavailable(detail: string): void {
  // Server-side only. The owner sees the absence of an entry, never a stack trace.
  console.error(`admin audit: ${detail}`);
}

export async function recordAdminEvent(event: AdminEventInput): Promise<AuditWriteResult> {
  if (!isAdminAction(event.action)) {
    // A category that is not in the closed vocabulary would be refused by the database anyway.
    logUnavailable(`refusing to record unknown action "${event.action}"`);
    return "unavailable";
  }

  const row = {
    action: event.action,
    actorId: event.actorId,
    targetId: event.targetId ?? null,
    success: event.success !== false,
    reason: (event.reason ?? "").trim().slice(0, 300) || null,
    metadata: sanitizeAuditMetadata(event.metadata),
  };

  try {
    if (await privilegedChannelReachable()) {
      const direct = await insertAdminAudit(row);
      if (direct) return direct;
    }

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("record_admin_event", {
      p_action: row.action,
      p_target: row.targetId,
      p_success: row.success,
      p_reason: row.reason,
      p_metadata: row.metadata,
      p_actor: row.actorId,
    });
    if (error) {
      logUnavailable(`the database refused the record: ${error.message}`);
      return "unavailable";
    }
    // The function returns null when the identical event was already written moments ago.
    return data ? "recorded" : "duplicate";
  } catch (err) {
    logUnavailable(`could not record an event: ${err instanceof Error ? err.message : "unknown error"}`);
    return "unavailable";
  }
}
