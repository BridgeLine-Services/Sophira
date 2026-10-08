import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectRow, updateProfileColumns, callDbFunction, privilegedChannelConfigured } from "@/lib/db-privileged";
import { requireOwner } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner membership management (workflow §4).
 *
 * Actions (all owner-only, enforced server-side):
 *   revoke      — set profile.status = 'revoked' and sign the user out.
 *                 Middleware + API guards then block every protected route.
 *   restore     — set status back to 'active'.
 *   remove      — delete the auth user (cascades to all their data).
 *                 Permanent and irreversible.
 *   set_invite_permission — grant/revoke this member's right to REQUEST
 *                 invitations (never to issue them directly).
 *
 * Owner changes to other profiles go through the service-role admin client
 * here; regular RLS keeps profiles strictly own-row for everyone else.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireOwner(supabase);
  if (!guard.ok) return guard.response;
  const ownerId = guard.data.user.id;

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
  if (user_id === ownerId) {
    return NextResponse.json({ error: "You cannot manage your own owner account here." }, { status: 400 });
  }

  // 2026-10-07: privileged reads/writes prefer the VERIFIED direct
  // database channel (restricted new-style admin keys cannot read
  // PostgREST tables); the admin client is only the fallback for
  // deployments without a direct connection.
  const direct = privilegedChannelConfigured();
  const admin = direct ? null : createAdminClient();
  const target = direct
    ? await selectRow("profiles", "id", user_id)
    : (await admin!.from("profiles").select("id, role, status").eq("id", user_id).single()).data;
  if (!target) {
    return NextResponse.json({ error: "That member could not be found." }, { status: 404 });
  }
  if (target.role === "owner") {
    return NextResponse.json({ error: "Owners cannot be modified." }, { status: 400 });
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
      return NextResponse.json({ data: { ok: true } });
    }
    case "restore": {
      const restored = direct
        ? await updateProfileColumns(user_id, { status: "active", access_revoked_at: null })
        : !(await admin!.from("profiles").update({ status: "active", access_revoked_at: null }).eq("id", user_id)).error;
      if (!restored) return NextResponse.json({ error: "The change could not be saved." }, { status: 500 });
      return NextResponse.json({ data: { ok: true } });
    }
    case "remove": {
      // Deleting the auth user cascades to profiles, courses, teachers,
      // assignments, responses — every table keyed on auth.users(id).
      // GoTrue auth-admin is key-level (works with both key conventions).
      const authAdmin = direct ? createAdminClient() : admin!;
      const { error } = await authAdmin.auth.admin.deleteUser(user_id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
      return NextResponse.json({ data: { ok: true } });
    }
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
}
