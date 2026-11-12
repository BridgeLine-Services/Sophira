import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/supabase/guard";
import { canManageMemberRole } from "@/lib/auth/permissions";
import { isRole, roleLabel, type Role } from "@/lib/roles";
import { notifyMember } from "@/lib/notifications/notify";
import { roleChangedNote } from "@/lib/notifications/membership-notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CHANGE ROLE (2026-11-12).
 *
 * Authorization happens TWICE, deliberately:
 *   1. here, with the same permission matrix the dialog uses, so a refusal is a clear
 *      sentence instead of a database error;
 *   2. inside public.set_member_role(), in the same transaction as the write, together
 *      with the last-Owner count and the audit row.
 *
 * The role the client sends is only a REQUEST. The actor's role is read from the profile
 * the server fetched, and the target's current role is read inside the function — never
 * from the request body. Editing the payload in devtools changes nothing but the ask.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireStaff(supabase);
  if (!guard.ok) return guard.response;

  let body: { user_id?: string; role?: string; confirm_owner?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That request could not be read." }, { status: 400 });
  }

  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";
  const nextRole = typeof body.role === "string" ? body.role.trim() : "";
  if (!userId) {
    return NextResponse.json({ error: "No member was chosen." }, { status: 400 });
  }
  if (!isRole(nextRole)) {
    return NextResponse.json({ error: "That is not one of Sophira's four roles." }, { status: 400 });
  }

  // The target's CURRENT role is read here for the pre-check and immediately re-read
  // inside the function. A concurrent change therefore cannot slip through.
  const { data: target, error: targetError } = await supabase
    .from("profiles")
    .select("id, role, status")
    .eq("id", userId)
    .maybeSingle();

  if (targetError) {
    return NextResponse.json(
      { error: "That member's current role could not be read, so nothing was changed. Try again." },
      { status: 503 },
    );
  }
  if (!target) {
    return NextResponse.json({ error: "That member could not be found." }, { status: 404 });
  }

  const precheck = canManageMemberRole({
    actor: { id: guard.data.user.id, role: guard.data.profile.role },
    target: { id: target.id as string, role: (target.role as string) ?? "user" },
    nextRole,
    recentlyAuthenticated: body.confirm_owner === true,
  });
  if (!precheck.allowed) {
    return NextResponse.json({ error: precheck.reason ?? "That change is not allowed." }, { status: 403 });
  }

  const { data, error } = await supabase.rpc("set_member_role", {
    p_target: userId,
    p_new_role: nextRole,
    p_confirm_owner: body.confirm_owner === true,
  });

  if (error) {
    // The function is missing on a database that has not taken migration 0048 yet.
    const missing = /could not find the function|does not exist/i.test(error.message);
    return NextResponse.json(
      {
        error: missing
          ? "This database does not have role management yet. Open Owner Dashboard → Database updates, press Update database, then try again."
          : "The role change could not be saved, so nothing was changed. Try again.",
      },
      { status: missing ? 503 : 500 },
    );
  }

  const result = (data ?? {}) as { ok?: boolean; error?: string; role?: string; previous_role?: string };
  if (result.ok !== true) {
    return NextResponse.json({ error: result.error ?? "The role change was refused." }, { status: 403 });
  }

  const finalRole = (result.role ?? nextRole) as Role;
  const previousRole = result.previous_role ?? null;

  /**
   * THE MEMBER IS TOLD (2026-11-13) - only after the change was committed, so a refused or
   * failed change can never produce a success notice. The dedupe key is derived from the
   * change itself, not from when it happened, so a retry cannot produce a second notice.
   */
  const words = roleChangedNote(finalRole);
  const notice = await notifyMember(userId, {
    kind: "membership_role_changed",
    title: words.title,
    body: words.body,
    link: "/settings",
    dedupeKey: `role-${userId}-${previousRole ?? "unknown"}-${finalRole}`,
  });

  return NextResponse.json({
    role: finalRole,
    previous_role: previousRole,
    summary: `That member is now a ${roleLabel(finalRole)}.`,
    notification: notice,
  });
}
