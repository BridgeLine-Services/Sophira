import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function requireOwner() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (!profile || profile.role !== "owner") {
    return { error: NextResponse.json({ error: "Only the owner can manage invitations." }, { status: 403 }) };
  }
  return { supabase };
}

export async function GET() {
  const { supabase, error } = await requireOwner();
  if (error) return error;
  const { data, error: qErr } = await supabase
    .from("invitations")
    .select("*")
    .order("created_at", { ascending: false });
  if (qErr) return NextResponse.json({ error: qErr.message }, { status: 500 });
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest) {
  const { supabase, error } = await requireOwner();
  if (error) return error;

  let body: { email?: string };
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
  const { data, error: iErr } = await supabase
    .from("invitations")
    .insert({ email, token, invited_by: (await supabase.auth.getUser()).data.user!.id })
    .select("*")
    .single();
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });

  const origin = process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin;
  return NextResponse.json({ data: { ...data, link: `${origin}/signup?invite=${token}` } });
}

export async function DELETE(request: NextRequest) {
  const { supabase, error } = await requireOwner();
  if (error) return error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing invitation id." }, { status: 400 });
  const { error: dErr } = await supabase.from("invitations").delete().eq("id", id);
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 });
  return NextResponse.json({ data: { ok: true } });
}
