import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { deckSummary, type ReviewableCard } from "@/lib/flashcards/schedule";
import { difficultCards, progressSentence, RATING_GUIDE, summarizeReviews } from "@/lib/flashcards/progress";
import type { Rating } from "@/lib/flashcards/schedule";

export const runtime = "nodejs";

/**
 * STUDY PROGRESS IN PLAIN LANGUAGE (2026-11-13, directive Part 6 + Part 12).
 *
 *   GET /api/flashcards/progress?days=30&course_id=…
 *
 * Returns counts the student can act on (due now, learned, difficult cards), the
 * accuracy over the window WITH the number of answers behind it, and one plain
 * sentence a screen can print. Accuracy is null, not 100%, when nothing has been
 * reviewed. Reads are owner-scoped; the review log is only ever read here.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const rawDays = Number(url.searchParams.get("days") ?? 30);
  const days = Number.isFinite(rawDays) ? Math.min(365, Math.max(1, Math.floor(rawDays))) : 30;
  const courseId = url.searchParams.get("course_id");

  const { data: cards, error } = await supabase
    .from("flashcards")
    .select("id, deck_id, front, due_at, reps, lapses, retired")
    .eq("user_id", guard.data.user.id);
  if (error) return NextResponse.json({ error: "Your study progress could not be loaded." }, { status: 500 });

  const nowISO = new Date().toISOString();
  const rows = (cards ?? []).map((c) => ({
    id: (c as { id: string }).id,
    deckId: (c as { deck_id: string }).deck_id,
    front: (c as { front: string }).front,
    dueAt: (c as { due_at: string }).due_at,
    reps: (c as { reps: number }).reps ?? 0,
    lapses: (c as { lapses: number }).lapses ?? 0,
    retired: (c as { retired: boolean }).retired ?? false,
  }));

  const since = new Date(Date.parse(nowISO) - days * 86400000).toISOString();
  const { data: reviews, error: reviewError } = await supabase
    .from("flashcard_reviews")
    .select("rating, reviewed_at")
    .eq("user_id", guard.data.user.id)
    .gte("reviewed_at", since)
    .order("reviewed_at", { ascending: false })
    .limit(5000);

  const summary = summarizeReviews(
    (reviews ?? []).map((r) => ({ rating: (r as { rating: Rating }).rating, reviewedAt: (r as { reviewed_at: string }).reviewed_at })),
    nowISO,
    days,
  );
  const overall = deckSummary(rows as (ReviewableCard & { reps: number; lapses: number })[], nowISO);

  return NextResponse.json({
    data: {
      days,
      course_id: courseId,
      cards: overall,
      reviews: summary,
      difficult: difficultCards(rows, 2, 10),
      // Plain words, so a screen never has to explain a scheduler term (Part 12).
      rating_guide: RATING_GUIDE,
      sentence: progressSentence(summary, overall.due, overall.total),
      // A read failure of the history is reported, not rendered as "no progress".
      warning: reviewError ? "Your review history could not be read, so these totals may be incomplete." : undefined,
    },
  });
}
