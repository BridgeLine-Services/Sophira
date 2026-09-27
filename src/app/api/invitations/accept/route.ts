import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Called right after an invited user signs up: verifies that the signup
 * used a valid invitation and marks it accepted.
 *
 * PRIMARY ENFORCEMENT LIVES IN THE DATABASE (migration 0008): the
 * handle_new_user trigger on auth.users refuses to create an account
 * without a pending, unexpired invitation tied to the registering
 * email, and atomically claims it. A direct auth.signUp call with no
 * invitation never creates an account at all.
 *
 * This route is defense in depth and an honest double-check for the
 * normal UI flow. It is IDEMPOTENT: if the trigger already claimed the
 * invitation during signup (the new primary path), this route confirms
 * success instead of reporting "already used".
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const token = (body.token || "").trim();
  if (!token) return NextResponse.json({ error: "Missing invitation token." }, { status: 400 });

  const admin = createAdminClient();
  const { data: invitation, error } = await admin
    .from("invitations")
    .select("*")
    .eq("token", token)
    .single();
  if (error || !invitation) {
    return NextResponse.json({ error: "That invitation is no longer valid. Ask the owner for a new link." }, { status: 404 });
  }
  if (invitation.status !== "pending") {
    // Idempotency: the DB signup trigger claims the invitation during
    // signUp, so a same-email user calling this route right afterwards
    // must succeed. Any other email re-using a consumed token is refused.
    if (
      invitation.status === "accepted" &&
      (user.email || "").toLowerCase() === invitation.email.toLowerCase()
    ) {
      return NextResponse.json({ data: { ok: true, already_accepted: true } });
    }
    return NextResponse.json({ error: "That invitation was already used or revoked." }, { status: 410 });
  }
  if (invitation.expires_at && new Date(invitation.expires_at).getTime() <= Date.now()) {
    return NextResponse.json(
      { error: "This invitation has expired. Ask the owner to send a new one." },
      { status: 410 }
    );
  }
  if ((user.email || "").toLowerCase() !== invitation.email.toLowerCase()) {
    return NextResponse.json(
      { error: `This invitation was issued to ${invitation.email}. Please sign up with that email address, or ask the owner to send a new invitation.` },
      { status: 403 }
    );
  }

  // Atomic single-use enforcement: the update only fires while the row is
  // STILL pending, so two concurrent accepts cannot both succeed (the loser
  // sees zero affected rows and gets the already-used response).
  const { data: accepted, error: uErr } = await admin
    .from("invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invitation.id)
    .eq("status", "pending")
    .select("id")
    .single();
  if (uErr || !accepted) {
    return NextResponse.json({ error: "That invitation was already used or revoked." }, { status: 410 });
  }

  return NextResponse.json({ data: { ok: true } });
}
