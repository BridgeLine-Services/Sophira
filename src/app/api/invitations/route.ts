import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/supabase/guard";

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

  const token = randomBytes(24).toString("hex");
  // Optional expiry window, clamped to a sane range (default 14 days).
  const days = Math.min(90, Math.max(1, Math.round(body.expires_days ?? 14)));
  const { data, error: iErr } = await supabase
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

  const origin = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  return NextResponse.json({ data: { ...data, link: `${origin}/signup?invite=${token}` } });
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
