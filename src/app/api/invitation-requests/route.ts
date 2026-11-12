import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireNetworkManagement, requireUser } from "@/lib/supabase/guard";
import { checkEmail, emailProblemMessage, EMAIL_MAX_INPUT } from "@/lib/validation/email";
import { notifyMember } from "@/lib/notifications/notify";
import { invitationRequestApprovedNote } from "@/lib/notifications/membership-notes";
import { deliverInvitation } from "@/lib/invitations/delivery";
import { recordAdminEvent } from "@/lib/owner/admin-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  /**
   * 2026-11-13: the LIST was Owner-only while DECIDING was already staff-wide, so a Co-Owner
   * could approve or reject requests they were never shown. Both now use exactly the same
   * authority - the same guard the PATCH handler uses - and the database policies agree.
   * Everyone else falls through to their own requests below, which RLS also enforces.
   */
  const staff = await requireNetworkManagement(supabase);
  if (staff.ok) {
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

  // Bounded before parsing, then validated by a linear-time scanner: the reject
  // regex that used to live here backtracked on long input (CodeQL #11/#10).
  const rawBody = await request.text();
  if (rawBody.length > 8192) {
    return NextResponse.json({ error: "That request was too large. Please try again." }, { status: 413 });
  }
  let body: { email?: string; reason?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const emailCheck = checkEmail(body.email);
  if (!emailCheck.ok) {
    const tooLong = body.email?.length && body.email.length > EMAIL_MAX_INPUT;
    return NextResponse.json(
      { error: emailProblemMessage(emailCheck.problem) },
      { status: tooLong ? 413 : 400 }
    );
  }
  const email = emailCheck.email;
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
  // 2026-11-12 (owner spec 4.2): deciding an invitation request is part of managing the
  // network, which the Co-Owner role includes. Being an Owner is still required elsewhere:
  // appointing an Owner or Co-Owner, ownership transfer, billing and security settings.
  const guard = await requireNetworkManagement(supabase);
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
    await recordAdminEvent({
      action: "invitation_request_rejected",
      actorId: ownerId,
      targetId: typeof req.requester_id === "string" ? req.requester_id : null,
    });
    // The requester is told, and only the requester. The decision note stays administrative,
    // so the reviewer's private reasoning is not copied into the member's list.
    const notice = await notifyMember(req.requester_id, {
      kind: "invitation_request_rejected",
      title: "Your invitation request wasn't approved",
      body: `Sophira did not create an invitation for ${req.email}. Nothing was shared with them, and you can ask again if something changes.`,
      link: "/settings",
      dedupeKey: `invitation-request-${req.id}-rejected`,
    });
    return NextResponse.json({ data: { ok: true, status: "rejected", notification: notice } });
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
  const link = `${origin}/signup?invite=${invitation.token}`;

  /**
   * THE INVITATION IS ACTUALLY SENT (2026-11-13).
   *
   * Approving used to create the row and hand the caller a link, so an approved person could
   * wait forever unless a staff member remembered to copy the link out by hand. Delivery now
   * goes through the SAME layer the Invitations page uses (`deliverInvitation`), so there is
   * one delivery process, one token and one row - never a second system.
   *
   * Email only, deliberately: an invitation request carries an address, not a mobile number,
   * and Sophira binds the invitation to that address anyway. A staff member who also wants a
   * text message adds the number on the Invitations page, which is the existing flow.
   *
   * A refused or unconfigured send NEVER fails the approval: the invitation exists, the
   * requester is told the truth about what happened, and the link stays on the Invitations page.
   * Only "sent" means the provider accepted it, and only then is it reported as sent.
   */
  const delivery = await deliverInvitation({ channels: ["email"], email: req.email, phone: null, link, siteUrl: origin });
  const emailStatus = delivery.email.status;
  // Record what the provider said. An older database without the delivery-metadata columns
  // must not turn a completed approval into an error, so this is best-effort bookkeeping.
  await supabase
    .from("invitations")
    .update(
      emailStatus === "sent"
        ? { email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null }
        : { email_status: emailStatus, email_error: delivery.email.reason ?? null }
    )
    .eq("id", invitation.id)
    .then(() => undefined);

  /**
   * The requester is told their request was approved, AFTER the invitation genuinely exists and
   * after delivery was attempted, so the sentence can say what actually happened. The notice
   * never carries the token: the live link stays on the Invitations page and in the email, which
   * is the only place a working token belongs.
   */
  // HISTORY (2026-11-11): the invitation exists and the send was attempted, so this is the
  // moment the entry can tell the truth about both. No address and no token are stored.
  await recordAdminEvent({
    action: "invitation_created",
    actorId: ownerId,
    targetId: null,
    metadata: {
      channels: "email",
      delivery: emailStatus,
      source: "request",
      invitation_id: String(invitation.id),
    },
  });
  if (emailStatus !== "sent") {
    await recordAdminEvent({
      action: "invitation_delivery",
      actorId: ownerId,
      targetId: null,
      success: false,
      reason: delivery.email.reason ?? "the mail provider did not accept the message",
      metadata: { channel: "email", delivery: emailStatus, invitation_id: String(invitation.id) },
    });
  }

  const words = invitationRequestApprovedNote(req.email, emailStatus);
  const notice = await notifyMember(req.requester_id, {
    kind: "invitation_request_approved",
    title: words.title,
    body: words.body,
    link: "/settings",
    dedupeKey: `invitation-request-${req.id}-approved`,
  });

  return NextResponse.json({
    data: {
      ok: true,
      status: "approved",
      link,
      delivery: delivery.overall,
      email_status: emailStatus,
      email_note: delivery.email.reason ?? null,
      notification: notice,
    },
  });
}
