# Sophira: current state, safety report and change record

**Date:** 2026-11-13
**Author:** Base44 Superagent (acting as architect, engineer, and QA for this round)
**Repository:** https://github.com/BridgeLine-Services/Sophira
**Baseline commit:** `516bf5e` (master, what production was serving when this round started)
**Result of this round:** Phase 0 report, the Phase 1 release-gate defect, and Phase 2
academic-context consistency - all verified and merged to `master`.

---

## 1. What this document is

Two things, kept together so they cannot drift apart:

1. **Phase 0: the current-state and safety report** the directive asks for before any
   implementation - what Sophira actually is today, what works, what is implemented but
   not configured, what is missing, what is unverified.
2. **The change record for the one fix shipped this round** (Phase 1, item 4: the
   migration release-gate discrepancy), in the change-management format of Part 16.

Everything below was measured on a fresh clone of `master`, not carried over from an
earlier audit. Where an earlier audit finding is confirmed, changed, or resolved, it says so.

---

## 2. What we are actually connected to

| | |
|---|---|
| Repository | `github.com/BridgeLine-Services/Sophira`, public, default branch **`master`** (there is no `main`) |
| Branch state at start | `master` = `516bf5e`, 0 open pull requests, only `master` on the remote |
| Production | `https://sophira.vercel.app/api/health` reported `commit: 516bf5e` - production exactly matched `master` |
| Live configuration as reported by `/api/health` | `supabase: true`, `supabase_service_role: true`, `ai: false`, `ai_selfhost: false`, `search: false` |
| Database | Live Supabase, verified read-only this round (see §5) |

**On "is the Base44 application synchronized with the repo?"** There is no separate Base44
build of Sophira. The application is this repository, deployed by Vercel from `master`;
the Base44 agent works on the same code through a clone. So "synchronized" means
`master` == production, which was true at the start of this round and is re-verified at
the end of every push.

---

## 3. Baseline, measured (not remembered)

