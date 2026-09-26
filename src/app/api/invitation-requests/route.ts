import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwner, requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invitation-request flow (workflow §5).
 *
 * GET     — owner: ALL requests; user: their own requests.
 * POST    — an authorized member who holds the can_request_invites permission
 *           submits a REQUEST for someone else. This NEVER creates access:
 *           only the owner's approval (PATCH) issues the actual invitation.
 * PATCH   — owner only: approve (creates + links a real invitation) or reject.
 *
 * Enforced at the database level too: the invitation_requests RLS insert
 * policy requires can_request_invites, and only owner policies allow
 * updates. A user cannot bypass owner approval by calling this API directly.
 */
export async function GET() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  if (guard.data.profile.role === "owner") {
    const { data, error } = await supabase
      .from("invitation_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data });
  }

  const { data, error } = await supabase
    .from("invitation_requests")
    .select("*")
    .eq("requester_id", guard.data.user.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const profile = guard.data.profile;

  if (profile.role === "owner") {
    return NextResponse.json(
      { error: "You are the owner — create the invitation directly instead of requesting one." },
      { status: 400 }
    );
  }
  if (!profile.can_request_invites) {
    return NextResponse.json(
      { error: "You don't have permission to request invitations. Ask the owner to grant it." },
      { status: 403 }
    );
  }

  let body: { email?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  const reason = (body.reason || "").trim().slice(0, 500);

  // Refuse duplicate pending requests for the same email.
  const { count } = await supabase
    .from("invitation_requests")
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .eq("status", "pending");
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: "A request for that email is already pending." }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("invitation_requests")
    .insert({ requester_id: guard.data.user.id, email, reason })
    .select("*")
    .single();
  if (error) {
    return NextResponse.json(
      { error: error.message.includes("row-level security")
          ? "You don't have permission to request invitations."
          : error.message },
      { status: error.message.includes("row-level security") ? 403 : 500 }
    );
  }
  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireOwner(supabase);
  if (!guard.ok) return guard.response;
  const ownerId = guard.data.user.id;

  let body: { id?: string; decision?: "approve" | "reject"; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { id, decision, note } = body;
  if (!id || (decision !== "approve" && decision !== "reject")) {
    return NextResponse.json({ error: "Missing request id or decision." }, { status: 400 });
  }

  const { data: req } = await supabase
    .from("invitation_requests")
    .select("*")
    .eq("id", id)
    .single();
  if (!req) return NextResponse.json({ error: "That request could not be found." }, { status: 404 });
  if (req.status !== "pending") {
    return NextResponse.json({ error: "That request was already decided." }, { status: 410 });
  }

  if (decision === "reject") {
    const { error } = await supabase
      .from("invitation_requests")
      .update({
        status: "rejected",
        decided_by: ownerId,
        decided_at: new Date().toISOString(),
        decision_note: (note || "").slice(0, 500),
      })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ data: { ok: true, status: "rejected" } });
  }

  // Approve → issue the actual invitation. The proposed person must still
  // complete the normal invitation signup (email match, single use).
  const token = Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { data: invitation, error: iErr } = await supabase
    .from("invitations")
    .insert({ email: req.email, token, invited_by: ownerId })
    .select("*")
    .single();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  const { error: uErr } = await supabase
    .from("invitation_requests")
    .update({
      status: "approved",
      decided_by: ownerId,
      decided_at: new Date().toISOString(),
      decision_note: (note || "").slice(0, 500),
      invitation_id: invitation.id,
    })
    .eq("id", id);
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  const origin = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  return NextResponse.json({
    data: { ok: true, status: "approved", link: `${origin}/signup?invite=${token}` },
  });
}
