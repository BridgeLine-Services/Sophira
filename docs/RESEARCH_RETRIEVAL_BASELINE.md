# Research ranking baseline (measured 2026-10-29)

Prompt 4 requires measuring the current research system before considering
pgvector or Haystack. `scripts/research-bench.mjs` runs the **shipped**
`rankCandidatesForAssignment()` (`src/lib/research/authority.ts:406`) against
synthetic candidate sets. No logic was changed.

| Case | Resulting order | Finding |
|---|---|---|
| History, `sourceType: any` | `jstor.org > medium.com > fdrlibrary.org > cnn.com` | **DEFECT**: a blog outranks the FDR Presidential Library archive |
| History, `sourceType: primary sources` | `trumanlibrary.gov` (only) | teacher gate **filters** non-satisfying candidates out of the result entirely |
| Science, `sourceType: peer-reviewed` | `nature.com` (only) | same hard filtering |

## The two findings

**1. Authority inversion on unconstrained assignments.** With no teacher
requirement, a `medium.com` post ranks above `www.fdrlibrary.org`. The top
candidate's own explanation is "Thin snippet - lower evidence-quality signal",
so the score is being decided by snippet heuristics rather than the profile
tier. Tier came back `null` for that case. A student would be handed a blog
ahead of a primary-source archive.

**2. Teacher requirements remove alternatives instead of demoting them.** This
is documented behaviour ("teacher requirements OVERRIDE generic ranking"), and
it is defensible for citation discipline. But it has a consequence worth
stating: with `sourceType: primary sources` and `minSources: 3`, one satisfying
hit yields **one** source and no fallback suggestions. Whether that is intended
is an open question for the owner, not something this audit should silently
"fix".

## Decisions

- **pgvector: NOT adopted.** Retrieval infrastructure is not the bottleneck
  shown here. The measured defects are in *scoring*, not in vector search, and
  embeddings would not fix either one.
- **Haystack: NOT adopted.** Nothing in the measurement suggests the pipeline is
  unmaintainable; the failures are two specific, local rules.
- **No logic change in this phase.** Both findings need an owner decision
  (weighting vs. filtering), and changing ranking silently would alter which
  sources students cite.

## What remains unmeasured

Claim-to-evidence verification (`verify.ts`, `claims.ts`), dead-link and
access-refusal handling, and the boundary behaviour on real search results.
These need live or recorded fixtures, not synthetic hits.
