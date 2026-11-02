# Writing review workspace (Stage 3, 2026-11-02)

A new route, `/writing/review`, that reviews ONE draft at a time. It extends the
existing writing system and replaces none of it.

## What it does

| Area | What Sophira reports | Evidence attached |
|---|---|---|
| Originality | verbatim overlap, possible close paraphrase, reused source phrases | the matched source passage plus both text offsets |
| Quotations | quoted text with no nearby citation; quotations not found in the supplied sources | the quotation itself |
| Citations | claims with numbers or "research shows" and no marker | the sentence |
| Writing | unsupported claims, weak evidence, abrupt transitions, repetition, terminology drift, formatting, missing reference entries, unmet rubric items | the passage and a plain explanation |

Every finding is individually acceptable or rejectable. The student's original text
is never overwritten: accepting a mechanical fix builds a *revision* that only
replaces the draft when **Use this version** is pressed.

## What it deliberately does not do

* No AI-detector checking, no evasion, no invisible characters, no promised scores.
* No similarity percentage, ever. A percentage implies a complete corpus and reads
  as a grade. The payload states `similarityPercent: null` explicitly.
* No internet or institutional-database search. It compares only sources the
  student supplies (pasted, or their own saved `academic_sources` rows).
* It never rewrites prose on its own. Only whitespace and punctuation fixes carry an
  automatic replacement; everything requiring judgement is advice.

## Privacy and isolation

The route reads with the user-scoped Supabase client and filters saved sources by
`user_id`. It writes nothing: no draft, no findings, no profile change. Personal
style learning still runs through the existing proposal-and-approval flow, which
this feature does not touch.

## Citation statuses

Reuses `CitationStatus` from `src/lib/research/citation-invariant.ts`:
`VERIFIED` is only shown as verified when verification really happened upstream;
`UNVERIFIED`, `UNAVAILABLE` and `STALE` each get their own honest wording. An
unavailable source is never presented as supporting a claim.

## Tests

`tests/run.ts` → `runWritingReviewTests()` — 60+ assertions covering overlap
detection with offsets, paraphrase thresholds, uncited quotations and statistics,
the two near-identical-paragraph and near-identical-sentence cases, formatting
fixes, bibliography gaps, rubric gaps, accept/reject behaviour, goal filtering,
stable finding ids, citation-status honesty, cross-user isolation pins, a large
document timing check, and the existing writing-profile/proposal system remaining
untouched.

## Rollback

`git revert` the Stage 3 commits. Nothing is added to the database, so there is no
migration to reverse.
