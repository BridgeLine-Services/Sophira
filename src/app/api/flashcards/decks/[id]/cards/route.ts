import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { normalizeCard } from "@/lib/flashcards/decks";

export const runtime = "nodejs";

/**
 * ADD A CARD TO AN EXISTING DECK (2026-11-13, directive Part 6: "create decks
 * manually", "edit flashcards").
 *
 *   POST /api/flashcards/decks/:id/cards { front, back, citation? }
 *
 * The deck is verified to belong to the signed-in student before anything is
 * written, and the new card arrives due now so it can be studied immediately.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const { data: deck } = await supabase
    .from("flashcard_decks")
    .select("id")
    .eq("id", id)
    .eq("user_id", guard.data.user.id)
    .single();
  if (!deck) return NextResponse.json({ error: "That deck could not be found." }, { status: 404 });

  let body: { front?: unknown; back?: unknown; citation?: unknown } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const card = normalizeCard(body);
  if (!card) return NextResponse.json({ error: "A card needs both a front and a back." }, { status: 400 });

  const { count } = await supabase
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("deck_id", id)
    .eq("user_id", guard.data.user.id);

  const { data, error } = await supabase
    .from("flashcards")
    .insert({
      deck_id: id,
      user_id: guard.data.user.id,
      front: card.front,
      back: card.back,
      citation: card.citation,
      position: count ?? 0,
      due_at: new Date().toISOString(),
    })
    .select("id, deck_id, front, back, citation, position, due_at, reps, lapses, retired")
    .single();
  if (error || !data) return NextResponse.json({ error: "The card could not be saved." }, { status: 500 });
  return NextResponse.json({ data }, { status: 201 });
}
