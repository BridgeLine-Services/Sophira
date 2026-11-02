# Stage 4 implementation report (2026-11-02)

Scope delivered: gradual insertion with pause/resume/stop, recovery copies, and a
plain-language activity timeline, on top of the existing document-history system.

## Changed files

| File | Change |
|---|---|
| `src/lib/integrations/gradual-insert.ts` | NEW. Pure chunk planner + insertion state machine. No I/O. |
| `src/lib/integrations/history-labels.ts` | NEW. Client-safe vocabulary and plain-language wording. |
| `src/app/api/integrations/google/doc-update/gradual/route.ts` | NEW. Revision-guarded chunked insertion; records pending, confirmed, stopped, conflicted, recovery-copy events. |
| `src/components/app/GradualInsertPanel.tsx` | NEW. Progress, pause, continue, stop, cancel, conflict and recovery messaging. |
| `src/components/app/DocumentBrowser.tsx` | Timeline leads with plain language; panel mounted for a selected Google Doc. |
| `src/lib/integrations/history.ts` | Two new event types; vocabulary split out and re-exported. Behaviour unchanged. |
| `tests/document-history.ts` | +73 assertions across planning, state machine, honesty, route wiring, timeline wording, UI. |
| `docs/DOCUMENT_ACTIVITY.md` | NEW. How the timeline and gradual insertion work, and what they cannot prove. |

## Database

**No migration.** The two new event types are new values in an existing text column
(`document_history.event_type`). Existing rows stay valid; older code ignores the new
values. Nothing to reverse.

## Compatibility

Manual insertion, the single-shot `doc-update` route, Microsoft discovery, replacement,
version listing and restore are untouched. No response contract changed. No AI provider
routing touched. Students without Google keep working exactly as before.

## Test evidence

`npm test` → **4443 passed, 0 failed** (73 new in this stage).
`npm run lint` → 0 errors (107 pre-existing warnings, unchanged).
`npm run verify` → PASS. `npm run scan:secrets` → CLEAN. `npm run build` → succeeds.
CI on `master` → success (run 41492578989 at `b317056`).

Behaviour covered: chunk planning reassembles byte-identically and never cuts mid-word;
every illegal state transition is refused; a finished run cannot be resumed or stopped;
zero-character progress is refused; the disclaimer states this is not typing simulation;
`setTimeout`, `Math.random` and typo machinery are forbidden by test; the route is
authenticated, revision-guarded, RLS-only (no service-role client), and records a
recovery copy whenever text is left unwritten.

## Verified vs not verified

**Verified by execution:** all pure logic, the build, the bundle contents (secret scan),
and the source wiring of the route and UI.

**NOT verified:** no live Google or Microsoft call has been exercised, because that needs
an owner OAuth registration and a real document. The route is proven to *compile and be
correctly wired*, not to have inserted into a real Doc. Treat Stage 4 as
build-verified, not hardware-tested.

## Rollback

`git revert b317056` (plus the follow-up commit) restores the previous behaviour. No data
migration to undo; no rows are rewritten. Recovery copies already stored remain readable
because storage format is unchanged.
