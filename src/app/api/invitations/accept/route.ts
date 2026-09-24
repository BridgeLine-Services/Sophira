import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Called right after an invited user signs up: marks the invitation accepted.
 * Uses the service role because invitation rows are owner-visible only.
 * The authenticated user must match the invited email.
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
    return NextResponse.json({ error: "That invitation was already used or revoked." }, { status: 410 });
  }
  if ((user.email || "").toLowerCase() !== invitation.email.toLowerCase()) {
    return NextResponse.json(
      { error: `This invitation was issued to ${invitation.email}. Please sign up with that email address, or ask the owner to send a new invitation.` },
      { status: 403 }
    );
  }

  const { error: uErr } = await admin
    .from("invitations")
    .update({ status: "accepted", accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  return NextResponse.json({ data: { ok: true } });
}
