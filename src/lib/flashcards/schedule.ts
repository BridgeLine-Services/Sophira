/**
 * FLASHCARD SCHEDULING (2026-11-13, directive Part 6).
 *
 * A deterministic SM-2 style scheduler. Pure: no clock, no randomness, no IO -
 * the caller passes `nowISO`, which is what makes every rule below testable.
 *
 * WHY THIS SHAPE
 *   - One answer produces one new state and one log line. The state lives on the
 *     card for fast "what is due" reads; the log preserves every answer, so state
 *     can be audited or rebuilt and a scheduling mistake never destroys history.
 *   - "again" means the student could not recall it: the card comes back in
 *     minutes (not tomorrow), the ease drops, and the lapse is counted. It never
 *     pretends the student is progressing.
 *   - Easiness and interval are clamped. An unbounded multiplier quickly produces
 *     year-long gaps from a handful of lucky answers, which is how spaced
 *     repetition systems quietly stop teaching anything.
 *   - Honest output: `intervalDays` is what the next gap actually is, and
 *     `elapsedDays` is null (not 0) when there is no previous review, so a
 *     consumer can tell "first review" from "reviewed twice in one minute".
 */

export type Rating = "again" | "hard" | "good" | "easy";

export interface CardState {
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  /** ISO-8601 UTC instant when this card is next due. */
  dueAt: string;
  lastReviewedAt: string | null;
}

export interface ReviewOutcome {
  state: CardState;
  intervalBefore: number;
  intervalAfter: number;
  easeAfter: number;
  dueAfter: string;
  elapsedDays: number | null;
}

export const MIN_EASE = 1.3;
export const MAX_EASE = 2.8;
export const INITIAL_EASE = 2.5;
export const MAX_INTERVAL_DAYS = 365;
/** "again" brings the card back in ten minutes. */
export const RELEARN_MINUTES = 10;
export const RATINGS: Rating[] = ["again", "hard", "good", "easy"];

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export function isRating(value: unknown): value is Rating {
  return typeof value === "string" && (RATINGS as string[]).includes(value);
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round2 = (n: number) => Math.round(n * 100) / 100;
const iso = (ms: number) => new Date(ms).toISOString();

export function initialState(nowISO: string): CardState {
  return { intervalDays: 0, ease: INITIAL_EASE, reps: 0, lapses: 0, dueAt: nowISO, lastReviewedAt: null };
}

/**
 * Apply one answer. The elapsed time is measured from the previous review when
 * there is one; a negative elapsed (clock skew, replayed payload) is reported as
 * 0 rather than as a time machine.
 */
export function scheduleReview(state: CardState, rating: Rating, nowISO: string): ReviewOutcome {
  const now = Date.parse(nowISO);
  if (!Number.isFinite(now)) throw new Error("scheduleReview: nowISO must be an ISO-8601 instant");

  const intervalBefore = Math.max(0, state.intervalDays);
  const elapsedDays = state.lastReviewedAt
    ? Math.max(0, round2((now - Date.parse(state.lastReviewedAt)) / DAY_MS))
    : null;

  let ease = state.ease;
  let interval = intervalBefore;
  let reps = state.reps;
  let lapses = state.lapses;
  // "again" is the only rating that comes back within minutes.
  let dueMs: number;

  switch (rating) {
    case "again":
      ease -= 0.2;
      interval = 0;
      lapses += 1;
      // The repetition count resets: this card is not learned, whatever it was before.
      reps = 0;
      dueMs = now + RELEARN_MINUTES * MINUTE_MS;
      break;
    case "hard":
      ease -= 0.15;
      // A hard card still advances, but slowly - never backwards past one day.
      interval = state.reps === 0 ? 0.5 : Math.max(1, intervalBefore * 1.2);
      reps += 1;
      dueMs = now + interval * DAY_MS;
      break;
    case "good":
      if (state.reps === 0) interval = 1;
      else if (state.reps === 1) interval = 3;
      else interval = intervalBefore * state.ease;
      reps += 1;
      dueMs = now + interval * DAY_MS;
      break;
    case "easy":
      ease += 0.15;
      if (state.reps === 0) interval = 3;
      else interval = Math.max(1, intervalBefore * state.ease * 1.3);
      reps += 1;
      dueMs = now + interval * DAY_MS;
      break;
  }

  interval = Math.min(round2(interval), MAX_INTERVAL_DAYS);
  ease = round2(clamp(ease, MIN_EASE, MAX_EASE));
  // Apply the cap to the instant too, so state and dueAt can never disagree.
  const cappedDue = rating === "again"
    ? dueMs
    : Math.min(dueMs, now + MAX_INTERVAL_DAYS * DAY_MS);

  return {
    state: { intervalDays: interval, ease, reps, lapses, dueAt: iso(cappedDue), lastReviewedAt: nowISO },
    intervalBefore,
    intervalAfter: interval,
    easeAfter: ease,
    dueAfter: iso(cappedDue),
    elapsedDays,
  };
}

export interface ReviewableCard {
  id: string;
  dueAt: string;
  retired?: boolean;
}

export function isDue(card: ReviewableCard, nowISO: string): boolean {
  if (card.retired) return false;
  const due = Date.parse(card.dueAt);
  const now = Date.parse(nowISO);
  if (!Number.isFinite(due) || !Number.isFinite(now)) return false;
  return due <= now;
}

/** Due cards, soonest first, capped. A retired card is never due. */
export function dueCards<T extends ReviewableCard>(cards: T[], nowISO: string, limit = 40): T[] {
  return cards
    .filter((c) => isDue(c, nowISO))
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))
    .slice(0, Math.max(0, limit));
}

export interface DeckSummary {
  total: number;
  due: number;
  learned: number;
  newCards: number;
  lapses: number;
}

/** Plain counts for a deck card. No invented "mastery percentage". */
export function deckSummary(cards: (ReviewableCard & { reps: number; lapses: number })[], nowISO: string): DeckSummary {
  const live = cards.filter((c) => !c.retired);
  return {
    total: live.length,
    due: live.filter((c) => isDue(c, nowISO)).length,
    // "learned" = answered correctly enough to reach a multi-day interval.
    learned: live.filter((c) => c.reps >= 2).length,
    newCards: live.filter((c) => c.reps === 0).length,
    lapses: live.reduce((n, c) => n + (c.lapses || 0), 0),
  };
}
