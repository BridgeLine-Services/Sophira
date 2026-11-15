# Phase 0 — baseline and preservation audit (2026-11-15)

Directive: *Sophira product realignment, autonomous academic AI expansion, and zero-regression preservation*.
This document is the Phase 0 deliverable. **No application code was changed before it was written.**

## 1. Starting point

| Fact | Value |
| --- | --- |
| Baseline commit | `92d91a0eb1b35d86a9c1c17c28b88a336fac1b9e` (`92d91a0`) |
| Branch | `master` (the repository has no `main`; `origin/HEAD -> origin/master`) |
| Commits since the directive's named baseline | none — `92d91a0` **is** the inspected baseline |
| Working tree at audit start | clean (`git reset --hard origin/master`, `git clean -fd`) |

A stale local checkout was sitting on `7b791a0` with two edited files and two untracked
probe files (`package.json`, `src/proxy.ts` adding `/__probe_crash`, `scripts/route-render-gate.mjs`,
`src/app/__probe_crash/`). Those were leftover crash probes from an earlier session, not
product work; they were discarded so the audit below is measured against the real baseline.

## 2. Repository inventory at baseline

| Measure | Count |
| --- | --- |
| Page routes (`src/app/**/page.tsx`) | 82 |
| API routes (`src/app/api/**/route.ts`) | 111 |
| Migrations (`supabase/migrations/*.sql`) | 58 (0001 – 0058) |
| Tables created and never dropped | 65 |
| Private storage buckets | 1 (`private-docs`) |
| Test files (`tests/*.ts`) | 124 |
| Assertions executed | 9017 |

## 3. Baseline verification results (recorded BEFORE any change)

| Gate | Result |
| --- | --- |
| `npm test` | **9017 passed, 0 failed** (`EXIT=0`) |
| `npx tsc --noEmit` | clean (`TSC_EXIT=0`) |
| `npm run lint` | 0 errors, 33 warnings — exactly the allowed ceiling (`LINT_EXIT=0`) |
| `npm run build` | success (`BUILD_EXIT=0`) |

There were **no pre-existing test failures**. Any failure introduced later is therefore
attributable to the new work, and none can be excused as "already broken".

## 4. Functional inventory of the areas the directive names

### 4.1 AI and academic context
- `src/lib/ai/academic-context.ts` (306 lines) — the single shared context service:
  course + its teacher's requirements, approved writing profile chosen **by writing context**,
  closeness dial, structured learning patterns (adaptive selection), and scope-filtered
  long-term memory. Precedence is stated in the prompt: assignment > teacher > course >
  approved student preference. Every read is filtered by the signed-in user id; RLS is the
  authority behind it. A failed read is skipped and reported in `degraded`, never invented.
- Callers today: `/api/tutor`, `/api/math/prepare`, `/api/writing/plan` (the solver is
  deliberately still on its own equivalent code).
- `provider.ts` holds the honest `AI_NOT_CONFIGURED_MESSAGE` / `AI_UNAVAILABLE_MESSAGE`.

### 4.2 Essay-generation infrastructure
- `src/lib/essay/pipeline.ts` — the fixed 13 stages and the **structural** outline gate
  (`canDraft` refuses until `outlineApproved`; `nextSectionToDraft` returns one section).
- `POST /api/essay/plan` — analysis, rubric, teacher requirements, research sources,
  evidence map, thesis, outline; deadline feasibility decided immediately; persists
  `essay_sessions` with `status='awaiting_outline_approval'`.
- `POST /api/essay/draft-section` — exactly one section per call, per-section audits,
  final verification after the last section.
- `PATCH /api/essay/draft-section` — outline approval, revision-aware (`x-sophira-base-version`).
- `GET /api/essay/plan?session_id=` — session restore.
- `src/lib/essay/{schedule,pacing}.ts` — deadline feasibility and paced reveal (a local timer
  over already-generated text, not generation).

### 4.3 Writing personalisation
- `writing-profile-learning.ts` — deterministic analyser over the member's **own** samples,
  17 observable dimensions, scope grows only with evidence (1 sample `temporary`, 2+ `course`,
  5+ `global`), confidence from sample count and effect size, no network, no model.
- `style-suggestions.ts` → `profile_update_proposals` (pending), `writing-profiles.ts`
  (approved profile + `profile_context` + `style_closeness`), `writing-contexts.ts`.
- Approval and version history: `ProposalsPanel.tsx`, `ProfileVersionHistory.tsx`,
  `profile_versions`.

### 4.4 Document integrations
- `gradual-insert.ts` — chunked insertion with provider-confirmed progress, pause, resume,
  stop, cancel, conflict detection, failure; pure, no timers.
- `history.ts` / `history-labels.ts` — genuine Google/Microsoft revision history, labelled
  by what actually established each entry; no authorship claim.
