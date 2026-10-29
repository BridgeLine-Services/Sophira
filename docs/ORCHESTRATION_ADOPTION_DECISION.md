# Orchestration framework adoption decision (Prompt 6)

**Decision: retain the current architecture. Adopt neither LangGraph nor Haystack.**

## The deficiency test, applied honestly

Prompt 6 permits a framework only if a real workflow deficiency is documented
first. Searching the actual code, the guarantees a framework would supply are
already present and tested:

| Guarantee | Where it already lives | Proof |
|---|---|---|
| Stage validation before completion | `src/lib/readiness/finalGate.ts` | readiness pins in `tests/run.ts` |
| Idempotent retries without duplicates | invitation reuse-on-pending, `deliverInvitation` single row | duplicate-prevention pins |
| Durable, resumable work across failure | queued offline sync, `src/lib/offline/conflicts.ts` | offline suite |
| Explicit user approval before external writes | invitation approve/reject, teacher-rule review | invitation regression suite |
| Ownership check at every stage | RLS + server-side owner assertions | `tests/security/rls-regression.mjs` |
| Narrow tool permissions | no model holds shell/db/network tools; actions are server functions with validated inputs | `policy.ts` + route auth pins |

No workflow was found that loses state, double-writes on retry, or completes a
stage before its validation. **There is nothing for a framework to fix.**

## Candidates, as inspected

- **LangGraph** — Python/JS graph runtime with checkpointers. Adds a second
  state store next to Postgres, a second place where workflow truth can diverge,
  and (for the Python path) a service Sophira does not run. Its valuable ideas
  are explicit transitions and durable checkpoints; both already modelled here
  by the readiness gate and the queued sync.
- **Haystack** — retrieval pipelines. Sophira's retrieval is ranking
  (`rankCandidatesForAssignment`) plus verification (`fetchAndVerify`), both
  measured now (`docs/RESEARCH_RETRIEVAL_BASELINE.md`). Adopting Haystack would
  duplicate ranking and verification logic, which is explicitly forbidden by
  the implementation rules ("do not introduce a second, inconsistent
  implementation").

## What this does NOT dismiss

If a future requirement genuinely needs durable multi-step agent state, the
smallest viable step is a `workflow_runs` table (id, stage, payload, attempts,
updated_at) written by existing server functions - roughly 100 lines, no new
runtime. That remains preferable to a framework until a concrete failure appears.

## Revisit trigger

Revisit only when a documented case exists where a stage completed without its
validation, a retry duplicated a write, or a workflow could not resume after
interruption - evidenced in a real run, not hypothesised.
