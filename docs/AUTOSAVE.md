# Autosave — what saves by itself, and what does not (yet)

**Phase 4C, 2026-11-09.** Plain English. This page states the honest current
coverage; it is deliberately NOT a claim that every screen autosaves.

## How saving works now

- The database is the only copy of record. Autosave never keeps your only
  copy in the browser.
- The status line beside a form tells you exactly one of:
  **Changes waiting to save…**, **Saving…**, **Saved**, **Save failed,
  retrying…**, **Save failed. Your text is still here.**, or
  **This was changed somewhere else.**
- "Saved" appears only after the server confirms the write.
- A failed save retries a bounded number of times (1s, 2s, 4s…) and then
  stops and offers **Try again**. It never retries forever.
- If the same information was changed somewhere else (another tab or
  device), Sophira says so, keeps both versions, and asks which one to keep.
  It never overwrites newer work silently.

## Covered today

- **Settings → profile preferences** (display name, academic level,
  explanation level, answer style, formatting preference, preferred
  language): saves as you type, revision-aware, with the status line.

## Not yet covered (explicitly pending)

- Essays and essay sections, outlines, writing samples, notebook notes,
  research notes, assignments and responses, academic memories, teacher
  preferences, scheduling, integration settings, document revisions.
- Those screens still use their existing explicit save controls. Until each
  one is migrated and tested, this document must not claim universal
  autosave.

## For developers

- `src/lib/save/state.ts` — pure save-state machine (bounded retries,
  debounce planning, revision-conflict detection). Every rule is tested.
- `src/lib/save/useAutosave.ts` — React hook: debounced saves, save on
  navigation, retry with backoff, conflict handling.
- `src/components/ui/SaveStatus.tsx` — the plain-language indicator and the
  conflict/retry actions.
- `tests/autosave.ts` — the contract tests (run by `npm test`).