- `google.ts`, `microsoft.ts`, `connections.ts`, `artifact-loader.ts`, `files.ts`.
- Routes: `/api/integrations/google/doc-update/*`, `/api/integrations/document-history`.

### 4.5 Dashboards and permissions
- `src/lib/roles.ts` — four roles (`user`, `tester`, `co_owner`, `owner`), rank, labels.
- `src/lib/auth/permissions.ts` — the single server-side decision matrix, mirrored in the
  database (migration 0048) so a crafted request cannot outvote the server.
- Owner: `OwnerDashboard.tsx`, `OwnerAreaGrid.tsx`, `feature-catalog.ts` (six honest feature
  states, `lastVerified` / `verifiedByTests` / `lastFailure`), `release-readiness.ts`
  (never counts a blocked check as passed; no report means UNKNOWN), `preservation-census.ts`.
- Co-Owner, Tester (`QaReportForm.tsx`), and Student dashboards all render from
  `src/lib/dashboard/{overview,activity}.ts`.

### 4.6 Existing feature flags
**There are none.** `grep` for `feature_flag|FEATURE_FLAGS|featureFlags` across `src/` returns
nothing. Any new major capability therefore needs its own environment-driven flag, defaulted
**off**, as the directive requires (Part 2.4).

## 5. The durability question (Part 4.4), answered from the deployment

- `vercel.json` contains only `{"framework": "nextjs"}` — **no cron, no queue, no worker.**
- `src/lib/schedule-execution.ts` is honest about itself: *"There is no timer, worker or AI
  running while the app is closed… the machine is TIMESTAMP-driven."* It replays what the
  persisted schedule says happened; it does not execute AI work.
- Therefore: there is **no durable background execution service running today**. A
  synchronous "generate the whole essay in one request" would exceed the function limit and
  would be untruthful about progress.

Supported options, and what this round does about each:

| Option | Reality in this deployment | Decision |
| --- | --- | --- |
| Vercel Cron | Supported by the platform, but the schedule frequency allowed depends on the Vercel plan (Hobby is limited to daily), and Vercel **fails the deployment** for a schedule the plan does not permit. | Implement the secured tick endpoint; adding the schedule line is an Owner decision, documented in `docs/AUTONOMOUS_ASSIGNMENTS.md`. |
| Vercel background functions / `waitUntil` | Bounded by the same function lifetime; not a queue. | Not relied on. |
| External queue (QStash, Inngest, SQS) | Real durable execution, but needs a new account and a new secret — a new paid subscription the directive forbids without Owner approval. | Documented as the next step if the Owner wants off-browser continuation. |
| Client-driven advancement on an open page, against persisted state | Works today with no new service: each poll advances exactly one bounded step, and a reload resumes from the persisted state. | **Implemented.** Reported honestly as `on_open`. |

The consequence, stated plainly so it can never be overstated: with no cron and no queue,
an autonomous run **advances while a Sophira page is open, or on the next visit** — it does
not continue generating while the application is closed. The run's own status view reports
which mode is active; it never claims the other.

## 6. Risk assessment

| Risk | Why it matters here | Mitigation in this round |
| --- | --- | --- |
| Touching the manual essay path | It is the working product; its contract is tested | New mode is a **separate route + separate table**; the manual routes and their response shapes are untouched, and a regression test asserts they still answer as before |
| A refactor of prompt-building changing generated output | Silent quality regression | Prompt text is shared through one pure module with pinned assertions |
| A new table without correct RLS | Cross-student leakage of academic work | Additive migration, `enable row level security`, owner-only policies, explicit `user_id` on every read/write |
| Claiming background execution | Dishonest progress, the exact failure the directive forbids | Status view distinguishes `on_open` from `scheduled`; completion requires a stored verification verdict |
| Duplicate runs / duplicate sections | Duplicated student work | Unique `(user_id, idempotency_key)` partial index + lease token + step idempotency |
| Migration drift | CI migration verification refuses the chain | Mandatory marker added for the new migration in the same commit |

## 7. Rollback plan

1. The new capability is behind `SOPHIRA_AUTONOMOUS_ESSAY` (default **off**). Unsetting it
   returns the product to exactly today's behaviour with no data loss.
2. The migration is additive (`create table if not exists`, indexes, policies). Dropping
   `public.assignment_runs` removes only the new records; no existing table is touched.
3. Every new route is new, so no existing route needs restoring.
4. Documentation changes are additive and reversible; the historical decision record is
   preserved rather than deleted.

## 8. What this audit authorises

Phase 1 (documentation and governance realignment, no behaviour change) and Phase 2
(autonomous assignment mode, additive) may now proceed. Nothing in the audit required an
existing file to be rewritten in place except the governance wording the directive names
explicitly (Part 8).
