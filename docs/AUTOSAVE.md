# Autosave — what saves by itself, and what does not yet

**Phase 4C, updated 2026-11-09.** Plain English. This page states the honest
current coverage; it is deliberately NOT a claim that every screen autosaves.
The authoritative list lives in code (`src/lib/save/targets.ts`) and the tests
assert that this document and that list cannot drift apart.

## How saving works now

- The database is the only copy of record. Autosave never keeps your only
  copy in the browser.
- The status line beside a form tells you exactly one of:
  **Changes waiting to save…**, **Saving…**, **Saved**, **Save failed,
  retrying…**, **Save failed. Your text is still here.**, or
  **This was changed somewhere else.**
- "Saved" appears only after the server confirms the write and sends back the
  version it now holds. A reply without a version counts as **not saved**.
- Every autosaved write carries the version you started from. If the same
  information moved on somewhere else (another tab, another device), the write
  is refused instead of overwriting newer work, both versions are kept, and you
  choose which to keep.
- A failed save retries a bounded number of times (1s, 2s, 4s, up to 4 attempts,
  capped at 30s) and then stops and offers **Try again**. It never retries
  forever, and a refusal (such as "not allowed") is never retried at all.

## Covered today (autosaves as you type, tested)

| What you edit | Where | Route | Version token |
| --- | --- | --- | --- |
| Profile preferences (display name, academic level, explanation level, answer style, formatting, preferred language) | Settings | `/api/profile` | `updated_at` |
| Essay outline (the section titles you edit before approving) | `/essay` | `PATCH /api/essay/draft-section` | `updated_date` |

Both show the status line with **Try again** / **Keep my version** /
**Use the other version**.

## Route ready, editor not migrated yet

These writes already exist and are revision-safe, but the screen still uses an
explicit Save button, so this page does not claim autosave for them:

- Writing samples (voice profile) — `/api/typing/profile`
- Research source approval — `/api/research`
- Academic memories — `/api/memory/[id]`
- Study schedule — `/api/schedule`
- Integration selections — `/api/integrations/selections/[id]`
- Notebook title and description — `/api/notebooks/[id]`

## Deliberately not autosaved

- **Notebook note being written.** A note is appended as a new row when you
  press Save. Autosaving keystrokes would create a row per pause, so the
  composer keeps a local draft instead.
- **Document revisions.** They are appended by the document pipeline and are
  immutable by design; there is nothing to confirm.
- **Assignments, assignment responses, teacher preferences.** No member-facing
  editor exists for these yet, so there is nothing to autosave. Assignments
  arrive from courses and the schedule; teacher preferences are learned from
  corrections.

## For developers

- `src/lib/save/state.ts` — pure save-state machine (bounded retries, debounce
  planning, revision-conflict detection). Every rule is tested.
- `src/lib/save/useAutosave.ts` — React hook: debounced saves, save on
  navigation, retry with backoff, conflict handling.
- `src/lib/save/targets.ts` — the registry of every member-editable thing, with
  honest coverage labels (`wired`, `route-ready`, `no-editor` + reason).
- `src/lib/save/draft.ts` — `makeDraftSaver()`: sends the base version, maps 409
  to a conflict, maps transport faults to retryable errors, and refuses to
  report success when the response carries no version.
- `src/components/ui/SaveStatus.tsx` — the plain-language indicator and the
  conflict/retry actions.
- `tests/autosave.ts` — the contract tests, including the registry honesty
  checks and the saver behaviours (run by `npm test`).

## Adding a new autosaved screen

1. Confirm the write route returns the new version in its response body.
2. Add or update the target in `src/lib/save/targets.ts`.
3. Use `useAutosave({ save: makeDraftSaver(target) })`, call `markEdited()` on
   every edit, and render `<SaveStatus />`.
4. Flip its coverage to `wired` only after the page really does that, and add
   the assertion to `tests/autosave.ts`.
