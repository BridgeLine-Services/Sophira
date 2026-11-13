import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { dueCards } from "@/lib/flashcards/schedule";

export const runtime = "nodejs";

/**
 * WHAT TO STUDY NOW (2026-11-13, directive Part 6).
 *
 *   GET /api/flashcards/due?limit=20&deck_id=…
 *
 * Returns the cards whose due_at has passed, soonest first, plus the deck title so
 * the student can see where a card came from. `released_at` is the server clock the
 * queue was built with, so the client never has to trust its own clock.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.floor(rawLimit))) : 20;
  const deckId = url.searchParams.get("deck_id");

  const nowISO = new Date().toISOString();
  let query = supabase
    .from("flashcards")
    .select("id, deck_id, front, back, citation, due_at, reps, lapses, retired, interval_days")
    .eq("user_id", guard.data.user.id)
    .eq("retired", false)
    .lte("due_at", nowISO)
    .order("due_at", { ascending: true })
    .limit(limit);
  if (deckId) query = query.eq("deck_id", deckId);

  const { data: rows, error } = await query;
  if (error) return NextResponse.json({ error: "Your review queue could not be loaded." }, { status: 500 });

  const cards = (rows ?? []).map((c) => ({
    id: (c as { id: string }).id,
    deck_id: (c as { deck_id: string }).deck_id,
    front: (c as { front: string }).front,
    back: (c as { back: string }).back,
    citation: (c as { citation: string }).citation,
    due_at: (c as { due_at: string }).due_at,
    reps: (c as { reps: number }).reps ?? 0,
    lapses: (c as { lapses: number }).lapses ?? 0,
  }));

  // Re-sorted with the same pure helper the tests exercise, so the server and the
  // tested logic cannot disagree about what "due" means.
  const ordered = dueCards(cards.map((c) => ({ ...c, dueAt: c.due_at })), nowISO, limit);

  const deckIds = [...new Set(ordered.map((c) => c.deck_id))];
  const titles = new Map<string, string>();
  if (deckIds.length) {
    const { data: decks } = await supabase
      .from("flashcard_decks")
      .select("id, title")
      .eq("user_id", guard.data.user.id)
      .in("id", deckIds);
    for (const d of decks ?? []) titles.set((d as { id: string }).id, (d as { title: string }).title);
  }

  return NextResponse.json({
    data: {
      released_at: nowISO,
      count: ordered.length,
      cards: ordered.map((c) => ({ ...c, deck_title: titles.get(c.deck_id) ?? "" })),
    },
  });
}
