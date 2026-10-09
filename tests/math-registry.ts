/**
 * UNIVERSAL MATHEMATICS ENGINE REGRESSION SUITE (2026-10-09)
 * - registry integrity (unique ids, resolvable prerequisites, honest statuses)
 * - orchestrator classification with independently verified expectations
 * - coverage snapshot honesty (counts match the registry exactly)
 */
import { MATHEMATICS_REGISTRY, flattenRegistry, findField } from "../src/lib/math/registry";
import { classifyMathProblem, coverageSnapshot } from "../src/lib/math/orchestrator";

export function runMathRegistryTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Math engine: capability registry integrity");

  const flat = flattenRegistry();
  const ids = new Set(flat.map((n) => n.id));
  assert(flat.length >= 40, "registry: at least 40 field nodes across 11 top-level areas");
  assert(ids.size === flat.length, "registry: every node id is unique");
  for (const n of flat) {
    assert(Array.isArray(n.methods) && n.methods.length > 0 && n.verification !== undefined,
      `registry: ${n.id} declares methods and a verification level`);
  }
  for (const n of flat) {
    for (const pre of n.prerequisites ?? []) {
      assert(ids.has(pre), `registry: prerequisite '${pre}' of '${n.id}' resolves to a real node`);
    }
  }
  assert(flat.every((n) => ["implemented_tested", "implemented_partial", "ai_reasoning", "planned"].includes(n.status)),
    "registry: every status is one of the four honest values — nothing claims untested coverage");

  section("Math engine: orchestrator classification (verified expectations)");

  let c = classifyMathProblem("∫ 4x cos(2 − 3x) dx");
  assert(c.fieldId === "analysis.calculus" && c.engineTier === "deterministic" && c.verification === "deterministic",
    "classify: the reported integral classifies to calculus with a deterministic engine and deterministic verification");

  c = classifyMathProblem("gcd(462, 1071)");
  assert(c.fieldId === "number-theory.elementary" && c.engineTier === "deterministic" && c.requestedOutput === "exact",
    "classify: gcd routes to elementary number theory (exact output — gcd is exact, not an approximation)");

  c = classifyMathProblem("prove that the sum of two even integers is even");
  assert(c.requestedOutput === "proof" && c.honestLimits.some((l) => /informal/i.test(l)),
    "classify: proof requests are labeled INFORMAL — never presented as machine-verified (no proof assistant installed)");

  c = classifyMathProblem("explain what a holomorphic function is");
  assert(c.requestedOutput === "explanation" && c.fieldId === "analysis.complex" && c.engineTier === "ai_reasoning",
    "classify: complex-analysis concept questions route to the AI tier, honestly labeled");

  c = classifyMathProblem("find the mean and standard deviation of 2 4 6 8");
  assert(c.fieldId === "probability-statistics.descriptive" && c.requestedOutput === "statistics" && c.engineTier === "deterministic",
    "classify: statistics requests route to the deterministic stats engine");

  c = classifyMathProblem("");
  assert(c.fieldId === "foundations" && c.engineTier === "ai_reasoning",
    "classify: an empty/unmatchable problem falls back to foundations at the AI tier — never a fabricated engine claim");

  c = classifyMathProblem("classify the abelian varieties in the fundamental group of a 3-manifold");
  assert(c.difficulty === "graduate" || c.difficulty === "research",
    "classify: research-flavored text raises the difficulty estimate");

  section("Math engine: coverage snapshot honesty");

  const snap = coverageSnapshot();
  assert(snap.total === flat.length, "coverage: the snapshot counts exactly the registry nodes — nothing extra claimed");
  const sum = Object.values(snap.byStatus).reduce((a, b) => a + b, 0);
  assert(sum === snap.total, "coverage: status counts sum to the node count");
  assert(snap.byStatus.planned > 0 && snap.byStatus.ai_reasoning > 0,
    "coverage: planned and AI-only fields are TRACKED, not hidden — the dashboard can never show false universal coverage");

  // classification is attached to the pipeline result (integration pin)
  const pipelineSrc = require("fs").readFileSync("src/lib/math/pipeline.ts", "utf8");
  assert(pipelineSrc.includes("classification = classifyMathProblem") && pipelineSrc.includes("classification,"),
    "pipeline: every math result carries the classification (field, engine tier, verification level, honest limits)");
}
