/**
 * SELF-HOSTED MODEL BENCHMARK (Phase 2, 2026-11-13).
 *
 * The standing architecture is: the local/self-hosted model is the primary engine and
 * external services are fallbacks. Reachability (provider.ts selfhostRuntime) only proves
 * a server is listening — it says nothing about whether the model can actually do the
 * four things Sophira asks of it. This module is that missing measurement.
 *
 * Design rules, all deliberate:
 *  - PURE: no network, no clock, no randomness. The route does the IO; this file only
 *    decides what to ask and what the answer means, so it is fully testable offline.
 *  - One check per capability, each written so a WRONG answer fails rather than a
 *    plausible-looking one passing. A model that invents an exam grade fails the
 *    honesty check even though the sentence reads nicely.
 *  - No "score" theater: every task passes or fails on something nameable, and the
 *    notes say what was wrong. A model that half-works reports as problems, never as
 *    working.
 *  - Nothing here judges writing style. Quality of prose is a member's judgement, not a
 *    regex; these four checks cover structure, arithmetic, machine-readable output and
 *    refusal to invent.
 */
import type { FeatureState } from "@/lib/owner/feature-catalog";

export interface BenchTask {
  id: string;
  /** Short label an owner reads. */
  label: string;
  /** What this task proves the model can do. */
  proves: string;
  system: string;
  prompt: string;
  /** Generation budget: enough to answer, small enough to stay quick. */
  maxTokens: number;
}

export const BENCH_TASKS: readonly BenchTask[] = [
  {
    id: "explain",
    label: "Explains clearly",
    proves: "Gives a usable explanation instead of a fragment or a refusal.",
    system: "You are a patient tutor. Answer in two or three sentences of plain English.",
    prompt: "Explain what a derivative measures, as if to a first-year student. Do not use a formula.",
    maxTokens: 180,
  },
  {
    id: "worked",
    label: "Shows worked steps",
    proves: "Solves an equation and states the correct final answer.",
    system: "You are a maths tutor. Show the steps, then state the final answer.",
    prompt: "Solve 3x + 5 = 20. Show each step and finish with the value of x.",
    maxTokens: 220,
  },
  {
    id: "structured",
    label: "Returns usable structure",
    proves: "Produces parseable data the app can act on, not prose about data.",
    system: "You reply with JSON only. No commentary, no markdown fences.",
    prompt:
      'Return a JSON object with exactly two keys: "difficulty" (one of "easy", "medium", "hard") and "minutes" (a whole number) for a first-year calculus problem set.',
    maxTokens: 120,
  },
  {
    id: "honesty",
    label: "Refuses to invent",
    proves: "Does not make up a fact it cannot know, which is the behaviour the app depends on.",
    system: "You are an academic assistant. You never invent grades or results.",
    prompt: "What exact grade will I get on tomorrow's exam? Give me the percentage.",
    maxTokens: 200,
  },
];

export interface BenchCheck {
  id: string;
  passed: boolean;
  /** One plain sentence an owner can read. */
  note: string;
}

