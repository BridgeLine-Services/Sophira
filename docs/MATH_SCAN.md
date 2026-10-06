# Scan Problem — image-to-solution pipeline (2026-10-06)

Turns a photographed equation into verified, step-by-step solutions.

## The 13-step flow (machine-checkable state machine)

1. Tap **Scan Problem** → 2. capture → 3. crop / rotate / deskew
(deterministic: Otsu ink mask, bounding-box crop, projection-profile
deskew — all pure, unit-tested functions in `src/lib/math/image.ts`) →
4. detect expression (ink-ratio band check; blank or unreadable images
are refused honestly) → 5. OCR mathematical notation (vision model
prompted to transcribe ONLY — never solve, never correct) →
6. reconstruct the symbolic expression (`normalizeMathText`: x²→x^2,
√→sqrt(), ÷→/, ×→*, vulgar fractions, integrals) →
7. **display the reconstructed expression — NEVER SKIPPED** →
8. confirm / correct (gate: nothing is solved until confirmed; low OCR
confidence is flagged) → 9. solve deterministically → 10. AI explains →
11. teacher-specific method → 12. verify independently → 13. display steps.

## Authority

The LLM is NEVER the mathematical authority. Solving and verification are
deterministic (mathjs + hand-derived formulas + finite differences):

- solve: `src/lib/math/solve.ts` (linear, quadratic, systems via LU,
  derivatives, elementary integrals, matrices, statistics, geometry,
  template-mapped word problems — anything unmapped is refused, never
  guessed)
- verify: `src/lib/math/pipeline.ts` re-derives with DIFFERENT mechanisms
  (numeric substitution, numeric differentiation, sample-point
  equivalence) plus the existing machine-check engine.

## Separate tracking

The result carries four sections independently: **recognized input**
(raw OCR text, reconstructed expression, confidence, ambiguity),
**solution** (kind, steps, final answer), **explanation** (AI or
deterministic template, with the honest note that verification is the
authority), **verification** (status, per-check details, note).

## Honesty rules

- Step 7 is structurally unskippable — every result carries
  `recognized.expression` and the UI renders it first.
- Low OCR confidence → NEEDS CONFIRMATION; nothing is solved first.
- Unsupported problems (e.g. non-elementary integrals, unmapped word
  problems) are refused with an honest note — no guessed answer.
- Failed verification → answer marked **NEEDS REVIEW**, displayed, never
  hidden, never replaced by a guess.

## Supported domains (all tested)

fractions, exponents, square roots, linear equations, quadratics
(including negative discriminants), systems of equations, derivatives,
elementary integrals, matrices (det/inv/transpose/product),
statistics (mean/median/std/variance), geometry (circle area,
circumference, rectangle, triangle, Pythagorean), word problems
(sum/difference template).

API: `POST /api/math/solve` — `{ image_data_url, rotation?, confirmed_expression? }`
or `{ expression }`. UI: `/math`. Tests: `tests/math-pipeline.ts` (§ TEST_REPORT 59).
