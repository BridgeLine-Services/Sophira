# Sophira — Universal Mathematics Engine

**Date:** 2026-10-09 · **Status:** first release of the orchestration layer and capability registry

## Architecture (what actually exists in code)

```
problem text/image
   │  OCR + normalize (existing pipeline, src/lib/math/{image,normalize,pipeline}.ts)
   ▼
classifyMathProblem()            ← NEW src/lib/math/orchestrator.ts
   │  symbol expansion (∫→integral, ∂/dy/dx→derivative, ∑, √, lim)
   │  → registry node (field/subfield), requested output, difficulty,
   │  engine tier, verification level, HONEST LIMITS
   ▼
MATHEMATICS_REGISTRY             ← NEW src/lib/math/registry.ts
   │  11 top-level areas (MSC2020-inspired), 46 nodes, aliases,
   │  prerequisites, methods, verification strategy per node,
   │  four honest statuses: implemented_tested / implemented_partial /
   │  ai_reasoning / planned
   ▼
engine tier
   ├─ deterministic — src/lib/math/solve.ts (mathjs):
   │    symbolic (simplify/factor/expand/solve/derivative),
   │    integration (power rule + tabular by-parts, numerically verified),
   │    matrices (det/product/transpose/inverse), equation systems
   │    (substitution-verified), statistics (mean/median/std/variance),
   │    discrete (combinatorics/gcd/primality)
   ├─ ai_reasoning — existing AI provider (OPENAI_API_KEY / Gemini tier):
   │    interpretation, strategy, explanation, informal arguments
   └─ external — NOT INSTALLED (see below); honestly blocked, never faked
   ▼
verification (existing, unchanged in spirit): every deterministic claim is
independently re-checked (mathjs symbolic equality, numeric sampling at
sample points, finite-difference derivative checks, matrix recomputation).
AI-tier answers are labeled UNVERIFIED. Proof requests are labeled INFORMAL.
```

## Why the engine set is what it is (dependency evaluation)

| Tool | Verdict | Reason |
|---|---|---|
| **mathjs** (bundled) | **selected** | pure JS, ~0 runtime install cost, works in browser AND offline PWA, MIT license; powers the whole existing verified pipeline |
| SymPy (Python) | not installed | needs a Python runtime beside the Next.js serverless functions; adds a service to deploy/secure; not offline-capable in the PWA |
| NumPy/SciPy | not installed | same as SymPy; current numeric needs (roots, sampling, stats, matrices) are covered by the tested mathjs layer |
| Lean + Mathlib | not installed | gigabyte-scale; incompatible with serverless/offline constraints; formal proofs marked honestly as a FUTURE external tier |
| statistics stack | not installed | descriptive stats + probability verified in-suite; heavier inference marked `implemented_partial` |

**Licensing/security:** mathjs is MIT, ships no eval of untrusted code
(`create(all, {})` with no `math.import` of unsafe factories; expressions
are parsed, never `eval`ed). No heavyweight dependency was added.

## Offline behavior (existing architecture, unchanged)

- Fully offline: normalization, symbolic solve, verified integration,
  matrices, equation systems, stats — all deterministic mathjs, no network.
- Offline after install: local AI model tasks (existing model manager).
- Online only: AI provider reasoning, research/retrieval. The
  classification labels which tier a problem needs — the UI can state
  availability before the user tries.

## Extension path

1. Add a node to `src/lib/math/registry.ts` (aliases, prereqs, methods,
   verification level, HONEST status) — the suite enforces integrity.
2. Wire an engine (extend `solve.ts` or a new adapter module).
3. Add regression tests with independently verified expected answers.
4. Flip the node status to `implemented_tested` — only then.

Never flip a status without a passing test: the suite pins that statuses
are one of the four honest values, and the coverage snapshot counts nodes
exactly, so the dashboard cannot claim more than is real.
