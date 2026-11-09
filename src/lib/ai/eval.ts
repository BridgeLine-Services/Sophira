/**
 * Phase 1 — model evaluation harness (pure runner, injected chat function).
 *
 * Why this exists: "which model should we use?" was answered by opinion. This
 * harness answers it with the same fixed prompts sent to each candidate, scored
 * on properties that can be checked mechanically, plus wall-clock latency. It
 * never asks a model to grade itself.
 *
 * Scoring rules are deliberately strict about the things that hurt a student:
 *  - a refusal when the source does not contain the answer is a PASS, and
 *    inventing an answer there is the most serious failure,
 *  - a citation is only accepted when it points at a real item from the source,
 *  - an empty or non-parsing JSON answer is a failure, not "a style issue".
 *
 * Nothing here calls a network by itself: the caller supplies `chat`, so the
 * same cases run in tests (deterministic stubs) and against real providers.
 */

export interface EvalCase {
  id: string;
  /** What the student asked. */
  prompt: string;
  /** Source text the answer must be grounded in. */
  source: string;
  kind: "grounded" | "refusal" | "json" | "citation";
  /** For json cases: keys that must be present. */
  requiredKeys?: string[];
  /** For citation cases: the markers that must appear (and only from the source). */
  allowedCitations?: string[];
}

export interface EvalOutcome {
  caseId: string;
  kind: EvalCase["kind"];
  passed: boolean;
  reason: string;
  latencyMs: number;
  emptyAnswer: boolean;
}

export interface EvalReport {
  label: string;
  total: number;
  passed: number;
  score: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
  outcomes: EvalOutcome[];
  /** Honest verdict in plain words. */
  verdict: string;
}

/** The fixed suite. Kept small and stable so scores are comparable over time. */
export const EVAL_CASES: EvalCase[] = [
  {
    id: "grounded-basic",
    kind: "grounded",
    prompt: "According to the source, how many phases does mitosis have and what are they?",
    source: "Mitosis has four phases: prophase, metaphase, anaphase and telophase.",
  },
  {
    id: "refusal-absent",
    kind: "refusal",
    prompt: "According to the source, what is the punishment for academic dishonesty at this university?",
    source: "Mitosis has four phases: prophase, metaphase, anaphase and telophase.",
  },
  {
    id: "json-shape",
    kind: "json",
    prompt: 'Return ONLY JSON: {"topic": string, "phases": number} for the source below.',
    source: "Mitosis has four phases: prophase, metaphase, anaphase and telophase.",
    requiredKeys: ["topic", "phases"],
  },
  {
    id: "citation-real",
    kind: "citation",
    prompt: "Quote the sentence about checkpoints and cite it as [source].",
    source: "Checkpoints prevent damaged cells from dividing. Mitosis has four phases.",
    allowedCitations: ["[source]"],
  },
];

const REFUSAL_MARKERS = [
  "not in the source",
  "not covered",
  "does not say",
  "doesn't say",
  "no information",
  "not mentioned",
  "cannot be determined",
  "the source does not",
];

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return Math.round(sorted[idx]);
}

/** Scores one answer. Pure and independent of any provider. */
export function scoreAnswer(testCase: EvalCase, answer: string): { passed: boolean; reason: string; empty: boolean } {
  const text = (answer ?? "").trim();
  if (!text) return { passed: false, reason: "empty answer", empty: true };
  const lower = text.toLowerCase();

  if (testCase.kind === "refusal") {
    const refused = REFUSAL_MARKERS.some((m) => lower.includes(m));
    return refused
      ? { passed: true, reason: "refused to invent an answer that is not in the source", empty: false }
      : { passed: false, reason: "answered a question the source cannot support (fabrication risk)", empty: false };
  }

  if (testCase.kind === "grounded") {
    // The source says four phases. A correct grounded answer mentions them.
    const mentionsPhases = ["prophase", "metaphase", "anaphase", "telophase"].filter((p) => lower.includes(p)).length;
    if (mentionsPhases >= 3) return { passed: true, reason: `named ${mentionsPhases}/4 phases from the source`, empty: false };
    return { passed: false, reason: `named only ${mentionsPhases}/4 phases from the source`, empty: false };
  }

  if (testCase.kind === "json") {
    const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      const missing = (testCase.requiredKeys ?? []).filter((k) => !(k in parsed));
      if (missing.length > 0) return { passed: false, reason: `JSON missing keys: ${missing.join(", ")}`, empty: false };
      return { passed: true, reason: "valid JSON with the required keys", empty: false };
    } catch {
      return { passed: false, reason: "answer was not parseable JSON", empty: false };
    }
  }

  // citation
  const allowed = testCase.allowedCitations ?? [];
  const cited = allowed.filter((c) => text.includes(c));
  if (cited.length === 0) return { passed: false, reason: "no citation from the source", empty: false };
  const invented = (text.match(/\[[^\]]{1,40}\]/g) ?? []).filter((c) => !allowed.includes(c));
  if (invented.length > 0) return { passed: false, reason: `invented citation(s): ${invented.join(", ")}`, empty: false };
  return { passed: true, reason: "cited the source without inventing a reference", empty: false };
}

