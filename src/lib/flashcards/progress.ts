/**
 * FLASHCARD PROGRESS (2026-11-13, directive Part 6: "track progress", "identify
 * difficult cards", "simple progress indicators").
 *
 * Pure and honest. Two rules matter here:
 *
 *   1. No invented percentages. With no reviews the accuracy is `null`, not 100%,
 *      and every percentage is reported with the number it came from, so a student
 *      who answered one card is never shown "100% mastery".
 *   2. Plain words. The four answers are described in ordinary language (Part 12):
 *      "again" is incorrect, "hard" is partially understood, "good" is correct,
 *      "easy" is confident. Nothing here shows a student a rating letter or a
 *      scheduler term.
 */

import type { Rating } from "./schedule";

export interface ReviewRow {
  rating: Rating;
  /** ISO-8601 instant, from the append-only log. */
  reviewedAt: string;
}

export interface ProgressSummary {
  reviews: number;
  correct: number;
  partiallyUnderstood: number;
  incorrect: number;
  confident: number;
  /** null when there are no reviews - never a fake 100%. */
  accuracy: number | null;
  /** Reviews per calendar day (UTC), oldest first, only days with activity. */
  byDay: { day: string; reviews: number; correct: number }[];
  windowDays: number;
  since: string;
}

export interface DifficultCard {
  id: string;
  front: string;
  lapses: number;
  reps: number;
  dueAt: string;
}

const DAY_MS = 86400000;

/** Plain-language wording for the four answers, for any screen that shows them. */
export const RATING_GUIDE: { rating: Rating; label: string; meant: string }[] = [
  { rating: "again", label: "Not yet", meant: "You could not recall it. It comes back in a few minutes." },
  { rating: "hard", label: "Partially", meant: "You got part of it. It comes back soon." },
  { rating: "good", label: "Correct", meant: "You recalled it. The gap grows." },
  { rating: "easy", label: "Confident", meant: "That was easy. The gap grows faster." },
];

/**
 * Summarise the append-only log over a window ending now.
 * Rows outside the window, or with an unparseable date, are ignored - never counted
 * as a correct answer.
 */
export function summarizeReviews(rows: ReviewRow[], nowISO: string, windowDays = 30): ProgressSummary {
  const now = Date.parse(nowISO);
  const window = Math.max(1, Math.floor(windowDays));
  const sinceMs = now - window * DAY_MS;
  const since = new Date(sinceMs).toISOString();

  const relevant = rows.filter((r) => {
    const t = Date.parse(r.reviewedAt);
    return Number.isFinite(t) && t <= now && t >= sinceMs;
  });

  const count = (rating: Rating) => relevant.filter((r) => r.rating === rating).length;
  const correct = count("good");
  const easy = count("easy");
  const partiallyUnderstood = count("hard");
  const incorrect = count("again");
  const total = relevant.length;

  const days = new Map<string, { reviews: number; correct: number }>();
  for (const row of relevant) {
    const day = new Date(Date.parse(row.reviewedAt)).toISOString().slice(0, 10);
    const entry = days.get(day) ?? { reviews: 0, correct: 0 };
    entry.reviews += 1;
    if (row.rating === "good" || row.rating === "easy") entry.correct += 1;
    days.set(day, entry);
  }

  return {
    reviews: total,
    correct: correct + easy,
    partiallyUnderstood,
    incorrect,
    confident: easy,
    accuracy: total === 0 ? null : Math.round(((correct + easy) / total) * 1000) / 10,
    byDay: [...days.entries()]
      .map(([day, v]) => ({ day, reviews: v.reviews, correct: v.correct }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    windowDays: window,
    since,
  };
}

/** Cards worth extra attention: most lapses first, then soonest due. */
export function difficultCards<T extends { id: string; front: string; lapses: number; reps: number; dueAt: string; retired?: boolean }>(
  cards: T[],
  minLapses = 2,
  limit = 10,
): DifficultCard[] {
  return cards
    .filter((c) => !c.retired && c.lapses >= minLapses)
    .sort((a, b) => (b.lapses - a.lapses) || (Date.parse(a.dueAt) - Date.parse(b.dueAt)))
    .slice(0, Math.max(0, limit))
    .map((c) => ({ id: c.id, front: c.front, lapses: c.lapses, reps: c.reps, dueAt: c.dueAt }));
}

/** One plain sentence a screen can print without inventing anything. */
export function progressSentence(summary: ProgressSummary, dueNow: number, totalCards: number): string {
  if (totalCards === 0) return "No cards yet. Create a deck from your notebook study material to begin.";
  if (summary.reviews === 0) return `${totalCards} card${totalCards === 1 ? "" : "s"} ready. You have not reviewed any yet.`;
  const accuracy = summary.accuracy === null ? "" : ` You recognised ${summary.accuracy}% of your answers.`;
  return `${dueNow} card${dueNow === 1 ? "" : "s"} due now. In the last ${summary.windowDays} days you made ${summary.reviews} review${summary.reviews === 1 ? "" : "s"}.${accuracy}`;
}