All of the following ran on a fresh `npm ci` clone of `516bf5e`, before any edit.

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean, exit 0 |
| `npm test` | **7814 passed, 0 failed** (7891 after this round's additions) |
| `npm run lint` | 0 errors, 33 warnings (the configured ceiling) |
| `npm run build` | production build OK |
| `node scripts/design-drift.mjs` | 0 literal colour utilities, PASS |
| `node scripts/a11y-audit.mjs` | 0 findings across 180 files, PASS |
| `node scripts/contrast.mjs` | PASS, 32 pairs, both themes (worst: accent on accent-soft, light, 4.97:1) |
| `node scripts/page-conformance.mjs` | 80 routes, 0 without an h1, 0 without a landmark, 36 without an empty state |
| `node scripts/secret-scan.mjs` | CLEAN |
| `node scripts/release-gate.mjs --self-test` | PASS (41 checks registered) |

Inventory: **81 page routes, 100 API routes, 56 migrations, 56 registered migration markers,
100 test modules, 27 AI evaluation cases.**

The November 12 audit's numbers (80 routes, 7814 assertions) were accurate at that commit;
the route count is now 81 (`find src/app -name page.tsx`).

---

## 4. What Sophira is, feature by feature

### 4.1 Academic AI modes - present

`src/lib/ai/modes.ts` and `src/lib/ai/client.ts` define the seven modes the directive
names (learn, assignment, check, writing, study, explain, custom). Nothing here was
changed, and nothing here is a generic chatbot: each mode carries its own prompt
contract and its own route.

### 4.2 The personalization gap is real - confirmed

This is the highest-value finding of Phase 0, and it is unchanged from the audit:

| Route | What it actually retrieved (measured) |
|---|---|
| `src/app/api/ai/solve/route.ts` | The full engine: course, teacher profile, approved writing profile, structured learning patterns, scope-filtered memory, usage recording (25 references) |
| `src/app/api/tutor/route.ts` | **Nothing.** No memory, no patterns, no teacher rules, no writing profile. Only the course row and the student's explanation level. |
| `src/app/api/math/prepare/route.ts` | Subject memory only, and **only when no course was selected** (`if (!body.course_id) subjectPromptContext(...)`) - so choosing a course silently dropped the student's history |
| `src/app/api/writing/plan/route.ts` | Same as math/prepare: subject memory only when no course was selected; no teacher requirements, no approved writing profile, no patterns |

**Correction to an earlier statement in this file.** A first reading of these routes reported
"0 memory calls" for math/prepare and writing/plan. That was wrong: they reach memory
*indirectly*, through `subjectPromptContext()` -> `sharedMemoryContext()`
(`src/lib/courses/subject-context.ts`). The real defects are the two in the table above -
the tutor's total absence, and the `!course_id` condition that switches memory off exactly
when a course is selected. Both are fixed in Phase 2 (§9).

So the tutor, the math preparation step and the writing planner do not see the same
student context the solver does. That is exactly the inconsistency Part 4 asks to close
by **extending** the existing engine (`src/lib/memory/engine.ts`, `src/lib/ai/context.ts`)
rather than replacing it. **Not started this round** - see §7.

### 4.3 Flashcards - generated, not yet a study system

Flashcards exist, and it matters where:

- `notebook_artifacts` (migration 0022) stores `artifact_type = 'flashcards'` as JSONB with
  per-section `provenance`, under RLS policy `notebook_artifacts_own_all` (`user_id = auth.uid()`).
- Generation and reading happen through `src/lib/notebook/artifacts.ts` and
  `src/app/api/notebooks/[id]/artifacts/route.ts`.

What does **not** exist: decks, per-card review state, a review schedule, mastery or
difficulty tracking, resumable study sessions. Searches for `spaced repetition`, `SM-2`,
`review_schedule` return nothing in `src/` or `supabase/`.

So Part 6 is a genuine gap, and it must be built **on** `notebook_artifacts` (additive
migration, RLS from the start) rather than as a parallel flashcard store. **Not started
this round.**

### 4.4 Research, citation and readiness - present and intact

`src/lib/research/{provider,verify,claims,citation,authority,policy}.ts` and
`src/lib/readiness/finalGate.ts` are all present; the SSRF/policy boundary is covered by
its own tests (`tests/ssrf.ts`) and by a release-gate check. Untouched this round.

### 4.5 AI provider readiness messages - the audit was right, and it is now fixed

Eight routes answered an unconfigured AI with:

> "AI is not configured yet. An administrator needs to set the OPENAI_API_KEY environment variable."

That is wrong whichever provider the owner chose, and it names an environment variable to a
student. (An earlier note here said this was already fixed; that reading missed the
uppercase `OPENAI_API_KEY` string. Corrected.) Phase 2 replaces all eight with one shared,
provider-neutral message that states what happened, that the student's work is safe, and who
can fix it (`AI_NOT_CONFIGURED_MESSAGE` in `src/lib/ai/provider.ts`).

### 4.6 What is implemented but not operational (production truth, not code)

| Area | State | Consequence |
|---|---|---|
| AI provider | `ai: false`, `ai_selfhost: false` in `/api/health` | Tutor/assignment/study answer honestly "not available". No fabricated answers. |
| Search / research | `search: false` | Live web research unavailable; study features still work. |
| Email delivery | configured path, no confirmed live send this round | Invitation emails unverified end to end. |
| OAuth (Google/Microsoft) | not verified this round | Unchanged from audit. |
| Signed-in verification | **still blocked** | See §6. |
| Native apps (iOS/Android/desktop) | no build environment here | Unchanged; `glib` advisory still upstream-blocked and documented. |

### 4.7 Which audit findings remain valid

| Audit finding | Status now |
|---|---|
| Tutor lacks the solver's memory retrieval | **Valid** (§4.2) |
| No persistent flashcard / spaced-repetition system | **Valid** (§4.3) |
| Release gate probes stale migrations | **Fixed this round** (§5) |
| `docs/RELEASE_GATE.md` names an older chain (0030) | **Fixed this round** |
| OpenAI-specific readiness messages in 8 routes | **Fixed this round** (§4.5, §9) |
| AI and search unconfigured in production | **Valid** |
| No signed-in screen ever observed | **Valid** (§6) |
| Dark mode proven at token level only | **Valid** |
| Migrations 0052/0053 listed as outstanding on an owner checklist | **Resolved: both are live**, proven by probe this round (§5.2) |

---

## 5. The change shipped this round: migration release-gate accuracy

### 5.1 The defect, measured

`scripts/release-gate.mjs` hard-coded four probes in `dbMigrations()`:

```
typing_attempts.backspaces   (0035)
invitations.email_status     (0036)
notebooks.archived_at        (0037)
teachers.archived_at         (0038)
```

and on success reported:

> "newest migration markers (0035-0038) verified ... the strictly linear chain 0001-0038 is applied"

The chain is **56 migrations, ending at 0056**. Fourteen migrations (0039-0052 at the time
of writing, plus 0053-0056) could have been missing and the check would still have said
PASS with the words "newest" and "strictly linear chain". `docs/RELEASE_GATE.md` was even
further behind: it documented a 0030 `subject_preferences` probe and a "0001-0030 chain".

Three existing tests pinned this stale behaviour as if it were correct
(`tests/course-engine.ts`, `tests/document-selection.ts`, `tests/provider-integrations.ts`
all asserted the string `0001-0038`), which is how it survived: the test suite was
guarding the bug.

### 5.2 The fix

New `scripts/migration-probes.mjs`:

- `parseMarker(sql)` turns a marker's SQL into a REST-verifiable probe:
  `to_regclass('public.x')` → table probe, `information_schema.columns` → column probe,
  `pg_proc.proname = 'f'` → function probe (checked against PostgREST's OpenAPI document,
  **never called**, so nothing executes and a permission gate is not mistaken for a missing
  migration). Constraints and grants are reported as catalog-only, not guessed at.
- `buildProbePlan({markers, migrationFiles, sample = 12})` derives the probe set from
  `scripts/migration-markers.mjs` - **the same single source of truth CI
  (`apply-migrations.mjs`) and the first-launch wizard already use** - and takes the newest
  12 migrations. The newest migration **must** be provable: if it is not, the plan returns
  an error and the gate reports BLOCKED, never PASS.
- `runMigrationProbes({baseUrl, apiKey, plan, fetchImpl})` executes the plan and returns
  PASS / FAIL / BLOCKED with a detail string that names the window it actually verified
  (e.g. `0045-0056`, 10 of 10 probes) instead of claiming the whole chain.

`scripts/release-gate.mjs` now calls those functions; the hand-written list is gone. The
gate still registers exactly 41 checks and still emits exactly one GO/BLOCKED state.

**Honest limit, stated in the code and the docs:** this proves the sampled window
(the newest 12) exists in the live schema. A gap older than that window is not visible
through the REST API, so the PASS wording says "window 0045-0056", not "the whole chain".

### 5.3 Change record (Part 16 format)

| | |
|---|---|
| Change | Migration release-gate: derived probe plan |
| Phase | 1 (production configuration and migration verification) |
| Reason | The check could certify a database missing 14+ migrations |
| Existing behaviour preserved | Check id `db-migrations`, the 41-check registry, GO/BLOCKED output, service-role REST access, BLOCKED when credentials are absent |
| Files modified | `scripts/release-gate.mjs`, `docs/RELEASE_GATE.md`, `tests/course-engine.ts`, `tests/document-selection.ts`, `tests/provider-integrations.ts`, `tests/run.ts` |
| Files added | `scripts/migration-probes.mjs`, `tests/migration-release-gate.ts`, this document |
| Database changes | none |
| API contract changes | none |
| New dependencies | none |
| Environment variables | none |
| Regression risk | Low: the gate is a report, not a runtime path. The three modified assertions encoded the stale behaviour and were rewritten to assert the derived plan; the reason is recorded in each assertion message. |
| Rollback | `git revert` the merge commit; no data or schema state is involved |

### 5.4 Verification

| Check | Result |
|---|---|
| Live production probe (read-only, service role) | **PASS** - window `0045-0056`, 10 of 10 probes verified, newest `0056` proven |
| Live window detail | `provider_usage.latency_ms` (0052) present, `record_admin_event()` (0053) present, `qa_reports` (0054), `announcements` (0055), `network_activity_daily()` (0056) present |
| Module self-test (`--self-test`) | **15 passed, 0 failed** - current DB passes; old DB fails; missing newest fails and is named; partial tail fails and names `/setup` repair; no credentials BLOCK; unprovable newest BLOCKS; empty directory reported |
| `npm test` | **7833 passed, 0 failed** (+19 versus the 7814 baseline) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 33 warnings (unchanged ceiling) |
| `npm run build` | OK |
| design-drift / a11y / contrast / conformance / secret scan | PASS / PASS 180 files / PASS 32 pairs both themes / 80 routes / CLEAN |

**This also settles an open owner question:** migrations 0052 and 0053, which an owner
checklist still listed as outstanding, are **applied in the live database**. No database
action is needed for them.

---

## 6. What remains unverified, and why

1. **No signed-in screen has been observed.** There is still no usable test member: the
   stored `SOPHIRA_TEST_MEMBER_*` values do not authenticate, and the live network holds
   two real accounts. Invitation-only access is a standing owner rule, so no account was
   created. Every member-side claim in this document is code- and schema-level, not
   rendered-screen-level.
2. **Dark mode** is proven at the token level (the contrast gate covers both palettes),
   not on a rendered page - it is behind sign-in.
3. **One viewport has been inspected** in earlier rounds (1280px). Tablet and phone
   layouts are asserted in CSS and source, not seen.
4. **AI and search are unconfigured in production**, so no live model answer or live web
   search was produced; the honest "not available" paths are tested.
5. **Native apps** were not built (no Rust/GTK, iOS or Android toolchain here).

To close (1)-(3): one test member's email and password, or approval to create a member
account on the live network. That single input converts most of the member-side
"not live-verified" items into verified ones.

---

## 7. Safest implementation order for what is left

Each step is additive, backs onto existing structures, and is independently testable.

| Step | Work | Risk | Why in this order |
|---|---|---|---|
| 1 | Shared academic-context service; wire it into tutor, math prepare and writing plan (Part 4) | Medium - touches AI prompts | Closes the biggest consistency gap with no schema change; extends, never replaces |
| 2 | Expand AI evaluations to the 15 categories with honest skipped/blocked reporting (Part 7) | Low | Gives step 1 a measuring stick before more AI paths change |
| 3 | Persistent decks + spaced repetition on `notebook_artifacts` + one additive migration with RLS (Part 6) | Medium - first new schema in this round | Needs owner approval for a live migration; offline-provable first |
| 4 | Writing-profile variants and the style-following control (Part 5) | Low | Extends an approved-proposal workflow that already exists |
| 5 | Integration readiness in plain language in the Owner Dashboard (Part 13) | Low | Pure presentation over states the code already knows |
| 6 | Full regression + signed-in acceptance (Part 15 Phase 5) | - | Blocked on §6 until a test member exists |

**Not started this round:** steps 1-6. This round deliberately stopped after a defect that
could produce a false "database is ready" verdict, because shipping that is worth more than
half-finishing a feature.

---

## 9. Phase 2: academic AI consistency (shipped this round)

### 9.1 What changed

New `src/lib/ai/academic-context.ts` - one service that assembles the academic context for an
AI request from the **same** tables and **same** pure selectors the solver already uses:

- the course row and its instructions (800-char bound),
- this course's teacher requirements from `teacher_profiles` (bounded, and labelled as
  overriding the student's own habits),
- the **approved** writing profile - writing tasks only,
- structured learning patterns, scope-filtered and capped at 5,
- long-term memory, scope-filtered and capped at `MAX_PROMPT_MEMORIES` (8),
- an ORDER OF AUTHORITY line first, so precedence is never ambiguous,
- a hard 4000-character budget; whole sections drop rather than rules being clipped.

It records `last_used_at` for the memories it actually used (like the solver), never throws,
and reports an unavailable source in `degraded` instead of inventing context.

Wired into three paths: `POST /api/tutor` (which previously saw nothing),
`POST /api/math/prepare` and `POST /api/writing/plan` (which previously lost memory when a
course was selected). **The main solver was deliberately not touched** - it already has the
full engine, and changing it is the highest-regression-risk edit in the codebase.

Part 8.1 also landed: one shared provider-readiness message across the eight routes that
previously named `OPENAI_API_KEY` to students.

### 9.2 Change record

| | |
|---|---|
| Change | Shared academic context service + shared provider-readiness message |
| Phase | 2 (academic AI consistency) |
| Reason | The same student got personalised help from the solver and generic help from the tutor; subject engines discarded memory when a course was selected; unconfigured-AI copy named a vendor variable |
| Existing behaviour preserved | Solver untouched; every route keeps its response shape, its `AiNotConfiguredError` handling, its status codes (503/422/500) and its plain-language error style; scope isolation and RLS untouched |
| Files added | `src/lib/ai/academic-context.ts`, `tests/academic-context.ts` |
| Files modified | `src/app/api/tutor/route.ts`, `src/app/api/math/prepare/route.ts`, `src/app/api/writing/plan/route.ts`, `src/lib/ai/provider.ts`, the other five routes that named `OPENAI_API_KEY`, `tests/run.ts`, this document |
| Database changes | none - it reads existing tables under existing RLS |
| API contract changes | none (request bodies gained optional `subject`/`teacher_id`/`assignment_id` on the tutor, which ignores unknown fields; every existing field behaves identically) |
| New dependencies | none |
| Environment variables | none |
| Authorization impact | none: every read is filtered by the signed-in user's id, on top of RLS |
| Regression risk | Medium: prompts changed on three AI paths. Mitigated by 58 new assertions, an unchanged solver, and bounded context |
| Rollback | revert the merge; no state, schema or data involved |

### 9.3 Verification for Phase 2

58 new assertions (7891 total, 0 failed) covering: the authority line is always first;
course and teacher rules are included with precedence stated; memory scoped to another
course/teacher/assignment is excluded; at most 8 memories and 5 patterns enter the prompt;
the character cap holds; a draft writing profile never applies and the writing profile
never enters a non-writing answer; a failed read degrades with an honest note and invents
nothing; every read carries the signed-in user id; and the routes are actually wired
(the `!course_id` condition is gone).

Gates after the change: `tsc` clean, 7891/7891 tests, lint 0 errors / 33 warnings,
production build OK, design-drift 0, a11y PASS, contrast PASS both themes, conformance 80
routes, secret scan CLEAN.

**Not verified:** none of these prompts was sent to a live model - production has no AI
provider configured, so the change is verified by construction and by test, not by reading
a model's answer. That remains the honest limit on all AI-path work.

### 9.4 What is NOT done from Phase 2

- The solver was not refactored onto the new service. It works, and merging two working
  implementations during an unverified round would risk the most-used path for tidiness.
- Expanded AI evaluations (Part 7's 15 categories) are unchanged at 27 cases.
- Teacher-requirements awareness reached the tutor, math preparation and writing planning;
  `/api/math/practice` and `/api/writing/grammar` still use subject context only.

---

## 8. Bottom line

- Existing functionality: untouched. Every gate is at or above its baseline; the suite grew
  by 19 assertions and nothing was deleted or weakened except three assertions that were
  guarding the stale migration list, each rewritten with its reason recorded.
- One real defect closed: the release gate now verifies the chain end it claims to verify,
  and can no longer answer PASS for a database missing the newest migrations.
- Live database state is now *proven*, not inferred: window 0045-0056 applied.
- The biggest product gap is unchanged and clearly identified: the tutor does not yet see
  the student context the solver sees.

---

## 10. Phase 3: flashcards as a study system (shipped this round)

### 10.1 The gap, measured

Flashcards already existed as a *generated* artifact: `notebook_artifacts` with
`artifact_type = 'flashcards'` holding a question and an answer per section in JSONB, with
provenance, under RLS. What did not exist anywhere in the codebase or the schema: decks, per-card
review state, a review schedule, mastery tracking, or a queue ("spaced repetition", "SM-2",
"review_schedule" returned nothing). A student could generate cards and had no way to study them.

### 10.2 What now exists

| Piece | File | What it does |
|---|---|---|
| Schema (migration 0057) | `supabase/migrations/0057_flashcard_decks.sql` | `flashcard_decks`, `flashcards` (current interval/ease/reps/lapses/due), `flashcard_reviews` (append-only log). RLS owner-only on all three; the log has insert+read policies and no update/delete policy |
| Scheduler | `src/lib/flashcards/schedule.ts` | Pure SM-2 style: `again` returns in 10 minutes, resets repetitions, counts a lapse, drops ease; ease clamped 1.3-2.8; interval capped at 365 days; `elapsedDays` is null on a first review, never negative |
| Deck assembly | `src/lib/flashcards/decks.ts` | Turns a generated artifact into cards, stripping `Q:`/`A:` prefixes, keeping citations, and **reporting** any section that cannot become a card instead of inventing one |
| Reading | `GET /api/flashcards/decks`, `GET /api/flashcards/decks/[id]`, `GET /api/flashcards/due` | Decks with honest counts, one deck with its cards, and the due queue built from the server clock |
| Writing | `POST /api/flashcards/decks`, `PATCH`/`DELETE /api/flashcards/decks/[id]`, `POST /api/flashcards/review` | Create from an artifact or hand-written cards, rename, remove, and answer one card |

The client never sends an interval, an ease or a due date: the server schedules from a
validated rating, so progress cannot be inflated from the browser.

### 10.3 Change record

| | |
|---|---|
| Change | Flashcards became a study system (decks, review state, schedule, history) |
| Phase | 3 |
| Reason | Generated cards had nowhere to be studied; Part 6 asks for persistent decks and spaced repetition |
| Existing behaviour preserved | `notebook_artifacts` and the generation path are untouched; a deck may reference the artifact it came from. No existing table altered, no existing policy changed |
| Files added | the migration, `src/lib/flashcards/schedule.ts`, `src/lib/flashcards/decks.ts`, four route files, `tests/flashcards.ts` |
| Files modified | `scripts/migration-markers.mjs` (0057 probe), `src/app/api/account/export/route.ts` (three tables added to the member export), `docs/BACKUP_INVENTORY.md`, `docs/REDESIGN_INVENTORY.md`, `tests/membership-notifications.ts` (migration count), `tests/run.ts`, the generated `bootstrap-all.sql` and `db-migrations.generated.ts`, this document |
| Database changes | ADDITIVE migration 0057: three new tables, three indexes, RLS, triggers. Nothing dropped, nothing altered |
| API contract changes | new routes only |
| New dependencies | none |
| Rollback | revert the merge; the tables can stay harmlessly, or `drop table` them in a later migration |
| **Owner action required** | **the live database does not have 0057 yet.** Until the owner presses Update database in the Owner Dashboard, the release gate correctly reports FAIL naming `flashcard_decks (0057_flashcard_decks.sql)` and the study screens have nothing to read. This is the honest state, not a broken deploy |

### 10.4 Verification

| Check | Result |
|---|---|
| `npm test` | **7974 passed, 0 failed** (+83 versus 7891) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 33 warnings (ceiling unchanged) |
| `npm run build` | OK |
| design-drift / a11y / contrast / conformance / secret scan | PASS / PASS / PASS 32 pairs both themes / 80 routes / CLEAN |
| `node scripts/gen-bootstrap-sql.mjs` | 57 migrations, idempotent |
| `node scripts/gen-db-migrations.mjs` | 57 migrations embedded, markers on 57 |
| Live migration probe (read-only, service role) | **FAIL, correctly**: "live schema is missing migration markers in the 0046-0057 window: flashcard_decks (0057_flashcard_decks.sql) - run the /setup repair to apply the missing tail" |

That last line is the Phase 1 gate doing its job: it names exactly the migration that is not
applied instead of claiming the database is ready.

### 10.5 What Phase 3 still lacks

- **No screens.** There is no deck list, study card or review UI yet. The API and the data model
  are complete and tested; a screen must be built against the existing design system and cannot
  be verified in a signed-in browser (see §6), which is why it was not rushed in this round.
- **No automatic deck creation from the notebook page.** The API accepts an `artifact_id`; a
  "Study these cards" button in the notebook UI is still to be added.
- No card editing (add/remove a single card) or manual retirement UI, though the schema and the
  scheduler already support retired cards.

---

## 11. Directive status: all 18 parts

The full directive text is now on file, so every part can be titled and statused. Nothing here
is claimed as verified that was not actually run.

| Part | Subject | State |
|---|---|---|
| 1 | Non-negotiable safety requirements | **Honoured every round**: no rebuild, no removed route, no schema rewrite, no weakened RLS, no removed test, gates before every push. Destructive operations listed in 1.6 were never performed |
| 2 | Understand what Sophira already is (three systems: A academic teacher, B work assistant, C personalised companion) | **Verified and mapped** in §2 and §4: the repository IS the deployed application (§2.1), all three systems exist, and the gaps against A/B/C are named |
| 3 | Preserve and extend the seven existing AI modes (Learn, Assignment, Check, Writing, Study, Explain, Custom) | **Preserved**: no mode was replaced or removed. Study mode gained real persistence (§10); the assignment solver and writing generator still generate, and the plan route does not restrict them |
| 4 | Unify personalisation and academic memory | **Done** (§9) for tutor, math preparation and writing planning. Not yet: solver refactor onto the shared service, plus `/api/math/practice` and `/api/writing/grammar` |
| 5 | Writing personalisation: context-specific profiles, style-following control, approval intact | **Not started**. The approved-profile gate is preserved and now enforced on the AI paths (§9); separate academic/casual/professional profiles and a closeness control do not exist |
| 6 | Complete the flashcard and spaced-repetition system | **Engine, data and API done** (§10, §10.6): decks, cards, edit/delete/retire, add-a-card, due queue, review, scheduling, progress, difficult cards, subject/course organisation. **Missing: the student screens** |
| 7 | Stronger academic AI evaluation system (15 categories, synthetic cases, honest reporting) | **Not started**: still 27 cases, and the runner still reports blocked rather than passed when no provider is configured |
| 8 | Fix and verify AI provider configuration, standardise readiness | **8.1 done** (§9.1): one shared provider-neutral message, no secret names, eight routes. 8.2 (failure behaviour) was already correct and was preserved |
| 9 | Research and citation reliability, submission readiness | **Preserved, not extended**: URL safety, authority, claims, citations and the READY/NOT READY gate are untouched and their tests still pass. No research-provider work was done because production has no search provider configured |
| 10 | Correct the database migration release-gate discrepancy | **Done** (§5): the gate derives probes from the real marker table, the newest migration is mandatory, a partial chain is FAIL, an unprovable chain is BLOCKED, docs updated, 19 tests |
| 11 | Security and privacy must remain intact | **Enforced in every change**: RLS owner-only on the three new tables, append-only review log, every route filters on the signed-in user, no button-hiding relied on, no new public endpoint. Live cross-student verification is **still not possible** (no test member) |
| 12 | Make Sophira easy for non-technical users | **Applied to everything built**: plain-language readiness messages that say the work is safe, review answers labelled "Not yet / Partially / Correct / Confident", no scheduler term in any student-facing string (pinned by a test), plain sentences for progress. The wider audit of existing screens is **not done** |
| 13 | Owner Dashboard and external integrations, honest states | **Not started**. The Owner Dashboard exists and was not changed this round |
| 14 | Automated testing and regression protection | **Continuous**: suite 7974 to 8007 with no test deleted or weakened; two existing tests were updated only after the intended behaviour changed (migration count 56 to 57, API count 101 to 108, inventory updated) and the reason is recorded in the commit |
| 15 | Required implementation order | Phases 0, 1, 2 and 3 (engine) complete. Phase 3 screens outstanding. Phases 4 and 5 **blocked** as described below |
| 16 | Exact change management record | **Done**: §5.3, §9.2, §10.3, §10.7 for every change |
| 17 | Definition of done | **Not met, and cannot be met yet**: it requires a configured AI provider, a configured research provider, live integrations, backup/restore verification and authenticated workflow testing. §12 lists exactly what stands between here and that |
| 18 | How to begin (inspect first, report, wait for approval before high-risk work) | **Done**: §2 and §5 are the inspection report; no destructive or high-risk operation was performed; every change so far is additive |

### 11.1 The three things that block Parts 5, 13, 15(Phases 4-5), 17

1. **No signed-in verification.** There is no usable test member, and invitation-only access is a
   standing owner rule. Every member-side claim in this document is code-, schema- and test-level.
2. **No AI provider in production.** `configuration.ai` is `false`, so no prompt change can be
   checked against a real model answer and Part 7's live categories cannot pass.
3. **No research provider, no OAuth connectors, no backup credentials** in the environment,
   which is what Parts 9, 13 and 17 need before they can be called operational.

---

## 12. What stands between here and Part 17 (definition of done)

| Requirement | Today |
|---|---|
| Existing pages, APIs, workflows, auth, permissions still work | True by construction and by test; the suite has never gone red on `master` |
| Tutoring, assignment generation, writing generation work with a configured provider | **Unverified**: no provider configured |
| Personalisation applied consistently | Done for three AI paths (§9); not for every path |
| Persistent flashcards and spaced repetition work | Engine and API done; **no screens** |
| Search configured and tested, citations verifiable | **Not configured** |
| Student data isolated, roles correct, admin access protected, secrets unexposed | Enforced and tested offline; **not live-verified** |
| Required migrations verified | Gate now correct and honest; **live database is missing 0057 until the owner presses Update database** |
| Backup and restore verified | Not run in this environment |
| Production acceptance checks completed | Partly: health, gates, conformance, a11y, contrast, probes. Not: signed-in flows |

---

## 10.6 Phase 3, second slice: card management and progress (shipped this round)

| Piece | File | What it does |
|---|---|---|
| Edit / retire / delete a card | `src/app/api/flashcards/cards/[id]/route.ts` | Both sides stay required; an edit **cannot** touch interval, ease or due date, so fixing a typo never resets progress; retire keeps history, delete removes it |
| Add a card to a deck | `src/app/api/flashcards/decks/[id]/cards/route.ts` | Deck ownership verified first; the card arrives due now |
| Organisation by subject/course | `src/app/api/flashcards/decks/route.ts` | `GET ?course_id=` narrows the list |
| Progress in plain language | `src/lib/flashcards/progress.ts` + `GET /api/flashcards/progress` | Accuracy from the append-only log **with the number it came from**, null when there are no reviews, per-day counts, difficult cards (2+ lapses), and one plain sentence. No scheduler term reaches a student |

### 10.7 Change record

| | |
|---|---|
| Change | Flashcards: full card management, course organisation and honest progress reporting |
| Phase | 3 (second slice) |
| Reason | Part 6 requires editing and deleting cards, organising decks by subject and course, tracking progress and identifying difficult cards |
| Existing behaviour preserved | No schema change (0057 already carries every column). No route or response removed. The review scheduler and its bounds are untouched |
| Files added | `src/lib/flashcards/progress.ts`, `src/app/api/flashcards/cards/[id]/route.ts`, `src/app/api/flashcards/decks/[id]/cards/route.ts`, `src/app/api/flashcards/progress/route.ts` |
| Files modified | `src/app/api/flashcards/decks/route.ts` (course filter), `tests/flashcards.ts` (+33 assertions), `tests/run.ts`, `docs/REDESIGN_INVENTORY.md` (API count) |
| Database changes | none |
| API contract changes | new routes only; the deck list gained an optional query parameter |
| Authorization impact | none: every new route filters on the signed-in user, and another student's card or deck is a 404 |
| Verification | suite **8007/8007**, tsc clean, lint 0 errors / 33 warnings, build OK, design-drift 0, a11y PASS, contrast PASS 32 pairs both themes, conformance 80 routes, secret scan CLEAN |
| Outstanding | the student screens. Nothing in this slice is user-visible yet |

**Parts 2, 3, 9, 10, 11, 12, 14, 17 and 18 are no longer "unknown":** the full directive is now on
file and every part is statused in §11.

---

## 10.8 Phase 3, third slice: the study screens (shipped this round)

The engine shipped in #85 and the card tools in #86 with nothing a student could open. That was
the largest remaining gap in Phase 3 and it is now closed at the screen level.

| Screen | File | What a student does |
|---|---|---|
| Your decks | `src/app/flashcards/page.tsx` | Sees each deck with cards / learned / new and how many are due, opens one, or makes a deck by hand (name + first card). An empty account is told to generate flashcards in a notebook |
| Study one deck | `src/app/flashcards/[id]/page.tsx` | Opens the deck and starts: question, "Show the answer", then four plain answers (Not yet / Partially / Correct / Confident), each explained. A finished session says how many cards were answered. Below it, every card can be edited, retired (history kept) or removed, and removal asks first |
| Loading states | `src/app/flashcards/loading.tsx`, `src/app/flashcards/[id]/loading.tsx` | Words in the existing convention, never a fake skeleton |
| Navigation | `src/lib/navigation/workspace-nav.ts` | Flashcards sits directly after Notebooks, because a deck is made from a notebook |

### Why the screens are safe to have shipped

- **The browser cannot invent progress.** Each answer posts `{ card_id, rating }`; the server
  schedules. The screen reads a card's due date only to order the queue, and a test refuses any
  scheduling value in what it sends.
- **The queue is not a second implementation.** `buildQueue()` (already unit-tested) decides what
  comes first, so the screen and the tests cannot disagree about what "due" means.
- **No technical vocabulary.** A test strips comments and fails if any of "SM-2", "interval_days",
  "ease factor", "PATCH", "supabase", "RLS" or "API route" appears on a student screen (Part 12).
- **Honest failure states.** A failed read says the work is safe and offers Try again; a failed
  save says nothing changed; an edit tells the student their review schedule was left alone.
- **Accessibility of the new controls.** Every input has a real label, the card list is a labelled
  region, no icon-only button exists, and results are announced through `role="status"`. The
  repository-wide a11y and contrast gates still pass.

### 10.9 Change record

| | |
|---|---|
| Change | Flashcards: deck list, study flow and card tools as real screens |
| Phase | 3 (third slice) |
| Reason | Part 6 requires a student interface: "open a deck and begin reviewing without understanding any technical settings", on phone, tablet and desktop |
| Existing behaviour preserved | No existing page, route or component changed except one ADDED entry in the shared workspace menu. Every screen still renders the shared shell and the existing design vocabulary |
| Files added | `src/app/flashcards/page.tsx`, `src/app/flashcards/[id]/page.tsx`, two `loading.tsx` files |
| Files modified | `src/lib/navigation/workspace-nav.ts` (one entry), `docs/redesign-status.json` (two routes), `docs/REDESIGN_INVENTORY.md` (regenerated: 82 pages), `tests/flashcards.ts` (+31 assertions), `tests/run.ts`, `tests/role-navigation.ts` (the order pin now includes Flashcards after Notebooks, with the reason recorded) |
| Database changes | none |
| API contract changes | none (the screens consume the routes added in #85 and #86) |
| Verification | suite **8044/8044**, tsc clean, lint 0 errors / 33 warnings, build OK, design-drift 0, a11y PASS, contrast PASS 32 pairs both themes, conformance **82 routes**, secret scan CLEAN |
| **Still not verified** | **the rendered screens in a browser.** No usable test member exists and invitation-only access is a standing rule, so these two routes are marked `partial` in the inventory, exactly like the other 76 screens |
| Remaining Phase 3 item | **closed in #88**: the notebook flashcard set now opens as a deck (§10.11) |

### 10.10 Part 6 status after this round

| Part 6 requirement | State |
|---|---|
| Generate flashcards from study material | Already existed (notebook artifacts), unchanged |
| Create decks manually | Done (#86 API, screens this round) |
| Edit flashcards | Done |
| Delete cards they own | Done |
| Organise decks by subject and course | Deck has `course_id` + notebook link, list filters by course; a course picker inside the deck screen is not built yet |
| Save decks / review cards / schedule future reviews | Done |
| Mark answers correct / partially understood / incorrect | Done, in plain words: Correct / Partially / Not yet (plus Confident) |
| Track progress | Done: counts, accuracy with its sample size, difficult cards |
| Identify difficult cards | Done (2+ lapses, surfaced on the card) |
| Resume unfinished study sessions | Partial: the queue is rebuilt from what is due on each visit, so nothing is lost, but there is no saved mid-session position |
| A generated set opens as a deck | Done (#88): "Study these cards" on the notebook artifact, idempotent by source |
| Spaced repetition responding to recall | Done (deterministic SM-2 style, clamped, tested) |
| Phone / tablet / desktop | Layouts use the existing responsive grid; **not verified on a device** |
| Privacy: decks and history scoped to the student | Done at the database (RLS) and in every route |

---

## 10.11 Phase 3, fourth slice: "Study these cards" (closed Phase 3)

The last link: a generated flashcard set in a notebook could not be opened as a deck, so a student
who had just made cards had nowhere to study them.

| Piece | File | What it does |
|---|---|---|
| The button | `src/app/notebooks/[id]/page.tsx` | On a flashcard set only: sends the artifact id, then opens the study screen. A failure says the notebook is unchanged |
| Idempotent deck creation | `src/app/api/flashcards/decks/route.ts` | A deck already built from that artifact is returned (the OLDEST, owner-scoped) instead of a duplicate, so a double press cannot strand a student's review history |

### 10.12 Change record

| | |
|---|---|
| Change | Flashcards: a generated notebook set opens as a study deck, once |
| Phase | 3 (fourth slice, closes Phase 3) |
| Reason | Part 6: cards generated from study material must be studiable |
| Existing behaviour preserved | The notebook page keeps every existing tool; the button is added beside Export and renders only for `artifact_type === "flashcards"`. The deck POST keeps its previous behaviour for every other request; only the artifact path gained the reuse check |
| Files modified | `src/app/notebooks/[id]/page.tsx` (one component, one insertion), `src/app/api/flashcards/decks/route.ts` (reuse check), `tests/flashcards.ts` (+11 assertions), `tests/run.ts`, this document |
| Database changes | none |
| API contract changes | none: an existing deck now returns 200 with `existing: true` where a duplicate would previously have been created. No client depended on the duplicate |
| Regression risk | the notebook page has its own passing tests; the change is additive and the suite is green |
| Verification | suite **8055/8055**, tsc clean, lint 0 errors / 33 warnings, build OK, design-drift 0, a11y PASS, contrast PASS both themes, conformance 82 routes, secret scan CLEAN |
| Outstanding | the rendered screens are still unseen in a browser (no usable test member) |

**Phase 3 is now complete at the code level.** Everything Part 6 lists as required behaviour exists
and is covered by tests; the one thing no amount of code can supply is a signed-in browser pass.

---

## 10.13 Phase 4, first code slice: the owner can see what is on

The readiness report could not state three capabilities, because nothing exposed them. That gap is
closed, and it was the Phase 4 code item I stopped in front of last round.

| Piece | File | What changed |
|---|---|---|
| One source of truth | `src/lib/integrations/setup-status.ts` | `providerSetupStatus()` now also answers for invitation email and SMS, using the delivery functions the invitations themselves call |
| Public readiness | `src/app/api/health/route.ts` | Reports `google_documents`, `microsoft_documents`, `invitation_email`, `sms` - booleans only, from that same function |
| Owner-facing words | `src/lib/owner-status.ts`, `src/app/owner/status/page.tsx` | A new "Invitation email" row in plain language. Off reads "Invitations still work: copy the invitation link and send it yourself" and never makes a healthy system look broken. An unknown fact is omitted, never shown as off |

### 10.14 Change record

| | |
|---|---|
| Change | Integration readiness is observable: health flags plus a plain-language owner row |
| Phase | 4 (first code slice) |
| Reason | Part 13: the Owner Dashboard must distinguish implemented / configured / operational / tested / blocked, and the readiness report had three rows it could only call unknown |
| Existing behaviour preserved | `buildStatusRows` keeps its five existing rows and their order; the new field is optional, and without it the output is byte-identical. `/api/health` keeps every existing key. No route, no schema, no permission changed |
| Files modified | `src/lib/integrations/setup-status.ts`, `src/lib/owner-status.ts`, `src/app/api/health/route.ts`, `src/app/owner/status/page.tsx`, `tests/integration-readiness.ts` (new, 25 assertions), `tests/run.ts`, `docs/INTEGRATION_READINESS_2026-11-13.md` (unknown rows replaced with the live probe) |
| Database changes | none |
| API contract changes | additive only: four new boolean keys on `/api/health` |
| Security impact | none widened: booleans only, no value, variable name or hostname in any response or screen, and the status page stays owner-guarded |
| Verification | suite **8080/8080**, tsc clean, lint 0 errors / 33 warnings, build OK, design-drift 0, a11y PASS, contrast PASS both themes, conformance 82 routes, secret scan CLEAN, env validation PASS |
| Outstanding | none for this slice. The next Phase 4 item is the same list of owner decisions the report names: an AI provider, a search provider, a test member, device access, backup credentials and migration 0057 |
