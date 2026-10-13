import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";

/**
 * Notes:
 *   GET  /api/notebooks/:id/notes      — list notes
 *   POST /api/notebooks/:id/notes      — add a note (optionally linked to a source)
 */

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { data, error } = await supabase
    .from("notebook_notes")
    .select("*")
    .eq("notebook_id", id)
    .eq("user_id", guard.data.user.id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "Could not load notes." }, { status: 500 });
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  const { data: notebook } = await supabase.from("notebooks").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!notebook) return NextResponse.json({ error: "Notebook not found." }, { status: 404 });
  let body: { content?: string; source_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const content = (body.content || "").trim();
  if (!content) return NextResponse.json({ error: "Write the note first." }, { status: 400 });
  const { data, error } = await supabase
    .from("notebook_notes")
    .insert({ notebook_id: id, user_id: user.id, content, source_id: body.source_id ?? null })
    .select()
    .single();
  if (error) return NextResponse.json({ error: "Could not save the note." }, { status: 500 });
  return NextResponse.json({ note: data });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  const noteId = new URL(request.url).searchParams.get("note_id") || "";
  if (!noteId) return NextResponse.json({ error: "Missing note id." }, { status: 400 });
  const { data: nb } = await supabase.from("notebooks").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!nb) return NextResponse.json({ error: "Notebook not found." }, { status: 404 });
  const { error } = await supabase.from("notebook_notes").delete().eq("id", noteId).eq("notebook_id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Could not delete the note." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
