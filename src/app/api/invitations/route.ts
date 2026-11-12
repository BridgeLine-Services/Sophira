import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requireNetworkManagement } from "@/lib/supabase/guard";
import { invitationEmailNote } from "@/lib/invitations/email";
import { checkEmail, emailProblemMessage, EMAIL_MAX_INPUT } from "@/lib/validation/email";
import { deliverInvitation, normalizePhone, type Channel } from "@/lib/invitations/delivery";
import { recordAdminEvent } from "@/lib/owner/admin-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 2026-11-12 (owner spec 4.2): a Co-Owner may invite people and manage invitations.
 *
 * The guard is the staff-wide network-management one, and the database enforces the same
 * thing: migration 0051 lets staff insert an invitation but only with invited_by = auth.uid(),
 * so an invitation is always recorded against the person who issued it and cannot be forged.
 * Everything still runs on the caller's own request-scoped client - no service-role key ever
 * reaches this path.
 */
async function ownerClient() {
  const supabase = createClient();
  const guard = await requireNetworkManagement(supabase);
  if (!guard.ok) return { supabase: null, error: guard.response };
  return { supabase, error: null as null };
}

export async function GET() {
  const { supabase, error } = await ownerClient();
  if (error || !supabase) return error!;
  const { data, error: qErr } = await supabase
    .from("invitations")
    .select("*")
    .order("created_at", { ascending: false });
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const { supabase, error } = await ownerClient();
  if (error || !supabase) return error!;

  // BODY LIMIT BEFORE VALIDATION (2026-11-09): an invitation body is tiny, so a
  // multi-megabyte one is refused before it is parsed. This is what makes the email
  // check below bounded no matter what arrives (CodeQL #11/#10).
  const rawBody = await request.text();
  if (rawBody.length > 8192) {
    return NextResponse.json({ error: "That request was too large. Please try again." }, { status: 413 });
  }
  let body: { email?: string; phone?: string; expires_days?: number; channel?: string };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  // Deterministic, linear-time validation. The old regex had nested quantifiers, so
  // a long string with no "@" made the engine backtrack (CodeQL #11/#10).
  const emailCheck = checkEmail(body.email);
  if (!emailCheck.ok) {
    const tooLong = body.email?.length && body.email.length > EMAIL_MAX_INPUT;
    return NextResponse.json(
      { error: emailProblemMessage(emailCheck.problem) },
      { status: tooLong ? 413 : 400 }
    );
  }
  const email = emailCheck.email;

  // IDEMPOTENCY (2026-10-13): a pending, unexpired invitation for the same
  // address is REUSED, so retrying never creates duplicate rows or duplicate
  // emails. The resend is safe because each retry reflects one owner action.
  const days = Math.min(90, Math.max(1, Math.round(body.expires_days ?? 14)));
  const nowIso = new Date().toISOString();
  const { data: existing } = await supabase
    .from("invitations")
    .select("*")
    .eq("email", email)
    .eq("status", "pending")
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const origin = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  let row = existing ?? null;
  if (!row) {
    const token = randomBytes(24).toString("hex");
    const { data: created, error: iErr } = await supabase
      .from("invitations")
      .insert({
        email,
        token,
        invited_by: (await supabase.auth.getUser()).data.user!.id,
        expires_at: new Date(Date.now() + days * 86400_000).toISOString(),
      })
      .select("*")
      .single();
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
    row = created;
  }
  const link = `${origin}/signup?invite=${row.token}`;

  // EMAIL DELIVERY (2026-10-13): the invitation is only reported as emailed
  // when the configured provider ACCEPTS the send. Every other outcome is an
  // honest status plus the copy-link fallback — never a fabricated success.
  // DELIVERY CHANNELS (2026-10-28): email, text message, or both - one
  // logical invitation, one token, one row. The email is always the identity
  // the invitation is bound to; SMS is an additional DELIVERY route, never an
  // authorization bypass (supabase auth accounts are still email-based).
  const requested = String(body.channel ?? "email").toLowerCase();
  const channels: Channel[] =
    requested === "sms" ? ["sms"] : requested === "both" ? ["email", "sms"] : ["email"];
  let phone: string | null = null;
  if (channels.includes("sms")) {
    phone = normalizePhone(body.phone);
    if (!phone) {
      return NextResponse.json(
        { error: "Please enter a valid mobile number with country code, e.g. +1 555 123 4567." },
        { status: 400 }
      );
    }
  }

  const delivery = await deliverInvitation({
    channels,
    email,
    phone,
    link,
    siteUrl: origin,
  });
  const emailResult = delivery.email;
  if (emailResult.status === "sent") {
    await supabase
      .from("invitations")
      .update({ email_status: "sent", email_sent_at: new Date().toISOString(), email_error: null })
      .eq("id", row.id);
  } else {
    await supabase
      .from("invitations")
      .update({ email_status: emailResult.status, email_error: emailResult.reason ?? null })
      .eq("id", row.id);
  }

  if (channels.includes("sms")) {
    // Best-effort: never fail an already-created invitation because the
    // delivery-metadata columns are missing on an older database.
    await supabase
      .from("invitations")
      .update({
        phone,
        sms_status: delivery.sms.status,
        sms_sent_at: delivery.sms.status === "sent" ? new Date().toISOString() : null,
        sms_error: delivery.sms.reason ?? null,
      })
      .eq("id", row.id)
      .then(() => undefined);
  }

  /**
   * HISTORY (2026-11-11): one entry for the invitation, and a SECOND entry only when the email did
   * not go out. Both are written after the row and the delivery attempt exist, so neither can
   * describe something that did not happen. The entry carries no token: the working link stays in
   * the email and on this page, which is the only place a live token belongs.
   */
  const inviteActorId = (await supabase.auth.getUser()).data.user?.id ?? null;
  await recordAdminEvent({
    action: "invitation_created",
    actorId: inviteActorId,
    targetId: null,
    metadata: {
      channels: channels.join("+"),
      delivery: emailResult.status,
      reused: Boolean(existing),
      invitation_id: String(row.id),
    },
  });
  if (emailResult.status !== "sent") {
    await recordAdminEvent({
      action: "invitation_delivery",
      actorId: inviteActorId,
      targetId: null,
      success: false,
      reason: emailResult.reason ?? "the mail provider did not accept the message",
      metadata: { channel: "email", delivery: emailResult.status, invitation_id: String(row.id) },
    });
  }

  return NextResponse.json({
    data: {
      ...row,
      link,
      reused: Boolean(existing),
      channels,
      phone,
      delivery: delivery.overall,
      email_status: emailResult.status,
      email_note: invitationEmailNote(
        { status: emailResult.status === "sent" ? "sent" : emailResult.status === "not_configured" ? "not_configured" : "failed", reason: emailResult.reason ?? undefined },
        email
      ),
      sms_status: delivery.sms.status,
      sms_note: delivery.sms.reason,
    },
  });
}

