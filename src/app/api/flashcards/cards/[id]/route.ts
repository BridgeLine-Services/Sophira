import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { normalizeCard } from "@/lib/flashcards/decks";

export const runtime = "nodejs";

/**
 * EDIT OR REMOVE ONE CARD (2026-11-13, directive Part 6: "edit flashcards",
 * "delete flashcards they own").
 *
 *   PATCH  /api/flashcards/cards/:id  { front?, back?, citation?, retired? }
 *   DELETE /api/flashcards/cards/:id
 *
 * Editing a card never touches its review state: a typo fix must not reset a
 * student's progress or reschedule the card. "Retire" keeps the card and its
 * history but takes it out of the queue; delete removes it for good. Both are
 * scoped to the signed-in student, so another student's card is a 404.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { front?: unknown; back?: unknown; citation?: unknown; retired?: unknown } = {};
  try { body = await request.json(); } catch { /* empty */ }

  const patch: Record<string, unknown> = {};
  if (body.front !== undefined || body.back !== undefined) {
    const { data: existing } = await supabase
      .from("flashcards")
      .select("front, back, citation")
      .eq("id", id)
      .eq("user_id", guard.data.user.id)
      .single();
    if (!existing) return NextResponse.json({ error: "That card could not be found." }, { status: 404 });
    // Both sides are required, so an edit that empties one is refused rather than
    // silently producing a card that cannot be answered.
    const merged = normalizeCard({
      front: body.front !== undefined ? body.front : (existing as { front: string }).front,
      back: body.back !== undefined ? body.back : (existing as { back: string }).back,
      citation: body.citation !== undefined ? body.citation : (existing as { citation: string }).citation,
    });
    if (!merged) {
      return NextResponse.json({ error: "A card needs both a front and a back before it can be saved." }, { status: 400 });
    }
    patch.front = merged.front;
    patch.back = merged.back;
    patch.citation = merged.citation;
  }
  if (body.retired !== undefined) {
    if (typeof body.retired !== "boolean") return NextResponse.json({ error: "That change is not understood." }, { status: 400 });
    patch.retired = body.retired;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { data, error } = await supabase
    .from("flashcards")
    .update(patch)
    .eq("id", id)
    .eq("user_id", guard.data.user.id)
    .select("id, deck_id, front, back, citation, position, due_at, reps, lapses, retired")
    .single();
  if (error || !data) return NextResponse.json({ error: "That card could not be updated." }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const { data, error } = await supabase
    .from("flashcards")
    .delete()
    .eq("id", id)
    .eq("user_id", guard.data.user.id)
    .select("id");
  if (error) return NextResponse.json({ error: "That card could not be removed." }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "That card could not be found." }, { status: 404 });
  return NextResponse.json({ data: { deleted: true, id } });
}
