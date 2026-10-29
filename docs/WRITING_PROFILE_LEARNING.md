# Writing-profile learning (2026-10-29)

## What shipped

`src/lib/ai/writing-profile-learning.ts` exports one pure function:

```ts
proposeStyleSuggestions(samples, academicLevel, assignmentType): StyleSuggestion[]
```

It reads the user's **own** samples and proposes sentence-variation, vocabulary,
transition, opening and closing adjustments. Every suggestion is
`requiresApproval: true`; nothing is applied automatically and nothing is stored
until the user accepts it. Approved suggestions belong in the existing
`writing_profiles` table (`0001_init.sql`) - no new table, no schema change.

- Levels resolve through `src/lib/ai/academic-levels.ts` (`resolveAcademicLevel`).
  No level names are hardcoded in the new module.
- Scope grows only with evidence: 1 sample -> `temporary`, 2+ -> `course`,
  5+ -> `global`. One correction never rewrites the whole profile.
- Confidence comes from sample count and effect size, not a model guess.
- Deterministic: same input, same output, same ids. Pinned by 15 tests.
- No network calls, no file access, no external data source of any kind.

## What was declined, and why

A request asked for "human-like typing": chunked insertion with deliberate
mistyped characters, so Google Docs' own version history would show a plausible
typing-and-correction trail, plus staggered partial Word uploads (`-draft-1`,
`-draft-2`, ...) so a document would look written in stages.

That was not built. Its stated purpose was to make AI-generated text appear
human-authored and to avoid integrity-system detection. The mechanics exist
only to manufacture evidence of authorship that is false, aimed at the
instructor who reads that version history. A banner saying "this may not work"
does not change what the tool does.

It would also have been bad engineering on its own terms: Google rejects
`insertText` bursts against a stale `requiredRevisionId`, so the correction
trail would surface as conflicts rather than revisions, and the Word path would
fill a student's OneDrive with near-duplicate files.

**Do not rebuild it.** If a future request asks again, the honest answer is
still no, and this note is the record of the reasoning.

## The legitimate half of that request

A student who wants their writing to read as theirs is served by improving
their actual prose, which is what this module does. If "type gradually" is
wanted for a real reason - a long document the user wants to watch being
inserted, with pause and stop - that is a UX request and can be built honestly,
with no fabricated typos and no fake revision count.

## Commands

```
npm test          # 4111 assertions, includes 15 writing-profile pins
npm run lint      # correctness rules only, 0 errors
npx tsc --noEmit
npm run build
```
