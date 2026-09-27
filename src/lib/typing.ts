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