export async function runEvalSuite(
  label: string,
  chat: (prompt: string) => Promise<string>,
  cases: EvalCase[] = EVAL_CASES
): Promise<EvalReport> {
  const outcomes: EvalOutcome[] = [];
  for (const testCase of cases) {
    const started = Date.now();
    let answer = "";
    let failure: string | null = null;
    try {
      answer = await chat(`${testCase.prompt}\n\nSOURCE:\n${testCase.source}`);
    } catch (e) {
      failure = `threw: ${e instanceof Error ? e.message : String(e)}`;
    }
    const latencyMs = Date.now() - started;
    if (failure) {
      outcomes.push({ caseId: testCase.id, kind: testCase.kind, passed: false, reason: failure, latencyMs, emptyAnswer: true });
      continue;
    }
    const scored = scoreAnswer(testCase, answer);
    outcomes.push({
      caseId: testCase.id,
      kind: testCase.kind,
      passed: scored.passed,
      reason: scored.reason,
      latencyMs,
      emptyAnswer: scored.empty,
    });
  }
  const passed = outcomes.filter((o) => o.passed).length;
  const latencies = outcomes.map((o) => o.latencyMs);
  const mean = latencies.length === 0 ? 0 : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length);
  const score = outcomes.length === 0 ? 0 : Math.round((passed / outcomes.length) * 1000) / 1000;
  return {
    label,
    total: outcomes.length,
    passed,
    score,
    meanLatencyMs: mean,
    p95LatencyMs: p95(latencies),
    outcomes,
    verdict: verdictFor({ score, meanLatencyMs: mean, total: outcomes.length }),
  };
}

export function verdictFor(input: { score: number; meanLatencyMs: number; total: number }): string {
  if (input.total === 0) return "No cases were run, so nothing can be said about this model.";
  if (input.score >= 1) {
    return input.meanLatencyMs <= 4000
      ? "Passed every check quickly enough to use as the default."
      : "Passed every check, but slowly: fine for background work, slow for interactive use.";
  }
  if (input.score >= 0.75) return "Mostly reliable. Review the failures before making it the default.";
  if (input.score >= 0.5) return "Unreliable for study work: it invents or omits too often. Keep it as a fallback only.";
  return "Not suitable: it fails more than half of the checks.";
}

export interface ComparisonRow {
  label: string;
  score: number;
  passed: number;
  total: number;
  meanLatencyMs: number;
  recommendation: string;
}

/**
 * Compares candidates the way a decision needs to be made: correctness first,
 * latency second, and never by averaging away a fabrication.
 */
export function compareReports(reports: EvalReport[]): { rows: ComparisonRow[]; recommendation: string } {
  if (reports.length === 0) return { rows: [], recommendation: "Nothing to compare yet: no candidate was evaluated." };
  const rows: ComparisonRow[] = reports.map((r) => ({
    label: r.label,
    score: r.score,
    passed: r.passed,
    total: r.total,
    meanLatencyMs: r.meanLatencyMs,
    recommendation:
      r.score >= 1
        ? "Keep as the preferred model."
        : r.score >= 0.75
          ? "Use with review."
          : "Do not use for student-facing answers.",
  }));
  const best = [...rows].sort((a, b) => b.score - a.score || a.meanLatencyMs - b.meanLatencyMs)[0];
  const refusalsMissed = reports.some((r) =>
    r.outcomes.some((o) => o.kind === "refusal" && !o.passed)
  );
  const recommendation = refusalsMissed
    ? `${best.label} scores highest (${Math.round(best.score * 100)}%), but at least one candidate answered a question its source could not support. That is the failure to fix first, regardless of score.`
    : `${best.label} is the best choice on these checks: ${Math.round(best.score * 100)}% correct at ${best.meanLatencyMs} ms average.`;
  return { rows, recommendation };
}
