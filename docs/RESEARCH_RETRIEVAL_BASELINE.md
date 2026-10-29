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

## CORRECTION and FIX (2026-10-29, same day)

Re-measured with **realistic snippets** (the first fixtures gave every candidate
the same 18-character snippet, which zeroed the evidence-quality signal and
invalidated the comparison):

- **Finding 1 - CONFIRMED and FIXED.** A Medium blog did outrank the FDR
  Presidential Library archive on a no-requirement search. Cause: neither host
  matched an authority tier, so thin-snippet-era scoring decided it. Fix: a
  host-based institutional-repository signal (+3) in `assessSourceAuthority`.
  Measured after: `fdrlibrary.org score=11` vs `medium.com score=8`.
- **Finding 2 - RETRACTED, my error.** Teacher source types do **not** remove
  non-satisfying sources; they demote them. The single-result output came from
  the `score > -4` usability cutoff acting on the unrealistic fixtures. With
  real snippets the same case returns all three, teacher-required first.

Guardrails added: the signal is **host-based only** (a blog with "archive" in
its title gains nothing), it never outranks a satisfied teacher requirement, and
four pins lock that behaviour. No vector database, no framework, no change to
source verification or citation records.
