/**
 * RAISING A NOTICE FROM SERVER CODE (2026-11-13).
 *
 * One place decides how a membership notice actually gets recorded, so the three invitation
 * and membership routes cannot drift apart. The rules it enforces:
 *
 *  - Only an event Sophira knows how to word can be stored (validate() from the store), so a
 *    crafted value can never create an entry no screen understands.
 *  - The member's own preference is respected. Their refusal is reported back as "skipped",
 *    never as a failure, and never as a delivery.
 *  - The privileged channel is tried first (this deployment's admin key can be a RESTRICTED
 *    key that PostgREST refuses), with the service-role client as the documented fallback.
 *  - Nothing here throws. A notice is a courtesy that follows a completed operation; it must
 *    never undo or break the invitation, role change or restore that already succeeded.
 *  - The outcome is honest: created, already reported (dedupe), turned off, or not recorded.
 */

import { createAdminClient } from "../supabase/admin";
import { serviceRoleKey } from "../supabase-config";
import { insertNotification, notificationCategoryEnabled } from "../db-privileged";
import { validate, type NewNotification } from "./store";

export type NotifyOutcome = {
  /** TRUE only when a row was genuinely written by this call. */
  created: boolean;
  /** Why nothing was created, in words the caller can put in a response. */
  skipped?: string;
  /** A real problem worth logging (never shown to the member). */
  failed?: boolean;
};

export async function notifyMember(userId: string | null | undefined, input: NewNotification): Promise<NotifyOutcome> {
  if (!userId) return { created: false, skipped: "no recipient for this notice" };

  const checked = validate(input);
  if (!checked.ok) {
    console.error("[notifications] refused an invalid notice:", checked.reason);
    return { created: false, failed: true, skipped: "the notice could not be worded" };
  }
  const notice = checked.value;

  // A member who turned this category off hears nothing new happen. That is their choice.
  try {
    const wanted = await notificationCategoryEnabled(userId, notice.category);
    if (wanted === false) return { created: false, skipped: "the member turned these notices off" };
  } catch {
    /* could not read the preference: send it, rather than silently drop account news */
  }

  const row = {
    userId,
    category: notice.category,
    kind: notice.kind,
    title: notice.title,
    body: notice.body,
    link: notice.link,
    dedupeKey: notice.dedupeKey,
  };

  let direct: "inserted" | "duplicate" | null = null;
  try {
    direct = await insertNotification(row);
  } catch {
    direct = null; // fall through to the documented fallback
  }
  if (direct === "inserted") return { created: true };
  if (direct === "duplicate") return { created: false, skipped: "this was already reported" };

  // PostgREST fallback for a deployment with a valid service key and no direct connection.
  if (!serviceRoleKey()) {
    console.error("[notifications] no privileged channel is configured; notice not recorded:", notice.kind);
    return { created: false, failed: true, skipped: "notifications are not configured on this deployment" };
  }
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("member_notifications").insert({
      user_id: row.userId,
      category: row.category,
      kind: row.kind,
      title: row.title,
      body: row.body,
      link: row.link,
      dedupe_key: row.dedupeKey,
    });
    if (!error) return { created: true };
    if (error.code === "23505") return { created: false, skipped: "this was already reported" };
    console.error("[notifications] could not record a notice:", notice.kind);
    return { created: false, failed: true, skipped: "the notice could not be recorded" };
  } catch {
    console.error("[notifications] the fallback channel failed:", notice.kind);
    return { created: false, failed: true, skipped: "the notice could not be recorded" };
  }
}