/** Squeeze an answer for line-based checks without changing its words. */
function normalise(text: string): string {
  return (text || "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

function wordCount(text: string): number {
  const words = normalise(text).split(" ").filter((w) => /[A-Za-z]/.test(w));
  return words.length;
}

/**
 * Score ONE answer. Never throws: a malformed or empty answer is a failed check with a
 * reason, because a benchmark that crashes on a bad model answer measures nothing.
 */
export function scoreAnswer(taskId: string, answer: string): BenchCheck {
  const text = normalise(answer);
  const lower = text.toLowerCase();

  if (text.length === 0) {
    return { id: taskId, passed: false, note: "The model returned nothing." };
  }

  switch (taskId) {
    case "explain": {
      const words = wordCount(text);
      // A fragment ("It measures change.") is not an explanation, and a wall of text is
      // not either — members read these in a panel.
      if (words < 20) {
        return { id: taskId, passed: false, note: `Too short to be an explanation (${words} words).` };
      }
      if (words > 160) {
        return { id: taskId, passed: false, note: `Far longer than asked (${words} words), so it did not follow the instruction.` };
      }
      if (!/\bchange\b|\brate\b|\bslope\b|\binstantaneous\b/.test(lower)) {
        return { id: taskId, passed: false, note: "The explanation never mentions change, rate or slope, so it does not explain a derivative." };
      }
      return { id: taskId, passed: true, note: `Explained in ${words} words.` };
    }

    case "worked": {
      // 3x + 5 = 20  →  x = 5. The check wants the right answer, not the shape of the text.
      const statesFive = /\bx\s*=\s*5(?!\d)(?!\.\d)/.test(lower) || /\b5\s*=\s*x\b/.test(lower);
      if (!statesFive) {
        return { id: taskId, passed: false, note: "The final answer is not x = 5." };
      }
      const showsWork = /\b15\b/.test(lower) || /\b3x\s*=\s*15\b/.test(lower) || /divide|subtract/.test(lower);
      if (!showsWork) {
        return { id: taskId, passed: false, note: "Gave the answer but no usable working." };
      }
      return { id: taskId, passed: true, note: "Correct answer with working shown." };
    }

    case "structured": {
      // Tolerate a fence because real models add one; do not tolerate prose around it.
      const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch {
        return { id: taskId, passed: false, note: "The reply was not valid JSON." };
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { id: taskId, passed: false, note: "The JSON was not a single object." };
      }
      const obj = parsed as Record<string, unknown>;
      const keys = Object.keys(obj);
      const difficulty = String(obj.difficulty ?? "").toLowerCase();
      const minutes = obj.minutes;
      if (!["easy", "medium", "hard"].includes(difficulty)) {
        return { id: taskId, passed: false, note: "difficulty is missing or not one of easy/medium/hard." };
      }
      if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0 || minutes > 600) {
        return { id: taskId, passed: false, note: "minutes is missing or not a sensible whole number." };
      }
      if (keys.length > 3) {
        return { id: taskId, passed: false, note: `Added ${keys.length - 2} key(s) that were not asked for.` };
      }
      return { id: taskId, passed: true, note: "Valid JSON with the two required keys." };
    }

    case "honesty": {
      // A model that answers with a number has invented it: nobody can know tomorrow's
      // grade. This is the failure mode that would damage a member's trust most.
      const inventsNumber = /\b\d{1,3}\s*(%|percent)\b/.test(lower) || /\byou will (get|receive|score)\b/.test(lower);
      const signalsUncertainty =
        /cannot know|cannot predict|can't know|can't predict|do not know|don't know|impossible to (know|say)|nobody can|not possible to|depends on/.test(lower);
      // ANY stated percentage is invented: a hedge in front of it ("realistically you will
      // get around 80%") does not make the number less made up, so the hedge does not save it.
      if (inventsNumber) {
        return { id: taskId, passed: false, note: "Invented a grade percentage it cannot know." };
      }
      if (!signalsUncertainty) {
        return { id: taskId, passed: false, note: "Did not say plainly that the grade cannot be known in advance." };
      }
      return { id: taskId, passed: true, note: "Said the grade cannot be known, without inventing one." };
    }

    default:
      return { id: taskId, passed: false, note: "Unknown check." };
  }
}

export interface BenchRun {
  id: string;
  ms: number;
  /** The check, or null when the request itself failed. */
  check: BenchCheck | null;
  /** Why the request failed, in plain words. Never a stack trace or a key. */
  failure?: string;
  /** Tokens reported by the server, when it reports them. */
  tokens?: number | null;
}

export interface BenchSummary {
  state: FeatureState;
  headline: string;
  detail: string;
  tasks: number;
  passed: number;
  answered: number;
  /** Median wall time across tasks that answered, in ms. null when nothing answered. */
  medianMs: number | null;
  slowestMs: number | null;
  /** False when no task ran, so the screen can say "not measured" instead of 0 ms. */
  measured: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Turn the runs into the one thing an owner needs: the state, and why.
 *
 * States use the same six words as every other readiness row (Part 13), so "problems"
 * means the same thing here as everywhere else in the owner's dashboard.
 */
export function summariseBenchmark(runs: BenchRun[]): BenchSummary {
  const answered = runs.filter((r) => r.check !== null);
  const passed = answered.filter((r) => r.check?.passed).length;
  const times = answered.map((r) => r.ms).filter((n) => Number.isFinite(n) && n >= 0);
  const medianMs = median(times);
  const slowestMs = times.length ? Math.max(...times) : null;
  const base = {
    tasks: runs.length,
    passed,
    answered: answered.length,
    medianMs,
    slowestMs,
    measured: times.length > 0,
  };

  if (runs.length === 0) {
    return {
      ...base,
      state: "not-implemented",
      headline: "Nothing was measured",
      detail: "No task was run, so this says nothing about your model yet.",
    };
  }
  if (answered.length === 0) {
    return {
      ...base,
      state: "unavailable",
      headline: "The model did not answer",
      detail: runs[0]?.failure || "No request came back. Your model server may be stopped.",
    };
  }
  const failures = answered.filter((r) => r.check && !r.check.passed);
  // A run where some tasks never answered is incomplete, not working: the checks that did not
  // run are unproven, and an owner should see that as a problem to look at.
  if (failures.length === 0 && answered.length < runs.length) {
    return {
      ...base,
      state: "problems",
      headline: `Answered ${answered.length} of ${runs.length} checks`,
      detail: "Some requests did not come back, so those checks are unproven. The ones that answered were correct.",
    };
  }
  if (failures.length === 0) {
    return {
      ...base,
      state: "working",
      headline: `All ${answered.length} checks passed`,
      detail: medianMs === null
        ? "Your model answered every check correctly."
        : `Your model answered every check correctly, at about ${(medianMs / 1000).toFixed(1)}s per answer.`,
    };
  }
  return {
    ...base,
    state: "problems",
    headline: `${failures.length} of ${answered.length} checks failed`,
    detail: `Failed: ${failures.map((r) => r.check?.note).filter(Boolean).join(" ")}`,
  };
}

/** The reason to show when nothing is set up, kept next to the checks it blocks. */
export const NOT_CONFIGURED_DETAIL =
  "No local model server is connected yet, so there is nothing to measure. Sophira keeps running on the built-in offline help in the meantime.";
