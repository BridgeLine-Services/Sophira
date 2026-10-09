# Sophira — Mathematics Evaluation Suite (2026-10-09)

## Method

Every test compares against an **independently established expected
answer** (hand-verified mathematics or an identity check — e.g. an
antiderivative is "correct" iff differentiating it reproduces the
integrand at multiple sample points; a solution is "correct" iff
substitution satisfies the equation). Tests measure more than string
equality: they verify reasoning steps exist, method labels are truthful,
honest refusals fire (NEEDS REVIEW instead of guesses), and verification
badges reflect actually-executed checks.

## Executed results (2026-10-09, commit in this push)

- `npm test` — **2707/2707 PASS** (includes the 63 new math-engine tests:
  registry integrity 8, orchestrator classification 8, coverage snapshot
  3, pipeline-attachment pins 2, plus the previously reported integral
  family).
- `npx tsc --noEmit` — clean.
- `npm run build` — PASS.

## Category coverage of the evaluation suite

Arithmetic/algebra (elementary → undergraduate), calculus (derivatives,
verified integrals incl. by-parts), linear algebra (det/product/inverse,
recomputed), equation systems (substitution-checked), statistics
(mean/median/std/variance against hand-computed values), number theory
(gcd/primality), combinatorics (binomials/permutations), geometry
(distances, triangle facts), PLUS negative tests: unsupported integrals
(sin(x²) → NEEDS REVIEW), wrong claimed answers (verification FAIL path),
malformed input, ambiguous ± handling, empty OCR text.

## Known limitations (honest register)

1. **Formal proofs:** no proof assistant; proof-flavored answers are
   labeled informal. (external tier, blocked by deployment constraints)
2. **ODE/PDE:** only a subset solved deterministically; the rest refuse
   honestly. Research-level analysis fields are AI-explanation-only.
3. **Numerical precision:** mathjs doubles; error estimates are
   tolerance-based (1e-6), not interval arithmetic.
4. **AI tier:** reasoning quality depends on the configured provider;
   without a key the features return honest configuration errors
   (verified in code, not live-tested here).
5. **Property-based testing:** current suite is example-based with edge
   cases; a property-based harness is a recommended follow-up.
6. **Evaluation data provenance:** all test problems are original or
   classical (no licensed material reproduced).