export async function PATCH(request: NextRequest) {
  // Revoke a pending invitation: the link stops working, but the record is
  // kept (unlike DELETE) so the owner can still see its status.
  const { supabase, error } = await ownerClient();
  if (error || !supabase) return error!;

  let body: { id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.id) return NextResponse.json({ error: "Missing invitation id." }, { status: 400 });
  // `.select("id")` is what makes the history honest: a cancel that matched no pending row
  // changed nothing, so it must not produce a "cancelled" entry.
  const { data: cancelled, error: uErr } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", body.id)
    .eq("status", "pending")
    .select("id");
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  if (Array.isArray(cancelled) && cancelled.length > 0) {
    const cancelActorId = (await supabase.auth.getUser()).data.user?.id ?? null;
    await recordAdminEvent({
      action: "invitation_revoked",
      actorId: cancelActorId,
      targetId: null,
      metadata: { invitation_id: String(body.id) },
    });
  }
  return NextResponse.json({ data: { ok: true } });
}

export async function DELETE(request: NextRequest) {
  const { supabase, error } = await ownerClient();
  if (error || !supabase) return error!;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing invitation id." }, { status: 400 });
  const { data: deleted, error: dErr } = await supabase.from("invitations").delete().eq("id", id).select("id");
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  if (Array.isArray(deleted) && deleted.length > 0) {
    const deleteActorId = (await supabase.auth.getUser()).data.user?.id ?? null;
    await recordAdminEvent({
      action: "invitation_deleted",
      actorId: deleteActorId,
      targetId: null,
      metadata: { invitation_id: String(id) },
    });
  }
  return NextResponse.json({ data: { ok: true } });
}
