import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";

/**
 * GET    /api/notebooks/:id — notebook with sources, notes, questions,
 *                             evidence, artifacts (OWNER ONLY — RLS enforced)
 * PATCH  /api/notebooks/:id — rename/describe
 * DELETE /api/notebooks/:id — delete the whole notebook (owner only)
 */

async function resolveNotebook(supabase: Awaited<ReturnType<typeof createClient>>, id: string, userId: string) {
  const { data, error } = await supabase.from("notebooks").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  const notebook = await resolveNotebook(supabase, id, user.id);
  if (!notebook) return NextResponse.json({ error: "Notebook not found." }, { status: 404 });
  const [sources, notes, questions, evidence, artifacts] = await Promise.all([
    supabase.from("notebook_sources").select("*").eq("notebook_id", id).is("archived_at", null).order("created_at", { ascending: true }),
    supabase.from("notebook_notes").select("*").eq("notebook_id", id).is("archived_at", null).order("created_at", { ascending: false }).limit(200),
    supabase.from("notebook_questions").select("*").eq("notebook_id", id).is("archived_at", null).order("created_at", { ascending: false }).limit(100),
    supabase.from("notebook_evidence").select("*").eq("notebook_id", id).is("archived_at", null).order("created_at", { ascending: false }).limit(500),
    supabase.from("notebook_artifacts").select("*").eq("notebook_id", id).is("archived_at", null).order("created_at", { ascending: false }).limit(100),
  ]);
  return NextResponse.json({
    notebook,
    sources: sources.data ?? [],
    notes: notes.data ?? [],
    questions: questions.data ?? [],
    evidence: evidence.data ?? [],
    artifacts: artifacts.data ?? [],
  });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  if (!(await resolveNotebook(supabase, id, user.id))) {
    return NextResponse.json({ error: "Notebook not found." }, { status: 404 });
  }
  let body: { title?: string; description?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const patch: Record<string, string> = {};
  if (typeof body.title === "string" && body.title.trim().length >= 2) patch.title = body.title.trim();
  if (typeof body.description === "string") patch.description = body.description.trim();
  patch.updated_at = new Date().toISOString();
  // Revision-aware write (Phase 6, 2026-11-10): the editor sends the version it
  // started from. If the notebook has moved on since - another tab or another
  // device - this write is refused instead of quietly overwriting newer work.
  // A client that sends no version behaves exactly as before.
  const baseVersion = request.headers.get("x-sophira-base-version");
  let write = supabase.from("notebooks").update(patch).eq("id", id).eq("user_id", user.id);
  if (baseVersion) write = write.eq("updated_at", baseVersion);
  const { data, error } = await write.select().maybeSingle();
  if (error) return NextResponse.json({ error: "Could not update the notebook." }, { status: 500 });
  if (!data) {
    return NextResponse.json({
      error: "Another version of this notebook was saved somewhere else. Your text is still here - choose which version to keep.",
      conflict: true,
    }, { status: 409 });
  }
  return NextResponse.json({ notebook: data });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  if (!(await resolveNotebook(supabase, id, user.id))) {
    return NextResponse.json({ error: "Notebook not found." }, { status: 404 });
  }
  const { error } = await supabase.from("notebooks").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Could not delete the notebook." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
