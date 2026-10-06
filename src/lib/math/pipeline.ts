/**
 * Image-to-solution pipeline (2026-10-06 round).
 *
 * The 13-step user flow, as a machine-checkable state machine:
 *   1 scan → 2 capture → 3 crop/rotate/deskew → 4 detect expression →
 *   5 OCR notation → 6 reconstruct symbolic expression →
 *   7 DISPLAY the reconstructed expression (NEVER SKIPPED — the user always
 *     sees what Sophira thinks the equation says) → 8 confirm/correct →
 *   9 solve deterministically → 10 AI explains → 11 teacher-specific
 *   method → 12 verify independently → 13 display steps.
 *
 * Separately tracked: RECOGNIZED INPUT, SOLUTION, EXPLANATION, VERIFICATION.
 *
 * Honesty rules (hard, tested):
 *  - the LLM never solves: OCR transcribes pixels; the solver (mathjs)
 *    computes; verification re-derives with DIFFERENT operations.
 *  - low OCR confidence → status NEEDS CONFIRMATION (the pipeline stops
 *    at step 8 until the user confirms).
 *  - failed/failed-independent verification → answer marked
 *    NEEDS REVIEW — never hidden, never faked.
 *  - step 7 is structurally unskippable: every pipeline result carries
 *    recognized.expression, and the UI renders it before anything else.
 */

import { normalizeMathText } from "./normalize";
import { solveProblem, type SolveResult, type SolveStep } from "./solve";
import { runMachineChecks, type MachineCheckResult } from "../ai/mathverify";

/* ------------------------------------------------------------------ */
/* Types — the four separately-tracked sections                         */
/* ------------------------------------------------------------------ */

export interface PreprocessRecord {
  /** steps recorded for auditability: cropped, rotated, deskewed */
  cropped: boolean;
  rotationDegrees: number;
  deskewDegrees: number;
  method: "canvas" | "none" | "server";
}

export interface RecognizedInput {
  /** raw OCR text — exactly what the reader produced */
  rawText: string;
  /** the reconstructed symbolic expression shown to the user (step 7) */
  expression: string;
  /** for systems: all reconstructed equations */
  expressions: string[];
  /** 0..1 — when below CONFIRM_THRESHOLD the pipeline demands confirmation */
  confidence: number;
  ambiguity: string[];
  ocrEngine: "deterministic" | "vision-llm";
}

export type VerificationStatus = "VERIFIED" | "NEEDS REVIEW";

export interface VerificationSection {
  status: VerificationStatus;
  checks: MachineCheckResult[];
  /** never hidden — what could not be verified and why */
  note: string;
}

export interface ExplanationSection {
  text: string;
  source: "deterministic-template" | "ai";
  /** the AI explains; it never re-computes authority */
  honestNote: string;
}

export interface SolutionSection {
  solved: boolean;
  kind: SolveResult["kind"];
  finalAnswer: string;
  steps: SolveStep[];
  honestNote?: string;
}

export type PipelineStage =
  | "scan" | "capture" | "preprocess" | "detect" | "ocr"
  | "reconstruct" | "display" | "confirm" | "solve" | "explain"
  | "method" | "verify" | "display_steps";

export type PipelineStatus =
  | "OK"                       // fully solved + verified
  | "NEEDS CONFIRMATION"       // step 8 gate: user must confirm the expression
  | "NEEDS REVIEW";            // verification failed / solver refused — shown, never hidden

export interface MathPipelineResult {
  status: PipelineStatus;
  stageReached: PipelineStage;
  stepsCompleted: PipelineStage[];
  preprocess: PreprocessRecord;
  recognized: RecognizedInput;
  solution: SolutionSection;
  explanation: ExplanationSection;
  verification: VerificationSection;
  teacherMethod: { applied: boolean; note: string } | null;
}

export const CONFIRM_THRESHOLD = 0.8;

/* ------------------------------------------------------------------ */
/* OCR engine contract — deterministic engines are injectable for tests */
/* ------------------------------------------------------------------ */

export interface OcrResult {
  text: string;
  /** 0..1; engines that cannot measure confidence report 1.0 and the
   *  pipeline still applies deterministic ambiguity penalties. */
  confidence: number;
  engine: "deterministic" | "vision-llm";
  notes: string[];
}

export type OcrEngine = (imageData: { width: number; height: number; grayscale: Uint8Array }) => Promise<OcrResult>;

