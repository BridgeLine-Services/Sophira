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
