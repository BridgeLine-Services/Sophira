# Autonomous assignment mode

**Added:** 2026-11-15 · **Feature switch:** `SOPHIRA_AUTONOMOUS_ESSAY` (default **off**)
**Owner:** BridgeLine Services

## 1. What it is

The manual essay workflow is interactive on purpose: Sophira plans, you approve or edit the
outline, then you ask for one section at a time. It is excellent and it is unchanged.

Autonomous mode is a second way to use the same 13-stage pipeline: you choose it explicitly,
and Sophira plans, drafts, audits and verifies the whole assignment itself, reporting honestly
at every step.

## 2. What it does, in order

1. **Reads your own records** — the course, the teacher's stored instructions and rubric, your
   approved writing profile, your long-term academic memory and your observed learning patterns.
   Anything that could not be read is listed on the run, never silently skipped.
2. **Gathers evidence** — if the assignment is attached to a research project, only sources you
   approved **and** that were verified may be used. With none, the run stops and says so; it does
   not draft a researched piece on unverified sources.
3. **Plans** — assignment type, constraints, word target, thesis and a 3–6 section outline.
4. **Drafts one section per step**, in outline order, with the evidence mapped to that section.
   Quotations and statistics that are not in your sources are forbidden by the prompt, and the
   evidence is supplied as untrusted data.
5. **Checks each section** — a citation note, a rubric note and a style note per section.
6. **Verifies the whole document** — supports the thesis, covers the outline, cites only the
   sources that were attached.
7. **Delivers** — Markdown or plain-text export, with a provenance block stating the sources
   used, the final check's verdict and any recorded limitations.

## 3. What "completed" means

A run may be called complete **only** when every planned section has stored text, each section
has its three audit notes, and a verification verdict is stored. Otherwise the run stays in
progress or reports `blocked` with the reason. A run can complete with the verdict
**NEEDS REVIEW** — that is a real result, and the file says so.

## 4. How progress actually happens (read this part)

Four states, kept apart. A reader should never have to guess which one applies.

| State | Where it stands today (2026-11-15) |
|---|---|
| **In the code** | `continuationMode()` returns `scheduled` only when `SOPHIRA_AUTONOMOUS_SCHEDULE` is on **and** a `CRON_SECRET` of 16+ characters exists. The authenticated endpoint is `POST /api/essay/autonomous/tick`. |
| **In GitHub Actions** | `.github/workflows/autonomous-sweep.yml` is on `master`: `*/15 * * * *` plus manual dispatch, `contents: read`, no shell tracing, the password read only from the repository's secrets and never printed. GitHub schedules at five-minute granularity, so 15 minutes is within limits; GitHub delays scheduled runs when busy, so it is best effort, not a guarantee. |
| **In the hosting environment** | **Not configured.** No `CRON_SECRET` exists in Vercel or in the repository's secrets, and `SOPHIRA_AUTONOMOUS_SCHEDULE` is unset. With no password the job exits before making a request, and its log says so. |
| **Actually running and verified** | **No.** No run has been advanced by the schedule. Every screen therefore reports `on_open`. |

So, in practice:

- **Default today, `on_open`.** The run advances while a Sophira page is open, one step per
  request, and resumes from the database exactly where it stopped. It does **not** keep
  generating while the application is closed, and the run screen says that in those words.
- **`scheduled`, once the Owner switches it on.** Add one 16-plus-character password as
  `CRON_SECRET` in Vercel *and* in the repository's GitHub Actions secrets, then set
  `SOPHIRA_AUTONOMOUS_ESSAY=1` and `SOPHIRA_AUTONOMOUS_SCHEDULE=1` together. The endpoint
  refuses any caller without the bearer secret, and refuses entirely when none is configured.
- **If the schedule is on and production is unreachable,** the job now fails its own run rather
  than reporting a quiet success. A refusal (401/403/404) is reported without failing the job,
  because that is a configuration answer, not a transient fault.

No competing background system has been added: this is the repository's own worker, made
honest. A Vercel cron entry or an outside scheduler remains an option the Owner can approve,
but it is not needed while the GitHub workflow can do the job.

## 5. Duplicate protection

- One live run per request: a unique index on `(user_id, idempotency_key)`.
- One writer at a time: a two-minute lease; a repeated or concurrent callback is ignored instead
  of generating a second copy of a section.
- A retry **resumes the same run**; it never starts a second one.
- A failed section never erases sections that were already stored.

## 6. Security

- Every member route uses the existing authentication guard and the user-scoped database client.
- `assignment_runs` has row level security with per-owner read, insert and update policies, and
  deliberately no delete policy.
- No provider key, token or secret is stored in a run record or returned in a response.
- The one privileged caller is the sweep, which authenticates first and then acts as the run's
  own owner.

## 7. Turning it off (rollback)

1. Remove `SOPHIRA_AUTONOMOUS_ESSAY` (or set it to `0`) and redeploy.
2. Nothing else changes: the manual workflow is not behind any flag.
3. Run records stay in the database; no student work is lost.
4. Dropping the feature entirely means dropping `public.assignment_runs`; no other table is
   touched.

## 8. Verification (2026-11-15)

| Gate | Result |
| --- | --- |
| `npm test` | 9281 passed, 0 failed (baseline before this round was 9017) |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 33 warnings (the allowed ceiling) |
| `npm run build` | success |
| `npm run verify` | PASS |
| `npm run scan:secrets` | CLEAN |
| Migration chain on a throwaway PostgreSQL | not run here (no local server in this environment); the chain is verified by CI and by the migration self-test |

Not verified, and not claimed: live end-to-end generation (needs a configured AI provider), and
two workers racing on one run against a live database (the lease is unit-tested only).
