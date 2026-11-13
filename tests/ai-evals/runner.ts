/**
 * OFFLINE EVALUATION RUNNER (Prompt 2, Steps 2-3).
 *
 * Runs the deterministic cases from cases.ts against the REAL application
 * functions. `live-only` cases are reported as skipped, never as passed - a
 * fluent model answer is not evidence, and `npm test` must not need a network.
 */
import { EVAL_CASES, type EvalCase } from "./cases";
import { CATEGORY_IDS, EVAL_CATEGORIES, tallyByCategory, type CategoryTally } from "./categories";
import { evaluateSourceRequest, evaluateInformationRequest } from "../../src/lib/research/policy";
import { detectInjectionAttempt } from "../../src/lib/ai/context";

export interface EvalOutcome {
  id: string;
  status: "pass" | "fail" | "skipped";
  detail: string;
}

export function runOfflineEvals(): EvalOutcome[] {
  return EVAL_CASES.map((c: EvalCase): EvalOutcome => {
    try {
      if (c.kind === "live-only") {
        return { id: c.id, status: "skipped", detail: "needs a configured model; not run offline" };
      }
      if (c.kind === "injection") {
        const got = detectInjectionAttempt(c.input);
        return { id: c.id, status: got === c.expect ? "pass" : "fail", detail: `detectInjectionAttempt=${got}` };
      }
      if (c.kind === "request-allowed" || c.kind === "request-refused") {
        const r = evaluateInformationRequest(c.input);
        const wantRefused = c.kind === "request-refused";
        if (r.blocked !== wantRefused) return { id: c.id, status: "fail", detail: `blocked=${r.blocked} expected=${wantRefused}` };
        if (wantRefused && c.expect && r.code !== c.expect) return { id: c.id, status: "fail", detail: `code=${r.code} expected=${c.expect}` };
        return { id: c.id, status: "pass", detail: `blocked=${r.blocked}${r.code ? ` code=${r.code}` : ""}` };
      }
      const g = evaluateSourceRequest(c.input);
      const wantAllowed = c.kind === "source-allowed";
      if (g.allowed !== wantAllowed) return { id: c.id, status: "fail", detail: `allowed=${g.allowed} expected=${wantAllowed}` };
      if (!wantAllowed && c.expect && g.code !== c.expect) return { id: c.id, status: "fail", detail: `code=${g.code} expected=${c.expect}` };
      return { id: c.id, status: "pass", detail: `allowed=${g.allowed}` };
    } catch (e) {
      return { id: c.id, status: "fail", detail: `threw: ${e instanceof Error ? e.message : "unknown"}` };
    }
  });
}

/** Corpus integrity: stable ids, severities present, no duplicated cases, 15 categories. */
export function validateCorpus(): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of EVAL_CASES) {
    if (seen.has(c.id)) problems.push(`duplicate id ${c.id}`);
    seen.add(c.id);
    if (!c.severity) problems.push(`${c.id} has no severity`);
    if (!c.why) problems.push(`${c.id} has no rationale`);
    if (!c.input) problems.push(`${c.id} has no input`);
    // 2026-11-13 (Part 7): a case must belong to exactly one of the fifteen areas, and the
    // area must exist. Without this a new case can quietly land in no category at all.
    if (!c.category) problems.push(`${c.id} has no category`);
    else if (!CATEGORY_IDS.includes(c.category)) problems.push(`${c.id} names unknown category ${c.category}`);
  }
  // Every category must carry at least one case, and a category judged without a model must
  // have a case that actually runs offline. A category of "live-only" cases is honest, but a
  // category that says needsModel:false while every case is skipped is a false claim.
  for (const cat of EVAL_CATEGORIES) {
    const mine = EVAL_CASES.filter((c) => c.category === cat.id);
    if (mine.length === 0) problems.push(`category ${cat.id} has no cases`);
    if (!cat.needsModel && !mine.some((c) => c.kind !== "live-only")) {
      problems.push(`category ${cat.id} claims offline coverage but has no deterministic case`);
    }
    if (cat.needsModel && mine.some((c) => c.kind !== "live-only")) {
      problems.push(`category ${cat.id} is marked needsModel but contains a deterministic case`);
    }
  }
  if (EVAL_CATEGORIES.length !== 15) problems.push(`expected 15 categories, found ${EVAL_CATEGORIES.length}`);
  const critical = EVAL_CASES.filter((c) => c.severity === "critical").length;
  if (critical < 8) problems.push("too few critical-severity cases to be meaningful");
  const deterministic = EVAL_CASES.filter((c) => c.kind !== "live-only").length;
  if (deterministic < 8) problems.push("too few deterministic cases to gate on");
  return problems;
}

/** Which of the fifteen areas each case protects. */
export function categoryOf(caseId: string): string | undefined {
  return EVAL_CASES.find((c) => c.id === caseId)?.category;
}

/** Per-area report over the outcomes of one run. */
export function categoryReport(outcomes: { id: string; status: "pass" | "fail" | "skipped" }[]): CategoryTally[] {
  return tallyByCategory(outcomes, categoryOf);
}
