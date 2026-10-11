# Google ADK Architecture Review

Reviewed: 2026-10-11, against the current Sophira commit (master, 03ac117+),
for the purpose of adopting genuinely useful patterns from Google's Agent
Development Kit (ADK, github.com/google/adk-python) without adding
unnecessary infrastructure.

## Decision

**Do not install the Python ADK and do not add a Python service.** Sophira is
a Next.js/TypeScript application whose workflow needs (staged task
execution, tool boundaries, persisted state, human confirmation) are
already satisfied by its existing architecture. A second runtime would add
deployment complexity, data movement between services, and a new security
boundary, with no capability Sophira lacks. The useful ADK patterns are
adopted as TypeScript equivalents inside the existing code.

## Patterns reviewed and their Sophira equivalents

| ADK concept | Already in Sophira | Adopted now |
|---|---|---|
| Explicit workflow stages (each stage's output verified before the next) | The document workflow (import -> edit -> export) and the essay/deadline state machines already verify at every stage; tests refuse unverified stage completion | The PowerPoint pipeline follows the same discipline: build -> fit/bound -> cite -> deliver, and its tests refuse a file that does not round-trip through the independent reader |
| Tools with narrow permissions | Every AI path is server-side with user-scoped Supabase access and RLS; the model never receives unrestricted DB or filesystem access | Reaffirmed: the pptx builder receives only the stored artifact row; the export route is the same guarded, digest-verified pipeline as DOCX/PDF |
| Reliable task state | The deadline scheduler persists execution state server-side; notebooks/artifacts are stored rows | No new state store was needed for presentations: the stored artifact row is the single source, so no duplicated session state exists to drift |
| Human confirmation before external writes | The Changes system (accept/reject) and essay revisions already require explicit user approval | The provider integrations (Word/Google Docs, next stage) will require explicit Save/Sync actions with confirmation before any destructive overwrite, per the same pattern |
| Retries and idempotency | Export is deterministic from the stored row; the offline sync prevents duplicate writes | PowerPoint export is idempotent by construction (same artifact row -> same slides; structural determinism asserted), and oversized input is capped and disclosed rather than retried blindly |
| Evaluation | 3,218-assertion offline suite, CI, and the release gate | tests/pptx-export.ts adds real-file evaluation: the generated .pptx is parsed by the repository's INDEPENDENT reader (the same parser used for uploads), not by the generator itself |
| Honest observability | Stages report real state; the release gate never reports unverified claims; secrets are never logged | Speaker notes and the References slide carry provenance inside the artifact itself; generation errors are honest 400s, never false success states |
| Security boundaries | Owner/user separation, RLS, invitation-only signup, secret scanning | Unchanged; no new boundary was introduced because no new service exists |

## Testing of the adopted patterns

- `tests/pptx-export.ts`: real generation, package validation, independent
  reader round-trip (titles, bullets, unicode, citations, speaker notes),
  structural determinism, capping disclosure, invalid-input rejection, and
  route-level honesty checks.
- The complete suite (3,218 assertions) runs on every push through CI, and
  the scheduled health workflow runs the full authoritative gate.

## What was deliberately NOT adopted

- A second agent runtime or Python microservice: no requirement justifies it.
- A new database for agent sessions: existing tables and RLS cover the need.
- A generic "one engine" writer: subject-specific course engines are preserved by design.
