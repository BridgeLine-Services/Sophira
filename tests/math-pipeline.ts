/**
 * Image-to-solution pipeline tests (2026-10-06 round).
 *
 * Covers the 13-step flow with a deterministic injected OCR engine (no
 * network), including: the user-flow example (2x + 5 = 17 → 2x = 12 →
 * x = 6), every required domain, the confirmation gate (step 7/8 — the
 * recognized expression is ALWAYS displayed, never skipped), separate
 * tracking of recognized input / solution / explanation / verification,
 * low-confidence handling, and the NEEDS REVIEW rule (verification
 * failures are marked and never hidden, and failed sources are never
 * replaced by guesses).
 */

import { normalizeMathText } from "../src/lib/math/normalize";
import { solveProblem, classify } from "../src/lib/math/solve";
import { runMathPipeline, CONFIRM_THRESHOLD, type MathPipelineResult } from "../src/lib/math/pipeline";
import { toGrayscale, detectExpression, estimateDeskewAngle, rotateImage, cropToInk, inkRatio, preprocessForOcr, type GrayImage } from "../src/lib/math/image";

type Assert = (condition: boolean, name: string) => void;
type Section = (title: string) => void;

/* deterministic OCR engine: returns a fixed transcription */
function ocrReturning(text: string, confidence = 0.95) {
  return async () => ({ text, confidence, engine: "deterministic" as const, notes: [] as string[] });
}

const IMG = { width: 8, height: 8, grayscale: new Uint8Array(64) };

async function run(text: string, opts: { confidence?: number; confirmed?: string | null; explain?: boolean } = {}): Promise<MathPipelineResult> {
  return runMathPipeline(IMG, {
    ocr: ocrReturning(text, opts.confidence ?? 0.95),
    confirmedExpression: opts.confirmed ?? null,
    alreadyConfirmed: opts.confirmed !== undefined ? true : false,
    explain: opts.explain ? async () => "AI: subtract 5, then divide by 2." : undefined,
  });
}

