/**
 * MEANINGFUL ACTIVITY AND LIVE PRESENCE ARE TWO DIFFERENT QUESTIONS
 * (2026-11-15).
 *
 * Sophira answers both, and they must never be collapsed into one value:
 *
 *   "Is this person at their screen right now?"      -> member_presence (live)
 *   "When did this person last actually use Sophira?" -> profiles.last_active_at
 *
 * The second used to be written by one line on the student dashboard, so an
 * Owner who was genuinely working all day still read as "Last active 4 days
 * ago" while their own presence said Active. Both were true of different
 * columns; that is what made the pair look wrong.
 *
 * The database rule now lives in public.presence_heartbeat() (migration 0060):
 * a meaningful interaction advances the caller's own last_active_at, at most
 * once per member per minute, using the WHERE clause as the atomic test. This
 * module is the executable statement of that same rule, so the server, the API
 * and every panel agree, and so the rule can be tested without a database.
 *
 * It is deliberately dependency-free and pure: no React, no Supabase, no clock
 * of its own. Anything that needs "now" is given it.
 */

/** At most one account-record write per member per this many seconds (0060). */
export const ACTIVITY_THROTTLE_SECONDS = 60;

/** The same window in milliseconds, for callers that work in milliseconds. */
export const ACTIVITY_THROTTLE_MS = ACTIVITY_THROTTLE_SECONDS * 1_000;

/**
 * What the server actually did with an interaction. These are the four words
 * presence_heartbeat() returns in its `activity` field, and the only ones any
 * screen may claim.
 */
export const ACTIVITY_OUTCOMES = ["idle", "recorded", "throttled", "failed"] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

/** True only for the four values the database can return. Anything else is unknown. */
export function isActivityOutcome(value: unknown): value is ActivityOutcome {
  return typeof value === "string" && (ACTIVITY_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Would a meaningful interaction at `nowMs` be written, or is the stored value
 * still inside the throttle window?
 *
 * This mirrors the SQL predicate exactly:
 *   last_active_at is null or last_active_at <= now() - interval '60 seconds'
 *
 * A missing or unreadable stored value counts as "record it": the first genuine
 * interaction a member ever makes must land, and there is nothing to protect.
 * A stored value in the future (clock skew between two servers) is NOT treated
 * as fresh forever; it is treated as older-than-window, because refusing to
 * ever record again is the worse failure.
 */
export function shouldRecordActivity(
  lastActiveAt: string | null | undefined,
  nowMs: number,
  throttleMs: number = ACTIVITY_THROTTLE_MS,
): boolean {
  if (lastActiveAt === null || lastActiveAt === undefined || lastActiveAt === "") return true;
  const then = new Date(lastActiveAt).getTime();
  if (!Number.isFinite(then)) return true; // unreadable: record rather than freeze
  if (!Number.isFinite(nowMs)) return false; // no reliable clock: do not write
  if (then > nowMs) return true; // future value: repair it on the next interaction
  return nowMs - then >= throttleMs;
}

/**
 * The value that would be stored for an interaction at `nowMs`, or null when
 * the throttle says no write is needed. Callers use this to skip a round trip
 * and, in tests, to see the decision rather than just its consequence.
 */
export function nextActivityValue(
  lastActiveAt: string | null | undefined,
  nowMs: number,
  throttleMs: number = ACTIVITY_THROTTLE_MS,
): string | null {
  return shouldRecordActivity(lastActiveAt, nowMs, throttleMs) ? new Date(nowMs).toISOString() : null;
}

/**
 * Plain words for what happened, for an administrator or the member themself.
 * 'throttled' is not a failure and must not read like one.
 */
export function describeActivityOutcome(outcome: ActivityOutcome | null | undefined): string {
  switch (outcome) {
    case "recorded":
      return "Your last active time was updated.";
    case "throttled":
      return "Your last active time was updated a moment ago, so nothing further was written.";
    case "failed":
      return "Your activity could not be recorded just now. Your work is unaffected, and the time shown is the last one that was saved.";
    case "idle":
    default:
      return "No activity to record.";
  }
}

/**
 * Two concepts, one line each, so a screen cannot show one and imply the other.
 * `presence` is the live state; `lastActive` is the account record. Neither is
 * derived from the other.
 */
export interface ActivitySummaryInput {
  presenceLabel: string;
  lastActivityDisplay: string;
  /** True when the activity column could not be read at all, rather than being empty. */
  activityUnavailable?: boolean;
}

export function activitySummaryLines(input: ActivitySummaryInput): { presence: string; lastActive: string } {
  return {
    presence: input.presenceLabel || "Unknown",
    lastActive: input.activityUnavailable ? "Last active unavailable" : input.lastActivityDisplay || "Last active unavailable",
  };
}
