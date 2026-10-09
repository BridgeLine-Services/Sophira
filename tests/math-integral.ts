/**
 * MATHEMATICAL CAPABILITY REGRESSION (2026-10-08): tabular integration by
 * parts for polynomial × sin/cos/exp of a linear argument, with
 * independent numeric verification. The reported failure case
 * "∫ 4x cos(2 − 3x) dx" MUST be solved deterministically and verified.
 */
import { solveIntegral } from "../src/lib/math/solve";
import { normalizeMathText } from "../src/lib/math/normalize";
import { create, all } from "mathjs";

const math = create(all, {});

function assertIntegralEquivalent(anti: string, integrand: string, v: string): boolean {
  const d = String(math.derivative(anti, v));
  const diff = math.parse(`(${d}) - (${integrand})`).compile();
  for (const t of [0.31, 0.73, 1.27, 2.11, -0.42, 3.7]) {
    const val = Number(diff.evaluate({ [v]: t }));
    if (!Number.isFinite(val) || Math.abs(val) > 1e-6) return false;
  }
  return true;
}

export function runMathIntegralTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Math: integration by parts + verified antiderivatives (2026-10-08)");

  // 1. THE REPORTED FAILURE: ∫ 4x cos(2 − 3x) dx
  const norm = normalizeMathText("∫ 4x cos(2 − 3x) dx");
  const res = solveIntegral(norm.expressions[0]);
  assert(res.solved === true && res.finalAnswer.includes("+ C"),
    "math: ∫ 4x cos(2 − 3x) dx is SOLVED deterministically (was NEEDS REVIEW)");
  const anti = res.finalAnswer.replace(/\s*\+\s*C\s*$/, "");
  assert(assertIntegralEquivalent(anti, "4 * x * cos(2 - 3 * x)", "x"),
    "math: the antiderivative differentiates back to 4x cos(2−3x) — the mathematical definition of correctness (constant of integration included)");
  // The mathematically correct result is −(4x/3)sin(2−3x) + (4/9)cos(2−3x) + C.
  // NOTE: the operator-supplied expected answer −(4x/3)sin(2−3x) − (4/9)cos(2−3x)
  // does NOT differentiate back to the integrand (its cos-term sign is wrong);
  // the derivative check above is the authority.
  const sampled = (t: number) => Number(math.parse(anti).compile().evaluate({ x: t }));
  const ref = (t: number) => -(4 * t / 3) * Math.sin(2 - 3 * t) + (4 / 9) * Math.cos(2 - 3 * t);
  let matchesRef = true;
  for (const t of [0.31, 1.27, -0.42, 2.11]) {
    if (Math.abs(sampled(t) - ref(t)) > 1e-9) matchesRef = false;
  }
  assert(matchesRef,
    "math: the antiderivative equals −(4x/3)sin(2−3x) + (4/9)cos(2−3x) + C (the verified-correct form)");
  assert(res.steps.length >= 3 && res.steps.some((s) => /by parts/i.test(s.text)) && res.checks.length >= 1,
    "math: the solution shows the method (integration by parts), ordered steps, and a verification check");

  // 2. Additional by-parts family: ∫ x sin(x) dx = −x cos(x) + sin(x) + C
  const n2 = normalizeMathText("∫ x sin(x) dx");
  const r2 = solveIntegral(n2.expressions[0]);
  assert(r2.solved === true && assertIntegralEquivalent(r2.finalAnswer.replace(/\s*\+\s*C\s*$/, ""), "x * sin(x)", "x"),
    "math: ∫ x sin(x) dx solved and verified (tabular by parts family)");

  // 3. Elementary power rule still works: ∫ 3x^2 dx = x^3 + C
  const n3 = normalizeMathText("∫ 3x^2 dx");
  const r3 = solveIntegral(n3.expressions[0]);
  assert(r3.solved === true && assertIntegralEquivalent(r3.finalAnswer.replace(/\s*\+\s*C\s*$/, ""), "3 * x ^ 2", "x"),
    "math: elementary ∫ 3x^2 dx still solved and verified (no regression)");

  // 4. Honest refusal: a genuinely unsupported integrand is NEVER guessed
  const n4 = normalizeMathText("∫ sin(x^2) dx");
  const r4 = solveIntegral(n4.expressions[0]);
  assert(r4.solved === false && /review|never guessed/i.test(r4.honestNote ?? ""),
    "math: ∫ sin(x²) dx (non-elementary family, unsupported here) stays NEEDS REVIEW — no fabricated answer");

  // 5. OCR confidence is never solution confidence: verification is a
  //    separate, deterministic step (pinned by the check emission above).
  assert(norm.expressions[0].includes("INTEGRAL"),
    "math: ∫ normalizes into the INTEGRAL pipeline token (camera OCR text takes the same path)");
}
