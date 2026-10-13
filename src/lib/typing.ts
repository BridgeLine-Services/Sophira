// Typing-speed calibration (spec §3). Pure, deterministic computation; the
// selected baseline is always the user's choice and never forced permanent.
export interface TypingAttempt {
  startedAtMs: number;
  endedAtMs: number;
  typed: string;
  reference: string;
}
export interface TypingTestResult {
  testDateMs: number;
  durationMs: number;
  charactersTyped: number;
  wpm: number;
  accuracy: number;
  netWpm: number;
  validAttempt: boolean;
  flags: string[];
}
export interface TypingBaseline {
  testDateMs: number;
  wpm: number;
  accuracy: number;
  durationMs: number;
  selectedBaselineWpm: number;
  notes?: string;
}
export function computeTypingResult(attempt: TypingAttempt): TypingTestResult {
  const durationMs = Math.max(0, attempt.endedAtMs - attempt.startedAtMs);
  const charactersTyped = attempt.typed.length;
  const minutes = durationMs / 60000;
  const wpm = minutes > 0 ? (charactersTyped / 5) / minutes : 0;
  const overlap = Math.min(attempt.typed.length, attempt.reference.length);
  let correct = 0;
  for (let i = 0; i < overlap; i++) if (attempt.typed[i] === attempt.reference[i]) correct++;
  const accuracy = attempt.reference.length > 0 ? correct / attempt.reference.length : 0;
  const netWpm = wpm * accuracy;
  const flags: string[] = [];
  if (durationMs < 5000) flags.push("too_short");
  if (charactersTyped >= 25 && wpm > 220) flags.push("implausibly_fast");
  if (wpm > 0 && wpm < 5) flags.push("very_slow");
  if (attempt.reference.length > 0 && charactersTyped < attempt.reference.length * 0.5) flags.push("incomplete");
  return {
    testDateMs: attempt.endedAtMs, durationMs, charactersTyped, wpm, accuracy, netWpm,
    validAttempt: !flags.some((f) => f !== "very_slow"), flags,
  };
}
export function adoptBaseline(results: TypingTestResult[], chosen: TypingTestResult, notes?: string): TypingBaseline {
  // The baseline must come from the user's own recorded attempts, and a later
  // retake simply replaces it — never forced to a single permanent result.
  if (!results.some((r) => r === chosen)) throw new Error("baseline must be one of the recorded attempts");
  return {
    testDateMs: chosen.testDateMs, wpm: chosen.wpm, accuracy: chosen.accuracy,
    durationMs: chosen.durationMs, selectedBaselineWpm: chosen.wpm, notes,
  };
}

// ===========================================================================
// HONEST TYPING MEASUREMENT (2026-10-13 bug-fix round).
//
// The original model compared only the FINAL text with the reference, so a
// user who mistyped, backspaced, and corrected everything was reported as
// 100% accurate with no record of the corrections. The tracker below records
// what ACTUALLY happened at entry time; final-text accuracy and raw typing
// accuracy are now separate, documented metrics.
//
// Privacy: the tracker never stores what was typed — only counts of
// characters entered, entry-time mistakes, corrections, backspaces, and a
// paste heuristic. Only the summary leaves the browser.
// ===========================================================================

export interface TypingEventSummary {
  /** Characters entered into the field during the attempt (insertions). */
  entered: number;
  /** Characters that were WRONG at the moment they were entered. */
  rawErrors: number;
  /** Wrong characters the user then deleted (a correction). */
  corrections: number;
  /** Total deletion events (backspaces / deletions), right or wrong. */
  backspaces: number;
  /** A bulk insertion (paste or fast fill) was detected. */
  paste: boolean;
}

/** Raw accuracy: how accurately characters were FIRST entered (0..1). */
export function rawTypingAccuracy(summary: TypingEventSummary): number {
  if (summary.entered <= 0) return 0;
  return Math.max(0, Math.min(1, 1 - summary.rawErrors / summary.entered));
}

/** Correction rate: share of entered characters that needed a fix (0..1). */
export function correctionRate(summary: TypingEventSummary): number {
  if (summary.entered <= 0) return 0;
  return Math.max(0, Math.min(1, summary.corrections / summary.entered));
}

/**
 * Event tracker the calibration UI feeds every text change into. It diffs
 * consecutive values (common-prefix) so mid-text edits and multi-character
 * deletions are handled, not just trailing backspaces.
 */
export function createTypingTracker(reference: string) {
  const state: TypingEventSummary = { entered: 0, rawErrors: 0, corrections: 0, backspaces: 0, paste: false };
  const entryCorrect: boolean[] = [];
  let prev = "";
  return {
    apply(next: string) {
      if (next === prev) return;
      const common = (() => {
        let i = 0;
        while (i < prev.length && i < next.length && prev[i] === next[i]) i++;
        return i;
      })();
      const removed = prev.length - common;
      if (removed > 0) {
        state.backspaces += removed;
        for (let i = common; i < prev.length; i++) if (entryCorrect[i] === false) state.corrections += 1;
      }
      entryCorrect.length = common;
      const added = next.length - common;
      if (added > 8) state.paste = true; // bulk insert heuristic
      for (let i = 0; i < added; i++) {
        const ok = reference[common + i] === next[common + i];
        entryCorrect.push(ok);
        if (!ok) state.rawErrors += 1;
      }
      state.entered += added;
      prev = next;
    },
    summary(): TypingEventSummary {
      return { ...state };
    },
  };
}

/**
 * Server-side validation of a submitted summary. The server re-derives the
 * FINAL-text metrics itself; the event summary is observational, so it is
 * checked for internal consistency and clamped — never trusted blindly.
 * Returns null when the summary cannot possibly match the typed text.
 */
export function validateEventSummary(
  summary: unknown,
  typedLength: number,
): TypingEventSummary | null {
  if (typeof summary !== "object" || summary === null) return null;
  const s = summary as Partial<TypingEventSummary>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const entered = num(s.entered);
  const rawErrors = num(s.rawErrors);
  const corrections = num(s.corrections);
  const backspaces = num(s.backspaces);
  if (entered === null || rawErrors === null || corrections === null || backspaces === null) return null;
  if (rawErrors > entered || corrections > backspaces || corrections > rawErrors + (entered - rawErrors)) return null;
  if (entered < typedLength) return null; // every submitted char must have been entered
  if (entered > typedLength + backspaces) return null; // entries minus deletions must equal the text
  return {
    entered, rawErrors, corrections, backspaces,
    paste: s.paste === true,
  };
}
