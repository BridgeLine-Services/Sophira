# Document activity, recovery copies, and gradual insertion (Stage 4, 2026-11-02)

This stage extends the existing document-history system. It does not replace it,
and it adds no new source of truth: every entry still comes from
`public.document_history`, owner-scoped, with OAuth tokens never included.

## What a student sees

The timeline in the document browser now leads with plain language:

| Instead of | The student reads |
|---|---|
| `insertion_confirmed` · `sophira-inserted` | "The provider confirmed content was inserted. Sophira did this after you approved it. Confirmed by the provider." |
| `external_change_observed` | "The document changed outside Sophira. Sophira cannot tell who did it." |
| `recovery_copy_created` | "A recovery copy of the remaining text was saved." |

`describeHistoryEvent()` owns that wording, so the UI cannot drift into inventing
its own claims. The technical labels stay visible underneath for anyone who wants
them, but a student never has to read them.

## Gradual insertion (optional)

`/api/integrations/google/doc-update/gradual` writes approved text in a few
confirmed steps so a long insertion can be watched, paused, resumed, or stopped.

- **Progress is provider-confirmed**, never estimated. A chunk counts only after
  Google's write returns success.
- **Every write is revision-guarded** with `requiredRevisionId`, so a document that
  changed underneath us produces a conflict instead of an overwrite.
- **Stopping keeps the remainder**: the unwritten text is stored as a real
  `recovery_copy_created` snapshot on the same document, and `insertion_stopped`
  records that the student ended it.
- **Network drops are not data loss.** Each call reports the character offset Google
  confirmed; pressing Continue resumes from that offset.

The state machine (`transitionGradual`) is pure and tested: an insertion that never
started cannot be paused, paused runs can be cancelled, finished runs cannot be
resumed or stopped, and zero-character progress is refused.

### What gradual insertion is not

It is not typing simulation. There are no artificial delays, no injected typos, no
randomised pauses, and no manufactured revision trail. `GRADUAL_DISCLAIMER` says so
in the UI, and two tests forbid the machinery (`setTimeout`, `Math.random`, typo
injection) from appearing in the module or its route.

## What the timeline can and cannot prove

It records what Sophira did and what the provider reported. It cannot establish who
typed a passage, and version metadata is not authorship evidence. That limit is
stated in `HISTORY_DISCLAIMER` and repeated in the timeline's empty state.

## Rollback

No database migration was added in this stage, so rollback is a plain revert of the
Stage 4 commits. Existing rows in `document_history` remain valid: the two new event
types are additions to an existing text column, and older code reading the table
simply ignores them.
