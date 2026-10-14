/**
 * MCQ + editor + typeset regression (2026-10-14). Run via the project's
 * tsx runner. Real mathematical assertions only - no string smoke tests.
 */
import { analyzeMultipleChoice, detectChoices } from "../src/lib/math/mcq";
import { latexToCanonical } from "../src/lib/math/latex";

let n = 0;
function check(label: string, cond: boolean) {
  if (!cond) throw new Error("mcq/editor: " + label);
  n++;
}

// 1) Choice detection + evaluation against the INDEPENDENTLY solved base
const r1 = analyzeMultipleChoice("Solve for x: 2x + 6 = 14\nA) 4\nB) 5\nC) 10\nD) 8");
check("base solved and established", r1.established);
check("A is correct (4)", r1.choices[0].verdict === "correct");
check("B-D incorrect", r1.choices.slice(1).every((c) => c.verdict === "incorrect"));
check("base preserved", r1.base.includes("2x"));

// 2) NOT-question inverts the logic
const r2 = analyzeMultipleChoice("Which is NOT a solution of x^2 = 9? A) 3 B) 5 C) -3");
check("inversion detected", r2.inverted);
check("B (5) is the correct choice for a NOT question", r2.choices[1].verdict === "correct");
check("A and C marked incorrect for the NOT question", r2.choices[0].verdict === "incorrect" && r2.choices[2].verdict === "incorrect");

// 3) Unestablishable base -> nothing guessed
const r3 = analyzeMultipleChoice("Integrate: ∫ sin(x^7) dx A) cos(x^7) B) -cos(x^7)");
check("unestablished base refuses to judge", !r3.established && r3.choices.every((c) => c.verdict === "cannot_determine"));

// 4) LaTeX editor conversion keeps structure (fractions, roots, integrals, exponents)
check("frac", latexToCanonical("\\frac{3}{4} + \\frac{1}{2}") === "(3)/(4) + (1)/(2)");
check("sqrt", latexToCanonical("\\sqrt{x}") === "sqrt(x)");
check("nth root", latexToCanonical("\\sqrt[3]{x}").includes("(x)^(1/(3))"));
check("integral", latexToCanonical("\\int e^{x} \\, dx").includes("∫") && latexToCanonical("\\int e^{x} \\, dx").includes("dx"));
check("exponent grouping", latexToCanonical("x^{2y}") === "x^(2y)");

console.log(`math-mcq/editor round: PASS (${n} checks: MCQ evaluation, inversion, honest refusal, LaTeX structure)`);
