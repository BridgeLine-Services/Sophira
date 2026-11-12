import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectRow, updateProfileColumns, callDbFunction, privilegedChannelReachable } from "@/lib/db-privileged";
import { requireStaff } from "@/lib/supabase/guard";
import { canManageAccount } from "@/lib/auth/permissions";
import { notifyMember } from "@/lib/notifications/notify";
import { ACCOUNT_RESTORED_NOTE } from "@/lib/notifications/membership-notes";
import { recordAdminEvent } from "@/lib/owner/admin-events";
import type { AdminActionValue } from "@/lib/owner/admin-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * WHICH RECORDED EVENT EACH ACTION BECOMES (2026-11-11).
 *
 * One map, used for the success AND the refusal, so "Sophira refused to suspend Jordan" is
 * described with the same words as "Alex suspended Jordan". A refusal is a record, not a gap.
 */
const EVENT_FOR_ACTION: Record<string, AdminActionValue> = {
  revoke: "account_suspended",
  restore: "account_restored",
  remove: "member_removed",
  set_invite_permission: "invite_permission_changed",
};

/**
 * Membership management (workflow §4; four roles 2026-11-12).
 *
 * Actions (Owner or Co-Owner, enforced server-side):
 *   revoke      — set profile.status = 'revoked' and sign the user out.
 *                 Middleware + API guards then block every protected route.
 *   restore     — set status back to 'active'.
 *   remove      — delete the auth user (cascades to all their data).
 *                 Permanent and irreversible.
 *   set_invite_permission — grant/revoke this member's right to REQUEST
 *                 invitations (never to issue them directly).
 *
 * Changes to other profiles go through the service-role admin client here;
 * regular RLS keeps profiles strictly own-row for everyone else.
 *
 * 2026-11-12: the gate widened from owner to staff, but the DECISION is the shared permission
 * matrix: a Co-Owner may act on a User or a Tester and never on a Co-Owner or an Owner, and
 * nobody can act on their own account. The existing "Owners cannot be modified here" refusal
 * is deliberately KEPT — owner-level account changes (suspending or removing an Owner) are
 * not part of this flow for any role, so nothing that used to be blocked is now allowed.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireStaff(supabase);
  if (!guard.ok) return guard.response;
  const actorId = guard.data.user.id;

  let body: { action?: string; user_id?: string; value?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { action, user_id, value } = body;
  if (!action || !user_id) {
    return NextResponse.json({ error: "Missing action or user id." }, { status: 400 });
  }
  if (user_id === actorId) {
    // Recorded as a refusal: an attempt to change your own standing is exactly the kind of thing
    // the history exists to show, and there is no member detail to leak in it.
    const refusedSelf = EVENT_FOR_ACTION[action];
    if (refusedSelf) {
      await recordAdminEvent({
        action: refusedSelf,
        actorId,
        targetId: user_id,
        success: false,
        reason: "You cannot manage your own account here.",
      });
    }
    return NextResponse.json({ error: "You cannot manage your own account here." }, { status: 400 });
  }

  // 2026-10-07: privileged reads/writes prefer the VERIFIED direct
  // database channel (restricted new-style admin keys cannot read
  // PostgREST tables); the admin client is only the fallback for
  // deployments without a direct connection.
  const direct = await privilegedChannelReachable();
  const admin = direct ? null : createAdminClient();
  const target = direct
    ? await selectRow("profiles", "id", user_id)
    : (await admin!.from("profiles").select("id, role, status, display_name").eq("id", user_id).single()).data;
  if (!target) {
    return NextResponse.json({ error: "That member could not be found." }, { status: 404 });
  }
  // The name is captured NOW, because the profile can disappear later (a removed member). An
  // entry that can still name who it was about is worth more than one that never can.
  const targetLabel =
    typeof target.display_name === "string" && target.display_name.trim()
      ? target.display_name.trim().slice(0, 120)
      : "a member";

  if (target.role === "owner") {
    const refusedOwner = EVENT_FOR_ACTION[action];
    if (refusedOwner) {
      await recordAdminEvent({
        action: refusedOwner,
        actorId,
        targetId: user_id,
        success: false,
        reason: "Owners cannot be modified here.",
        metadata: { member_label: targetLabel },
      });
    }
    return NextResponse.json({ error: "Owners cannot be modified here. Use Change role to hand ownership over." }, { status: 400 });
  }

  // The shared matrix: a Co-Owner may not touch a Co-Owner, and nobody may touch an Owner.
  const decision = canManageAccount(
    { id: actorId, role: guard.data.profile.role },
    { id: user_id, role: (target.role as string) ?? "user" },
  );
  if (!decision.allowed) {
    const refusedByRole = EVENT_FOR_ACTION[action];
    if (refusedByRole) {
      await recordAdminEvent({
        action: refusedByRole,
        actorId,
        targetId: user_id,
        success: false,
        reason: decision.reason ?? "That action is not allowed.",
        metadata: { member_label: targetLabel },
      });
    }
    return NextResponse.json({ error: decision.reason ?? "That action is not allowed." }, { status: 403 });
  }

  switch (action) {
    case "revoke": {
      // Record the revocation timestamp for the owner's audit trail...
      const revoked = direct
        ? await updateProfileColumns(user_id, { status: "revoked", access_revoked_at: new Date().toISOString() })
        : !(await admin!.from("profiles").update({ status: "revoked", access_revoked_at: new Date().toISOString() }).eq("id", user_id)).error;
      if (!revoked) return NextResponse.json({ error: "The revocation could not be saved." }, { status: 500 });
      // ...and kill their sessions SERVER-side: revoke_all_sessions()
      // deletes every refresh token for the user (service-role SQL), so
      // even a previously issued session/token can no longer refresh —
      // combined with the middleware + API-guard status checks (which
      // reject the user immediately, regardless of token validity),
      // access is invalid at once.
      const revokeSessions = direct
        ? (await callDbFunction("revoke_all_sessions", [user_id])).ok
        : !(await admin!.rpc("revoke_all_sessions", { target_user: user_id })).error;
      if (!revokeSessions) {
        // The revocation itself already succeeded; the status checks block
        // the user regardless. Report but do not silently swallow.
        console.error("revoke_all_sessions failed after status update");
      }
      // Recorded after the status change and the session revocation above, never before: the
      // entry describes something that really happened.
      await recordAdminEvent({
        action: "account_suspended",
        actorId,
        targetId: user_id,
        metadata: { member_label: targetLabel, status: "revoked" },
      });
      /**
       * NO IN-APP NOTICE ON REVOCATION (2026-11-13, deliberate).
       *
       * A revoked member cannot read their notifications: they are no longer authorized to
       * open Sophira at all. Writing one would be a message into a room they cannot enter, and
       * claiming it was "delivered" would be false. Access is never delayed to send a notice.
       * The restore path above is where they hear from Sophira, once they can sign in again.
       */
      return NextResponse.json({ data: { ok: true } });
    }
    case "restore": {
      const restoredAt = new Date().toISOString();
      const restored = direct
        ? await updateProfileColumns(user_id, { status: "active", access_revoked_at: null })
        : !(await admin!.from("profiles").update({ status: "active", access_revoked_at: null }).eq("id", user_id)).error;
      if (!restored) return NextResponse.json({ error: "The change could not be saved." }, { status: 500 });
      // 2026-11-13: they can sign in again, so this is the one moment a notice can reach them.
      // It is written AFTER the restore succeeded; a failed restore above returns early, and a
      // failure to record the notice never reverses the restore.
      const notice = await notifyMember(user_id, {
        kind: "account_restored",
        title: ACCOUNT_RESTORED_NOTE.title,
        body: ACCOUNT_RESTORED_NOTE.body,
        link: "/dashboard",
        dedupeKey: `account-restored-${user_id}-${restoredAt}`,
      });
      await recordAdminEvent({
        action: "account_restored",
        actorId,
        targetId: user_id,
        metadata: { member_label: targetLabel, status: "active" },
      });
      return NextResponse.json({ data: { ok: true, notification: notice } });
    }
    case "remove": {
      // Deleting the auth user cascades to profiles, courses, teachers,
      // assignments, responses — every table keyed on auth.users(id).
      // GoTrue auth-admin is key-level (works with both key conventions).
      const authAdmin = direct ? createAdminClient() : admin!;
      const { error } = await authAdmin.auth.admin.deleteUser(user_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      // After the delete, and carrying the name that was read a moment ago, because the profile
      // (and its display name) no longer exists by the time this is read back.
      await recordAdminEvent({
        action: "member_removed",
        actorId,
        targetId: user_id,
        metadata: { member_label: targetLabel },
      });
      return NextResponse.json({ data: { ok: true } });
    }
    case "set_invite_permission": {
      if (typeof value !== "boolean") {
        return NextResponse.json({ error: "Missing permission value." }, { status: 400 });
      }
      const setOk = direct
        ? await updateProfileColumns(user_id, { can_request_invites: value })
        : !(await admin!.from("profiles").update({ can_request_invites: value }).eq("id", user_id)).error;
      if (!setOk) return NextResponse.json({ error: "The change could not be saved." }, { status: 500 });
      await recordAdminEvent({
        action: "invite_permission_changed",
        actorId,
        targetId: user_id,
        metadata: { member_label: targetLabel, value },
      });
      return NextResponse.json({ data: { ok: true } });
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
