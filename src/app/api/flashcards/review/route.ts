import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { isRating, scheduleReview, type CardState } from "@/lib/flashcards/schedule";

export const runtime = "nodejs";

/**
 * ANSWER ONE CARD (2026-11-13, directive Part 6).
 *
 *   POST /api/flashcards/review { card_id, rating: "again"|"hard"|"good"|"easy" }
 *
 * Two writes, in this order, both scoped to the signed-in student:
 *   1. the card's current state (interval/ease/reps/lapses/due) from the pure
 *      scheduler in src/lib/flashcards/schedule.ts;
 *   2. an append-only log row describing what changed and what the student said.
 *
 * The client never sends the next interval or the due date - it cannot inflate
 * its own progress. An unknown rating is refused rather than treated as "good".
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { card_id?: string; rating?: string } = {};
  try { body = await request.json(); } catch { /* empty */ }
  const cardId = (body.card_id ?? "").trim();
  if (!cardId) return NextResponse.json({ error: "Which card did you answer?" }, { status: 400 });
  if (!isRating(body.rating)) {
    return NextResponse.json({
      error: "Answer with one of: again (could not recall), hard, good, easy.",
    }, { status: 400 });
  }

  const { data: card, error } = await supabase
    .from("flashcards")
    .select("id, deck_id, interval_days, ease, reps, lapses, due_at, last_reviewed_at, retired")
    .eq("id", cardId)
    .eq("user_id", guard.data.user.id)
    .single();
  if (error || !card) return NextResponse.json({ error: "That card could not be found." }, { status: 404 });
  if ((card as { retired: boolean }).retired) {
    return NextResponse.json({ error: "That card is retired and no longer reviewed." }, { status: 409 });
  }

  const current: CardState = {
    intervalDays: Number((card as { interval_days: number }).interval_days ?? 0),
    ease: Number((card as { ease: number }).ease ?? 2.5),
    reps: Number((card as { reps: number }).reps ?? 0),
    lapses: Number((card as { lapses: number }).lapses ?? 0),
    dueAt: (card as { due_at: string }).due_at,
    lastReviewedAt: (card as { last_reviewed_at: string | null }).last_reviewed_at,
  };
  const nowISO = new Date().toISOString();
  const outcome = scheduleReview(current, body.rating, nowISO);

  const { data: updated, error: updateError } = await supabase
    .from("flashcards")
    .update({
      interval_days: outcome.state.intervalDays,
      ease: outcome.state.ease,
      reps: outcome.state.reps,
      lapses: outcome.state.lapses,
      due_at: outcome.state.dueAt,
      last_reviewed_at: outcome.state.lastReviewedAt,
    })
    .eq("id", cardId)
    .eq("user_id", guard.data.user.id)
    .select("id, interval_days, ease, reps, lapses, due_at, last_reviewed_at")
    .single();
  if (updateError || !updated) return NextResponse.json({ error: "Your answer could not be saved, so nothing changed." }, { status: 500 });

  const { error: logError } = await supabase.from("flashcard_reviews").insert({
    card_id: cardId,
    deck_id: (card as { deck_id: string }).deck_id,
    user_id: guard.data.user.id,
    rating: body.rating,
    reviewed_at: nowISO,
    interval_before: outcome.intervalBefore,
    interval_after: outcome.intervalAfter,
    ease_after: outcome.easeAfter,
    due_after: outcome.dueAfter,
    elapsed_days: outcome.elapsedDays,
  });
  // The state is saved; a failed log row must be visible, not hidden.
  const warning = logError ? "Your progress was saved, but the review history entry could not be written." : undefined;

  return NextResponse.json({ data: { card: updated, scheduled: outcome, warning } });
}
