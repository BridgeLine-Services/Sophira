import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { listEvidence, studentMemoryAction } from "@/lib/memory/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One memory: evidence inspection, editing, and lifecycle control —
 * all restricted to the signed-in student (guard + user_id + RLS).
 *
 * GET   /api/memory/[id] — the memory with its full structured evidence.
 * PATCH /api/memory/[id] — edit statement/details/subject, or perform a
 *                         lifecycle action (archive/disable/restore/
 *                         forget/mark_improving/mark_contradicted).
 * DELETE /api/memory/[id] — forget permanently: deletes the memory AND
 *                         every evidence row (hard delete, irreversible).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  const { data: memory } = await supabase
    .from("student_memories")
    .select("*")
    .eq("id", id)
    .eq("user_id", guard.data.user.id)
    .single();
  if (!memory) return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  const evidence = await listEvidence(supabase, guard.data.user.id, id);
  return NextResponse.json({ data: { memory, evidence } });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : null;
  if (action) {
    const result = await studentMemoryAction(
      supabase,
      guard.data.user.id,
      id,
      action as never,
    );
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ data: { ok: true } });
  }

  const updates: Record<string, unknown> = {};
  if (typeof body.statement === "string" && body.statement.trim().length >= 3) {
    updates.statement = body.statement.trim().slice(0, 200);
  }
  if (typeof body.details === "string") updates.details = body.details.slice(0, 2000);
  if (body.subject === null || typeof body.subject === "string") {
    const subject = body.subject ? String(body.subject).trim() : null;
    updates.subject = subject;
    updates.subject_tags = subject ? [subject.toLowerCase()] : [];
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  updates.updated_at = new Date().toISOString();

  const { data: memory, error } = await supabase
    .from("student_memories")
    .update(updates)
    .eq("id", id)
    .eq("user_id", guard.data.user.id)
    .select()
    .single();
  if (error || !memory) {
    return NextResponse.json({ error: error?.message || "Could not update the memory." }, { status: 500 });
  }
  return NextResponse.json({ data: memory });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { id } = await params;

  // Evidence rows cascade (on delete cascade in the schema); the
  // explicit delete below is belt-and-braces for older schema states.
  await supabase
    .from("student_memory_evidence")
    .delete()
    .eq("memory_id", id)
    .eq("user_id", guard.data.user.id);
  const { error } = await supabase
    .from("student_memories")
    .delete()
    .eq("id", id)
    .eq("user_id", guard.data.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: { ok: true } });
}