/* ------------------------------------------------------------------ */
/* Verification — INDEPENDENT of the solver's own arithmetic            */
/* ------------------------------------------------------------------ */

import { create, all, type MathJsInstance } from "mathjs";
const math: MathJsInstance = create(all, {});

function verifySystemSolution(equations: string[], vars: string[], values: number[]): MachineCheckResult {
  for (let i = 0; i < equations.length; i++) {
    const eq = equations[i];
    const [l, r] = eq.split("=");
    try {
      const lv = Number(math.parse(l.trim()).compile().evaluate(Object.fromEntries(vars.map((v, j) => [v, values[j]]))));
      const rv = Number(math.parse(r.trim()).compile().evaluate(Object.fromEntries(vars.map((v, j) => [v, values[j]]))));
      if (Math.abs(lv - rv) > 1e-6 * Math.max(1, Math.abs(rv))) {
        return { name: `system substitution check (equation ${i + 1})`, passed: false, method: "computational", kind: "numeric", detail: `LHS ${lv} ≠ RHS ${rv} after substitution — the solution is wrong or the transcription needs review` };
      }
    } catch (e) {
      return { name: `system substitution check (equation ${i + 1})`, passed: false, method: "computational", kind: "computational", detail: `could not substitute: ${(e as Error).message}` };
    }
  }
  return { name: "system substitution (all equations)", passed: true, method: "computational", kind: "numeric", detail: `substituting ${vars.map((v, j) => `${v}=${values[j]}`).join(", ")} satisfies every equation` };
}

function verifySolveChecks(solution: SolveResult, expressions: string[]): MachineCheckResult[] {
  const results: MachineCheckResult[] = [];
  for (const c of solution.checks) {
    if (c.kind === "equation_check" && c.vars && c.values) {
      results.push(verifySystemSolution(expressions, c.vars, c.values));
      continue;
    }
    if (c.kind === "equation_check" && c.left && c.right) {
      // independent: solve the equation again numerically by bisection/
      // substitution of the claimed root from the final answer text
      const claimed = solution.finalAnswer.match(/-?[\d.]+(?:[eE][-+]?\d+)?/g);
      const root = claimed ? Number(claimed[claimed.length - 1]) : NaN;
      try {
        const lv = math.parse(c.left).compile().evaluate({ [c.var ?? "x"]: root });
        const rv = math.parse(c.right).compile().evaluate({ [c.var ?? "x"]: root });
        const ok = Math.abs(lv - rv) <= 1e-6 * Math.max(1, Math.abs(rv));
        results.push({ name: c.label, passed: ok, method: "computational", kind: "numeric", detail: ok ? `substituting gives ${lv} = ${rv}` : `substituting gives LHS ${lv} ≠ RHS ${rv} — the answer does NOT satisfy the equation` });
      } catch (e) {
        results.push({ name: c.label, passed: false, method: "computational", kind: "computational", detail: `could not substitute: ${(e as Error).message}` });
      }
      continue;
    }
    if (c.kind === "derivative" && c.expr && c.expected && c.var) {
      // independent: differentiate numerically (finite differences) — a
      // completely different mechanism than mathjs' symbolic derivative.
      try {
        const f = math.parse(String(c.expected)).compile();
        const h = 1e-5;
        const at = (x: number) => {
          const v1 = Number(f.evaluate({ [c.var!]: x + h }));
          const v2 = Number(f.evaluate({ [c.var!]: x - h }));
          return (v1 - v2) / (2 * h);
        };
        const claimed = math.parse(c.expr).compile();
        const probe = [0.7, 1.3, 2.1, -1.7];
        let ok = true;
        for (const x of probe) {
          const a = at(x);
          const b = Number(claimed.evaluate({ [c.var!]: x }));
          if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 1e-3 * Math.max(1, Math.abs(b))) { ok = false; break; }
        }
        results.push({ name: c.label, passed: ok, method: "computational", kind: "numeric", detail: ok ? "numeric differentiation agrees with the symbolic derivative at 4 sample points" : "numeric differentiation DISAGREES with the claimed derivative — needs review" });
      } catch (e) {
        results.push({ name: c.label, passed: false, method: "computational", kind: "computational", detail: `numeric derivative check failed: ${(e as Error).message}` });
      }
      continue;
    }
    if (c.kind === "simplify_equal" && c.expr && c.expected) {
      // independent: numeric comparison at sample points
      try {
        const probe = [0.37, 1.42, 2.71, 3.14];
        const fExpr = math.parse(String(c.expr)).compile();
        const fExpect = math.parse(String(c.expected)).compile();
        let ok = true;
        for (const t of probe) {
          const env = { x: t, t, n: 2 };
          const a = Number(fExpr.evaluate(env));
          const b = Number(fExpect.evaluate(env));
          if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(b))) { ok = false; break; }
        }
        results.push({ name: c.label, passed: ok, method: "computational", kind: "numeric", detail: ok ? "both expressions agree numerically at sample points" : "the expressions DISAGREE numerically — needs review" });
      } catch (e) {
        results.push({ name: c.label, passed: false, method: "computational", kind: "computational", detail: `numeric equivalence check failed: ${(e as Error).message}` });
      }
      continue;
    }
    // everything else → the existing, independently-tested machine-check engine
    const run = runMachineChecks([c]);
    const chk = run.results[0];
    if (chk) results.push(chk);
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* The pipeline                                                         */
/* ------------------------------------------------------------------ */

