# Sophira — Mathematics Coverage (generated from the registry, 2026-10-09)

Machine source: `src/lib/math/registry.ts` (46 nodes), snapshot via
`coverageSnapshot()` in `src/lib/math/orchestrator.ts`.

## Summary by honest status

| Status | Meaning | Count |
|---|---|---|
| implemented_tested | deterministic engine + regression tests with verified expected answers | 10 |
| implemented_partial | engine covers a subset; outside it the system REFUSES (NEEDS REVIEW), never guesses | 7 |
| ai_reasoning | classification + explanation + honest UNVERIFIED labeling; no deterministic engine | 10 |
| planned | classified and explained honestly; no engine | 19 |

## Top-level areas and their deepest tested capability

| Area | Deepest tested capability | Verified by |
|---|---|---|
| Foundations, logic & history | AI explanations labeled informal | suite (registry pins) |
| Algebra | symbolic solve/factor/expand; matrices det/product/inverse | tests/run.ts + math-integral |
| Number theory | gcd/lcm, primality, factorization on stated inputs | tests/run.ts |
| Analysis | derivatives + integrals (power rule + by-parts) with numeric verification | tests/math-integral.ts |
| Calculus/ODE/PDE | separable ODEs, multivariable partials; PDEs honest-refused | tests/run.ts |
| Geometry & topology | distances, triangle facts, analytic geometry | tests/run.ts |
| Probability & statistics | mean/median/std/variance; combinatorial probability | tests/run.ts |
| Discrete & computation | combinatorics, small-graph recomputation, recurrences (partial) | tests/run.ts |
| Applied mathematics | optimization sub-cases numeric; physics AI-only labeled | suite (registry pins) |
| Specialized fields | all nodes tracked as planned — never claimed | suite (registry pins) |

**Explicit non-claims.** Sophira does NOT claim exhaustive MSC2020
coverage, does NOT claim formal-verification capability (no proof
assistant is installed), does NOT claim SymPy/SciPy/Lean support, and the
registry exists precisely so that untested areas are visible rather than
implied by a topic list.
