import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { deckSummary, type ReviewableCard } from "@/lib/flashcards/schedule";

export const runtime = "nodejs";

/**
 * ONE DECK (2026-11-13): read its cards, rename it, or remove it.
 *   GET    /api/flashcards/decks/:id  → the deck, its cards, and honest counts
 *   PATCH  /api/flashcards/decks/:id  { title?, description? }
 *   DELETE /api/flashcards/decks/:id  → removes the deck (cards and review log
 *          cascade). Deleting is explicit; nothing here silently retires cards.
 */

interface CardRow extends ReviewableCard {
  reps: number;
  lapses: number;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const { data: deck, error } = await supabase
    .from("flashcard_decks")
    .select("id, title, description, notebook_id, course_id, source_artifact_id, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", guard.data.user.id)
    .single();
  if (error || !deck) return NextResponse.json({ error: "That deck could not be found." }, { status: 404 });

  const { data: cards, error: cardError } = await supabase
    .from("flashcards")
    .select("id, front, back, citation, position, interval_days, ease, reps, lapses, due_at, last_reviewed_at, retired")
    .eq("deck_id", id)
    .eq("user_id", guard.data.user.id)
    .order("position", { ascending: true });
  if (cardError) return NextResponse.json({ error: "The cards in this deck could not be loaded." }, { status: 500 });

  const nowISO = new Date().toISOString();
  const summaryRows: CardRow[] = (cards ?? []).map((c) => ({
    id: (c as { id: string }).id,
    dueAt: (c as { due_at: string }).due_at,
    reps: (c as { reps: number }).reps ?? 0,
    lapses: (c as { lapses: number }).lapses ?? 0,
    retired: (c as { retired: boolean }).retired ?? false,
  }));

  return NextResponse.json({ data: { deck, cards: cards ?? [], summary: deckSummary(summaryRows, nowISO) } });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { title?: string; description?: string } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const patch: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    const title = body.title.trim();
    if (!title) return NextResponse.json({ error: "A deck needs a title." }, { status: 400 });
    patch.title = title.slice(0, 160);
  }
  if (typeof body.description === "string") patch.description = body.description.slice(0, 2000);
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });

  const { data, error } = await supabase
    .from("flashcard_decks")
    .update(patch)
    .eq("id", id)
    .eq("user_id", guard.data.user.id)
    .select("id, title, description, updated_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "That deck could not be updated." }, { status: 500 });
  return NextResponse.json({ data });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const { data, error } = await supabase
    .from("flashcard_decks")
    .delete()
    .eq("id", id)
    .eq("user_id", guard.data.user.id)
    .select("id");
  if (error) return NextResponse.json({ error: "The deck could not be removed." }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "That deck could not be found." }, { status: 404 });
  return NextResponse.json({ data: { deleted: true, id } });
}
