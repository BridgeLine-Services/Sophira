/**
 * OPTIONAL ADAPTIVE TYPING PROFILE (2026-10-05).
 *
 * Built ON TOP of the existing typing calibration (src/lib/typing.ts —
 * computeTypingResult, adoptBaseline, suspicious-attempt flags; the typing
 * test, canonical passages, server-side timing and baseline selection are
 * ALL unchanged). Nothing is replaced.
 *
 * Contract:
 *   - Only VALID, UNFLAGGED attempts become observations. Suspicious or
 *     invalid timing data (implausibly fast, too short, incomplete…) can
 *     never corrupt the profile — they stay in the history but are
 *     filtered out before any estimate is computed.
 *   - The recommended pace is a conservative, deterministic blend of the
 *     user-selected baseline and the rolling recent average:
 *       recommended = floor(mean(baseline, recent)), clamped to
 *       [0.75 × baseline, 1.25 × baseline]  (example: 62 & 67 → 64).
 *   - Pacing NEVER changes automatically unless auto_adjust_enabled is
 *     true. effectiveTypingPace() resolves: manual preference first,
 *     then adaptive (if enabled), then the fixed baseline.
 *
 * Pure functions only — offline-testable with injected clocks (spec §34).
 */

export type TypingProfileConfidence = "LOW" | "MEDIUM" | "HIGH";

export interface ObservedTypingAttempt {
  wpm: number;
  testDateMs: number;
  valid: boolean;
  flags: string[];
}

export interface TypingProfile {
  baseline_wpm: number;
  recent_average_wpm: number;
  recommended_wpm: number;
  confidence: TypingProfileConfidence;
  sample_count: number;
  last_calibration_at: string | null;
  auto_adjust_enabled: boolean;
  manual_wpm: number | null;
}

/** Rolling window: how many recent valid attempts feed the average. */
export const RECENT_WINDOW = 5;
/** Samples and spread required for HIGH confidence. */
export const HIGH_CONFIDENCE_MIN_SAMPLES = 4;
export const HIGH_CONFIDENCE_MAX_SPREAD_WPM = 12;
/** Recommended pace is clamped to keep pacing close to the baseline. */
export const PACE_MIN_FACTOR = 0.75;
export const PACE_MAX_FACTOR = 1.25;
/** Hard ceiling for any observation (computeTypingResult flags faster). */
export const PLAUSIBLE_MAX_WPM = 220;

/** Filter to trustworthy observations: valid, unflagged, plausible. */
export function trustworthyObservations(attempts: ObservedTypingAttempt[]): ObservedTypingAttempt[] {
  return attempts.filter(
    (a) =>
      a.valid &&
      a.flags.length === 0 &&
      Number.isFinite(a.wpm) &&
      a.wpm > 0 &&
      a.wpm <= PLAUSIBLE_MAX_WPM &&
      Number.isFinite(a.testDateMs)
  );
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

export function confidenceFor(samples: number, observations: number[]): TypingProfileConfidence {
  if (samples < 2) return "LOW";
  if (samples >= HIGH_CONFIDENCE_MIN_SAMPLES && stdDev(observations) <= HIGH_CONFIDENCE_MAX_SPREAD_WPM) {
    return "HIGH";
  }
  return "MEDIUM";
}

/**
 * Recomputes the whole profile deterministically from the user's own
 * recorded attempts. `baselineWpm` is ALWAYS the user's selected baseline
 * attempt (never silently replaced by the average).
 */
export function recomputeTypingProfile(input: {
  baselineWpm: number;
  attempts: ObservedTypingAttempt[];
  calibrationAtMs: number;
  autoAdjustEnabled: boolean;
  manualWpm?: number | null;
}): TypingProfile {
  const baseline = input.baselineWpm;
  const all = trustworthyObservations(input.attempts);
  // Rolling estimate over the most recent valid attempts.
  const recent = all
    .slice()
    .sort((a, b) => a.testDateMs - b.testDateMs)
    .slice(-RECENT_WINDOW);
  const recentAvg = recent.length
    ? recent.reduce((s, a) => s + a.wpm, 0) / recent.length
    : baseline;
  // Conservative recommended pace: floor of the midpoint between the
  // fixed baseline and the rolling average, clamped near the baseline.
  const mid = (baseline + recentAvg) / 2;
  const recommended = Math.max(
    Math.round(baseline * PACE_MIN_FACTOR),
    Math.min(Math.round(baseline * PACE_MAX_FACTOR), Math.floor(mid))
  );
  return {
    baseline_wpm: baseline,
    recent_average_wpm: Math.round(recentAvg * 10) / 10,
    recommended_wpm: Math.max(1, recommended),
    confidence: confidenceFor(recent.length, recent.map((a) => a.wpm)),
    sample_count: recent.length,
    last_calibration_at: new Date(input.calibrationAtMs).toISOString(),
    auto_adjust_enabled: input.autoAdjustEnabled,
    manual_wpm: input.manualWpm ?? null,
  };
}

/**
 * The pace paced output actually uses. Priority:
 *   1. the user's manually selected preferred pace,
 *   2. the adaptive recommended pace — ONLY when auto_adjust_enabled,
 *   3. the fixed baseline (the pre-existing behavior, unchanged).
 */
export function effectiveTypingPace(profile: {
  baseline_wpm: number;
  recommended_wpm: number;
  auto_adjust_enabled: boolean;
  manual_wpm: number | null;
}): { wpm: number; basis: "manual" | "adaptive" | "baseline" } {
  if (profile.manual_wpm !== null && Number.isFinite(profile.manual_wpm) && profile.manual_wpm > 0) {
    return { wpm: profile.manual_wpm, basis: "manual" };
  }
  if (profile.auto_adjust_enabled) {
    return { wpm: profile.recommended_wpm, basis: "adaptive" };
  }
  return { wpm: profile.baseline_wpm, basis: "baseline" };
}