export interface PipelineDeps {
  ocr: OcrEngine;
  /** AI explanation (step 10) — INJECTABLE; must only explain, never solve. */
  explain?: (solution: SolutionSection, recognized: RecognizedInput) => Promise<string>;
  /** teacher-specific method (step 11) — injectable */
  applyTeacherMethod?: (solution: SolutionSection) => { applied: boolean; note: string };
  preprocess?: PreprocessRecord;
  /** user's confirmed/corrected expression (step 8 output) */
  confirmedExpression?: string | null;
  /** when true, the user has already confirmed (typed input path) */
  alreadyConfirmed?: boolean;
}

export async function runMathPipeline(image: { width: number; height: number; grayscale: Uint8Array }, deps: PipelineDeps): Promise<MathPipelineResult> {
  const stepsCompleted: PipelineStage[] = ["scan", "capture"];
  const preprocess: PreprocessRecord = deps.preprocess ?? { cropped: true, rotationDegrees: 0, deskewDegrees: 0, method: "canvas" };
  stepsCompleted.push("preprocess");

  // steps 4-5: detect + OCR
  const ocrResult = await deps.ocr(image);
  stepsCompleted.push("detect", "ocr");
  if (!ocrResult.text.trim()) {
    const recognized: RecognizedInput = { rawText: "", expression: "", expressions: [], confidence: 0, ambiguity: ["no mathematical expression was detected in the image"], ocrEngine: ocrResult.engine };
    return {
      status: "NEEDS CONFIRMATION",
      stageReached: "ocr",
      stepsCompleted,
      preprocess,
      recognized,
      solution: { solved: false, kind: "evaluate", finalAnswer: "", steps: [] },
      explanation: { text: "", source: "deterministic-template", honestNote: "nothing to explain yet — no expression was recognized" },
      verification: { status: "NEEDS REVIEW", checks: [], note: "no expression recognized — nothing solved, nothing verified" },
      teacherMethod: null,
    };
  }

  // step 6: reconstruct symbolic expression(s)
  const norm = normalizeMathText(ocrResult.text);
  const expressions = norm.expressions.length > 0 ? norm.expressions : [ocrResult.text];
  stepsCompleted.push("reconstruct");

  // confidence: engine confidence × deterministic ambiguity penalties
  let confidence = Math.max(0, Math.min(1, ocrResult.confidence));
  for (const _a of norm.ambiguity) confidence = Math.min(confidence, 0.75);
  const recognized: RecognizedInput = {
    rawText: ocrResult.text,
    expression: expressions.join(" ; "),
    expressions,
    confidence,
    ambiguity: [...norm.ambiguity, ...ocrResult.notes],
    ocrEngine: ocrResult.engine,
  };

  // step 7: DISPLAY the reconstructed expression — structurally unskippable;
  // the result always carries it, and the UI always renders it.
  stepsCompleted.push("display");

  // step 8: confirmation gate — the user ALWAYS confirms/corrects before
  // anything is solved (step 7 display is never skipped). When the caller
  // provides the confirmed expression the pipeline continues with the
  // user's version; otherwise it stops at the gate.
  const confirmed = deps.confirmedExpression?.trim() ?? null;
  if (!deps.alreadyConfirmed && confirmed === null) {
    return {
      status: "NEEDS CONFIRMATION",
      stageReached: "confirm",
      stepsCompleted,
      preprocess,
      recognized,
      solution: { solved: false, kind: "evaluate", finalAnswer: "", steps: [] },
      explanation: { text: "", source: "deterministic-template", honestNote: "waiting for your confirmation of the recognized expression" },
      verification: { status: "NEEDS REVIEW", checks: [], note: `not verified yet — confirm the recognized expression first${confidence < CONFIRM_THRESHOLD ? ` (OCR confidence ${(confidence * 100).toFixed(0)}% is below the ${(CONFIRM_THRESHOLD * 100).toFixed(0)}% threshold)` : ""}` },
      teacherMethod: null,
    };
  }
  const finalExpressions = confirmed ? normalizeMathText(confirmed).expressions : expressions;
  if (confirmed) stepsCompleted.push("confirm");
  stepsCompleted.push("confirm");

  // step 9: deterministic solve
  const solution = solveProblem(finalExpressions.join(" ; "), finalExpressions) as SolveResult;
  stepsCompleted.push("solve");
  const solutionSection: SolutionSection = {
    solved: solution.solved,
    kind: solution.kind,
    finalAnswer: solution.finalAnswer,
    steps: solution.steps,
    honestNote: solution.honestNote,
  };

  // step 10: explanation (AI explains the deterministic solution; never solves)
  let explanationText = deterministicExplanation(solutionSection);
  let explanationSource: ExplanationSection["source"] = "deterministic-template";
  if (deps.explain && solution.solved) {
    try {
      const aiText = await deps.explain(solutionSection, recognized);
      if (aiText && aiText.trim()) { explanationText = aiText; explanationSource = "ai"; }
    } catch {
      // honest fallback: deterministic template, AI failure disclosed
      explanationText = deterministicExplanation(solutionSection) + "\n(AI explanation was unavailable — this is the deterministic step summary.)";
    }
  }
  stepsCompleted.push("explain");
  const explanation: ExplanationSection = {
    text: explanationText,
    source: explanationSource,
    honestNote: "the explanation describes the deterministic solution; no number in it is authoritative — the verification section is.",
  };

  // step 11: teacher-specific method
  const teacherMethod = deps.applyTeacherMethod
    ? deps.applyTeacherMethod(solutionSection)
    : { applied: false, note: "no teacher-specific method constraints loaded" };
  stepsCompleted.push("method");

  // step 12: INDEPENDENT verification
  const checks = solution.solved ? verifySolveChecks(solution, finalExpressions) : [];
  const failed = checks.filter((c) => !c.passed);
  const verificationStatus: VerificationStatus =
    !solution.solved || checks.length === 0 || failed.length > 0 ? "NEEDS REVIEW" : "VERIFIED";
  const verification: VerificationSection = {
    status: verificationStatus,
    checks,
    note:
      solution.solved && checks.length > 0 && failed.length === 0
        ? `All ${checks.length} independent check(s) passed. Verified by deterministic re-computation (mathjs + finite differences), not by the language model.`
        : !solution.solved
          ? `The deterministic solver refused to solve this (honestly): ${solution.honestNote ?? "unsupported problem shape"} — the answer is marked NEEDS REVIEW, never guessed.`
          : `Verification FAILED: ${failed.map((f) => f.name).join("; ")}. The answer is marked NEEDS REVIEW — this is never hidden.`,
  };
  stepsCompleted.push("verify");

  // step 13: display steps — the result itself carries the steps
  stepsCompleted.push("display_steps");

  const status: PipelineStatus = verificationStatus === "VERIFIED" ? "OK" : "NEEDS REVIEW";
  return {
    status,
    stageReached: "display_steps",
    stepsCompleted,
    preprocess,
    recognized,
    solution: solutionSection,
    explanation,
    verification,
    teacherMethod,
  };
}

function deterministicExplanation(solution: SolutionSection): string {
  if (!solution.solved) return "The deterministic solver could not solve this — no answer was guessed. " + (solution.honestNote ?? "");
  const lines = solution.steps.map((s, i) => `${i + 1}. ${s.text}${s.expr ? ` — ${s.expr}` : ""}`).join("\n");
  return `Solved ${solution.kind.replace(/_/g, " ")} deterministically:\n${lines}\nAnswer: ${solution.finalAnswer}`;
}