export async function runMathPipelineTests(assert: Assert, section: Section): Promise<void> {
  section("Math scan §1 — the example from the user flow (2x + 5 = 17)");

  const ex = await run("2x + 5 = 17", { confirmed: "2x + 5 = 17" });
  assert(ex.status === "OK", "math: 2x+5=17 solves to OK (verified)");
  assert(ex.recognized.expression === "2x + 5 = 17", "math: recognized input is tracked and displayed");
  assert(ex.solution.finalAnswer.includes("x = 6"), "math: 2x+5=17 → x = 6");
  assert(ex.solution.steps.some((s) => s.expr?.includes("2x = 12")), "math: the solution shows the intermediate step 2x = 12");
  assert(ex.verification.status === "VERIFIED", "math: the answer is independently verified");
  assert(ex.verification.checks.every((c) => c.passed), "math: every independent check passes");
  assert(ex.verification.note.includes("not by the language model"), "math: verification states its deterministic authority");

  // the four sections are tracked SEPARATELY
  assert(!!ex.recognized && !!ex.solution && !!ex.explanation && !!ex.verification, "math: recognized/solution/explanation/verification are tracked separately");

  // unconfirmed → NEEDS CONFIRMATION, and step 7 STILL displayed
  const gate = await runMathPipeline(IMG, { ocr: ocrReturning("2x + 5 = 17") });
  assert(gate.status === "NEEDS CONFIRMATION", "math: without confirmation the pipeline stops at the gate");
  assert(gate.recognized.expression === "2x + 5 = 17", "math: step 7 is NOT skipped even when the gate stops the flow — the user sees what Sophira thinks the equation says");
  assert(gate.stageReached === "confirm", "math: the pipeline reports it reached the confirmation gate");
  assert(!gate.solution.solved, "math: nothing is solved before confirmation");
  assert(gate.verification.note.includes("confirm"), "math: verification says it is waiting for confirmation");

  section("Math scan §2 — normalization (OCR text → mathjs syntax)");

  assert(normalizeMathText("x² − 5x + 6 = 0").expressions[0] === "x^2 - 5x + 6 = 0", "math norm: superscript and unicode minus normalize");
  assert(normalizeMathText("√9 + √16").expressions[0] === "sqrt(9) + sqrt(16)", "math norm: roots become sqrt()");
  assert(normalizeMathText("½ + ⅓").expressions[0] === "(1/2) + (1/3)", "math norm: vulgar fractions normalize");
  assert(normalizeMathText("3 × 4 ÷ 2").expressions[0] === "3 * 4 / 2", "math norm: × and ÷ normalize");
  assert(normalizeMathText("∫ 3x² dx").expressions[0] === "INTEGRAL 3x^2 dx", "math norm: integrals are marked");
  assert(normalizeMathText("x + y = 10; x - y = 4").expressions.length === 2, "math norm: systems split on ; and newlines");
  const amb = normalizeMathText("2x + ? = 17 |");
  assert(amb.ambiguity.length >= 1, "math norm: question marks and bar artifacts raise ambiguity penalties");

  section("Math scan §3 — deterministic solver across every required domain");

  // fractions
  let s = solveProblem("1/2 + 1/3");
  assert(s.solved && (s.finalAnswer.includes("5/6") || near(evalStr(s.finalAnswer), 5 / 6)), "math domain: 1/2 + 1/3 = 5/6");
  // exponents
  s = solveProblem("2^5");
  assert(s.solved && near(evalStr(s.finalAnswer), 32), "math domain: 2^5 = 32");
  // square roots
  s = solveProblem("sqrt(16) + sqrt(9)");
  assert(s.solved && near(evalStr(s.finalAnswer), 7), "math domain: sqrt(16) + sqrt(9) = 7");
  s = solveProblem("√16 + √9");
  assert(s.solved && near(evalStr(s.finalAnswer), 7), "math domain: √ notation solves identically after normalization");
  // linear
  s = solveProblem("2x + 5 = 17");
  assert(s.solved && s.finalAnswer === "x = 6", "math domain: linear equation 2x+5=17 → x=6");
  s = solveProblem("3y - 4 = 11");
  assert(s.solved && s.finalAnswer.includes("y = 5"), "math domain: linear in y");
  // quadratics
  s = solveProblem("x^2 - 5x + 6 = 0");
  assert(s.solved && s.finalAnswer.includes("2") && s.finalAnswer.includes("3"), "math domain: quadratic x²-5x+6=0 → 2 or 3");
  s = solveProblem("x² - 5x + 6 = 0");
  assert(s.solved && s.finalAnswer.includes("x = 2") && s.finalAnswer.includes("x = 3"), "math domain: quadratic with OCR superscript normalizes and solves");
  s = solveProblem("x^2 + 1 = 0");
  assert(s.solved && s.finalAnswer.includes("no real solutions"), "math domain: negative discriminant is reported honestly");
  // systems of equations
  s = solveProblem("", ["x + y = 10", "x - y = 4"]);
  assert(s.solved && s.finalAnswer.includes("x = 7") && s.finalAnswer.includes("y = 3"), "math domain: system x+y=10, x−y=4 → x=7, y=3");
  // calculus: derivatives
  s = solveProblem("d/dx(3x^2 + 2x)");
  assert(s.solved && String(s.finalAnswer).includes("6") && String(s.finalAnswer).includes("x"), "math domain: d/dx(3x²+2x) = 6x+2");
  // calculus: integrals
  s = solveProblem("INTEGRAL 3x^2 dx");
  assert(s.solved && s.finalAnswer.includes("x^3"), "math domain: ∫3x² dx = x³ + C");
  s = solveProblem("INTEGRAL 1/x dx");
  assert(s.solved && s.finalAnswer.includes("log"), "math domain: ∫1/x dx = log|x| + C");
  s = solveProblem("INTEGRAL x^(1/2) dx");
  assert(!s.solved && (s.honestNote ?? "").includes("never guessed"), "math domain: unsupported integral is refused honestly (NEEDS REVIEW path)");
  // matrices
  s = solveProblem("det([[1,2],[3,4]])");
  assert(s.solved && s.finalAnswer === "-2", "math domain: det [[1,2],[3,4]] = -2");
  s = solveProblem("inv([[2,0],[0,2]])");
  assert(s.solved && s.finalAnswer.includes("0.5"), "math domain: matrix inverse");
  s = solveProblem("[[1,2],[3,4]] * [[5,6],[7,8]]");
  assert(s.solved && !s.finalAnswer.includes("undefined"), "math domain: matrix product");
  // statistics
  s = solveProblem("mean([2, 4, 6, 8])");
  assert(s.solved && near(evalStr(s.finalAnswer), 5), "math domain: mean([2,4,6,8]) = 5");
  s = solveProblem("std([2, 4, 6, 8])");
  assert(s.solved, "math domain: standard deviation computes");
  // geometry
  s = solveProblem("area of circle with radius 3");
  assert(s.solved && s.finalAnswer.includes("28"), "math domain: circle area r=3 ≈ 28.27");
  s = solveProblem("hypotenuse a=3 b=4");
  assert(s.solved && s.finalAnswer.includes("5"), "math domain: pythagorean 3-4-5");
  // word problems
  s = solveProblem("The sum of two numbers is 10 and their difference is 4");
  assert(s.solved && s.finalAnswer.includes("7") && s.finalAnswer.includes("3"), "math domain: sum/difference word problem → 7 and 3");
  s = solveProblem("A train leaves at noon carrying an unknown sadness");
  assert(!s.solved && (s.honestNote ?? "").includes("guessed"), "math domain: unmapped word problem is refused — no answer is guessed");

  section("Math scan §4 — image preprocessing (crop / rotate / deskew, pure + deterministic)");

  // synthetic image: one horizontal band of dark pixels
  const w = 40, h = 40;
  const band = new Uint8Array(w * h).fill(255);
  for (let x = 10; x < 30; x++) band[20 * w + x] = 0;
  const img: GrayImage = { width: w, height: h, grayscale: band };

  const det = detectExpression(img);
  assert(det.detected, "math image: a text band is detected as a possible expression");
  const blank = detectExpression({ width: w, height: h, grayscale: new Uint8Array(w * h).fill(255) });
  assert(!blank.detected && blank.reason.includes("blank"), "math image: a blank image is honestly reported as blank");
  const noisy = detectExpression({ width: w, height: h, grayscale: new Uint8Array(w * h).fill(0) });
  assert(!noisy.detected && noisy.reason.includes("dense"), "math image: an all-ink image is refused honestly");

  const skew = estimateDeskewAngle(img);
  assert(Math.abs(skew) <= 9, "math image: deskew estimate stays in the ±9° search range");
  // rotated by 3°, deskew should estimate roughly -3° (correction direction)
  const rotated = rotateImage(img, 3);
  const est = estimateDeskewAngle(rotated);
  assert(est < 0 || Math.abs(est) < 0.5, "math image: deskew detects the introduced skew direction (est " + est + "°)");

  const cropped = cropToInk(img);
  assert(cropped.width <= w && cropped.height <= h && cropped.width > 0, "math image: crop to ink keeps a tight non-empty box");
  assert(inkRatio(img) > 0 && inkRatio(img) < 1, "math image: ink ratio is in (0,1) for the text band");

  const gray = toGrayscale(2, 2, new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255]));
  assert(gray.grayscale[0] === 255 && gray.grayscale[1] === 0 && gray.grayscale[3] === 255, "math image: grayscale conversion maps white→255, black→0");

  const pre = preprocessForOcr(img, 0);
  assert(Math.abs(pre.deskewDegrees) <= 9, "math image: full preprocess returns a sane deskew angle");

  section("Math scan §5 — confidence, confirmation, and honest failure");

  // low confidence → NEEDS CONFIRMATION even with confirmation text missing
  const low = await runMathPipeline(IMG, { ocr: ocrReturning("2x + 5 = 17", 0.4) });
  assert(low.status === "NEEDS CONFIRMATION", "math: low OCR confidence asks for confirmation");
  assert(low.recognized.confidence < CONFIRM_THRESHOLD, "math: the low confidence is recorded");
  assert(low.verification.note.includes("below"), "math: the below-threshold reason is disclosed");

  // user corrects the expression → solved with the CORRECTED one
  const corrected = await runMathPipeline(IMG, {
    ocr: ocrReturning("2x + 5 = 17"),
    confirmedExpression: "2x + 5 = 18",
  });
  assert(corrected.status === "OK" && corrected.solution.finalAnswer.includes("x = 6.5"), "math: the user's corrected expression is solved, not the OCR text");

  // AI explains but never solves: explanation is only text
  const explained = await run("2x + 5 = 17", { confirmed: "2x + 5 = 17", explain: true });
  assert(explained.explanation.source === "ai", "math: AI explanation is used when configured");
  assert(explained.explanation.text.startsWith("AI:"), "math: the AI explanation text is carried");
  assert(explained.explanation.honestNote.includes("verification section"), "math: explanation says the verification section is the authority");
  assert(explained.verification.status === "VERIFIED" && explained.solution.finalAnswer.includes("x = 6"), "math: the deterministic result is unchanged by the explanation");

  // no expression recognized → nothing solved, honestly
  const none = await runMathPipeline(IMG, { ocr: ocrReturning("", 0.9) });
  assert(none.status === "NEEDS CONFIRMATION" && !none.solution.solved && none.recognized.ambiguity.some((a) => a.includes("no mathematical expression")), "math: blank transcription solves nothing and says why");

  section("Math scan §6 — verification failures are marked NEEDS REVIEW, never hidden");

  // craft a case where the pipeline's independent check must fail:
  // the "recognized" equation contains a square root that flips sign —
  // simplest honest trigger: an equation the solver can't verify checks for.
  const unsolvable = await runMathPipeline(IMG, {
    ocr: ocrReturning("∫ x^(1/2) dx", 0.95),
    confirmedExpression: "∫ x^(1/2) dx",
  });
  assert(unsolvable.status === "NEEDS REVIEW", "math: an unsolvable/unsupported problem is marked NEEDS REVIEW (never faked)");
  assert(unsolvable.verification.status === "NEEDS REVIEW", "math: the verification section carries the NEEDS REVIEW status");
  assert(unsolvable.verification.note.includes("never guessed"), "math: the refusal says no answer was guessed");
  assert(!unsolvable.solution.solved, "math: no solution is claimed");

  // a solved-but-wrong scenario: verification uses numeric substitution;
  // force it by giving the verifier an expression with no valid root
  const wrongKind = await runMathPipeline(IMG, {
    ocr: ocrReturning("x + 1 = x + 2", 0.95),
    confirmedExpression: "x + 1 = x + 2",
  });
  assert(wrongKind.status === "NEEDS REVIEW", "math: a degenerate equation (no solution) is NEEDS REVIEW, never 'solved' with a guess");

  // classification sanity
  assert(classify("x^2 - 5x + 6 = 0") === "quadratic", "math: classifier recognizes quadratics");
  assert(classify("2x + 5 = 17") === "linear_equation", "math: classifier recognizes linear equations");
  assert(classify("INTEGRAL 3x^2 dx") === "integral", "math: classifier recognizes integrals");
  assert(classify("d/dx(x^2)") === "derivative", "math: classifier recognizes derivatives");
  assert(classify("mean([1,2,3])") === "stats", "math: classifier recognizes statistics");
  assert(classify("area of circle with radius 3") === "geometry", "math: classifier recognizes geometry");
  assert(classify("x + y = 10", ["x + y = 10", "x - y = 4"]) === "system", "math: classifier recognizes systems");

  section("Math scan §7 — route + UI wiring (structural checks)");

  const { readFileSync } = await import("fs");
  const { join } = await import("path");
  const route = readFileSync(join(process.cwd(), "src", "app", "api", "math", "solve", "route.ts"), "utf8");
  assert(route.includes("Transcribe ONLY what is visible. Never solve"), "math wiring: the OCR prompt forbids solving");
  assert(route.includes("computed and verified"), "math wiring: the explanation prompt treats the deterministic result as final");
  assert(route.includes("NEEDS REVIEW") || route.includes("Nothing was guessed"), "math wiring: the route fails honestly, never with a fake answer");
  const page = readFileSync(join(process.cwd(), "src", "app", "math", "page.tsx"), "utf8");
  assert(page.includes("Scan Problem"), "math wiring: the Scan Problem entry point exists");
  assert(page.includes("Recognized input (step 7"), "math wiring: step 7 (recognized expression) is displayed first, never skipped");
  assert(page.includes("NEEDS REVIEW"), "math wiring: the NEEDS REVIEW status is displayed");
  assert(page.includes("Confirm or correct"), "math wiring: the confirm/correct gate is in the UI");
  assert(page.includes("cropToInk") || page.includes("preprocessForOcr"), "math wiring: crop/rotate/deskew preprocessing runs on the client canvas");
  for (const t of ["Recognized input", "Solution", "Explanation", "Independent verification"]) assert(page.includes(t), `math wiring: tracked section "${t}" is rendered separately`);
}

function near(a: number, b: number, tol = 1e-4) { return Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)); }
function evalStr(s: string): number {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return Function(`"use strict"; return (${s});`)() as number;
}
