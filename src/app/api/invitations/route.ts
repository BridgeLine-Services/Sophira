import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/supabase/guard";
import { sendInvitationEmail, invitationEmailNote } from "@/lib/invitations/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownerClient() {
  const supabase = createClient();
  const guard = await requireOwner(supabase);
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

  let body: { email?: string; expires_days?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const email = (body.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

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
  const emailResult = await sendInvitationEmail({ to: email, link, siteUrl: origin });
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

  return NextResponse.json({
    data: {
      ...row,
      link,
      reused: Boolean(existing),
      email_status: emailResult.status,
      email_note: invitationEmailNote(emailResult, email),
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
  const { error: uErr } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", body.id)
    .eq("status", "pending");
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });
  return NextResponse.json({ data: { ok: true } });
}

export async function DELETE(request: NextRequest) {
  const { supabase, error } = await ownerClient();
  if (error || !supabase) return error!;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing invitation id." }, { status: 400 });
  const { error: dErr } = await supabase.from("invitations").delete().eq("id", id);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  return NextResponse.json({ data: { ok: true } });
}
