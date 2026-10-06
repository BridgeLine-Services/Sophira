# Sophira — Implementation Audit (Prompt 1 round)

**Date:** 2026-10-05 · **Base commit:** `8f8d8fc` · **Machine-readable version:** `docs/implementation-checklist.json`

This audit was performed against the **actual repository code**, not against
the documentation. Every status below was reached by reading the relevant
files, migrations, routes, and tests. No speculative claims: where something
could not be verified in this environment (live backend, external
credentials, physical devices), it is marked accordingly.

**Independently verified during this audit:** the offline suite passed
**277/277** at the base commit (285/285 after this round's additions),
`tsc --noEmit` is clean, `next build` compiles all 38 routes, and the live
deployment (https://sophira.vercel.app) was probed over HTTP: `/` → 307
`/login`, `/login` 200, `/install` 200, `/downloads` 200,
`/manifest.webmanifest` 200, `/api/health` 200 — i.e. production is in the
documented **degraded mode** (no Supabase/AI env vars configured).

Nothing working was removed or replaced. The audit found **no broken
systems**; the gaps are (a) two required features that are genuinely
absent, (b) external owner/credential actions, and (c) runbook defects
that would break a fresh production bring-up.

## Status legend

- **IMPLEMENTED** — code exists, typechecks, builds, and is unit/integration tested where the logic is offline-testable.
- **PARTIAL** — a required sub-capability is missing or the item works but cannot be verified to spec in this environment.
- **BROKEN** — implemented but not working. *(none found)*
- **MISSING** — no implementation exists.
- **UNVERIFIED** — implemented, but no verification of any kind has been possible.

## Checklist

### 1. Personalized academic learning — IMPLEMENTED
`src/lib/ai/context.ts` (`composeAcademicContext`: global profile → course →
teacher → assignment hierarchy), `src/lib/ai/subjects.ts` (9 subject + 15
math-topic workflows), `/api/ai/solve`. Tables: profiles, courses, teachers,
assignments, learning_patterns. Tests: hierarchy, routing, order-of-authority.
Live model flow needs `OPENAI_API_KEY` (external).

### 2. Writing style/profile learning — IMPLEMENTED
`/api/ai/analyze-writing` (samples → PENDING proposal), conditional profile
layer in the composer (math never loads it), `ProposalsPanel` approval flow.
Tables: writing_profiles, writing_samples, profile_update_proposals,
profile_versions (migration 0003). Conditionality unit-tested.

### 3. Teacher-specific methods and requirements — IMPLEMENTED
Structured teacher profiles + AI doc extraction → PENDING proposals,
`academic_sources` (0004) with dates/archival/conflict notices,
method-compliance normalization (`src/lib/ai/compliance.ts`). Unit-tested.

### 4. Instructions overriding older learned patterns — IMPLEMENTED
"ORDER OF AUTHORITY" is the first prompt section (assignment » teacher »
course » approved preferences); preserved writing habits carry an
explicit requirements-always-override caveat. 13 dedicated assertions.

### 5. Feedback and correction learning — IMPLEMENTED
`/api/ai/feedback-to-proposal` (correction → PENDING proposal, never applied
silently), corrections UI, observed-mistake normalization + similarity
matching. Lifecycle + scope tests.

### 6. Pattern lifecycle and stale-pattern detection — **PARTIAL**
Lifecycle: IMPLEMENTED and tested (candidate/active/corrected/recurring/
temporary, confidence ceiling, scoped isolation, DB persistence 0005+0007).
**Stale-pattern detection: MISSING** — `first_observed`/`last_observed` are
stored and displayed but no code ages, demotes, or flags patterns by
observation age; `selectApplicablePatterns` ignores age entirely.

### 7. Assignment/rubric analysis — IMPLEMENTED
`src/lib/rubric.ts` (structured checklist, deterministic audit, labeled
AI-semantic criteria, revision list), `/api/rubric-audit`,
`RubricAuditPanel`, `rubric_audits` (0011). Unit-tested incl. a real
headings bug found and fixed last round.

### 8. Research engine — IMPLEMENTED (live run pending external key)
Server-side search provider abstraction (Brave/Tavily/custom; keys never
reach the browser), assignment-aware query generation, dedupe, objective
ranking, URL verification, source approval, `research_*` tables (0012),
`/api/research`, `ResearchPanel`. **Never run live — no SEARCH_API_KEY
exists in any environment.** Honest failure without a key.

### 9. Claim-to-source evidence verification — IMPLEMENTED
`fetchAndVerify` (redirects, paywalls, thin content, content hash),
`quoteInContent` / `claimSupportsDeterministic`, `/api/research/audit`
re-verifies quotes against stored content; fabricated quotes fail.
Unit-tested offline with injected fetches.

### 10. Citation integrity — IMPLEMENTED
Deterministic MLA/APA/Chicago/generic citations from stored source records
(`src/lib/research/citation.ts`); the model never invents a bibliography —
`/api/ai/solve` appends a Works Cited built from records and refuses to
write a researched essay with zero approved sources. Unit-tested.

### 11. Submission readiness — **MISSING**
No feature aggregates verification status, rubric audit results, citation
audit, and conflicts into a per-assignment "ready to submit" verdict. The
workspace shows these as separate panels only.

### 12. Typing-speed calibration — IMPLEMENTED
`src/lib/typing.ts` (gross/net WPM, accuracy, suspicious-attempt flags),
server-side `/api/typing` with RLS persistence (0009), `TypingTest` in
onboarding + settings, server-controlled passages. Unit-tested.

### 13. Typing-paced output — IMPLEMENTED
Single timing engine (`src/lib/pacing.ts`) + pure UI state machine
(`pacing-controller.ts`) + `PacedOutput` with pause/resume/instant; no
calibration → honest message + link, never an invented speed. Unit-tested.

### 14. Deadline-aware scheduling — IMPLEMENTED
`src/lib/scheduler.ts` (deterministic, bounded breaks 10s–6h, urgency
scaling, infeasibility warnings), `due_at` on assignments (0010),
workload estimation with user-estimate-wins. Unit-tested.

### 15. Persisted work/break sessions — IMPLEMENTED
`work_schedules` (RLS) with start/pause/resume persistence via
`/api/schedule`. Logic unit-tested; live persistence pending backend.

### 16. Invitation-only access — IMPLEMENTED
Database-level gate (0008): `handle_new_user` atomically claims a pending,
unexpired, email-bound invitation — no client path can bypass it;
fail-closed bootstrap via `app_config.owner_email`. Expiry 0006, owner-only
policies 0002. 26 security assertions. **Runbook defect found and fixed
this round** (see CB2).

### 17. Owner approval of invitations — IMPLEMENTED
`invitation_requests` with `can_request_invites` permission; only the owner
approves (issuing the invitation) or rejects; requests never create access.
Owner dashboard wired end-to-end.

### 18. User academic-data isolation — IMPLEMENTED (live probe pending)
Per-user RLS on every content table (19 policies in 0001; 0012 research
tables are `user_id = auth.uid()` for all rows); app-layer isolation
unit-tested. Live two-account DB probe pending Supabase credentials.

### 19. Owner aggregate analytics — IMPLEMENTED
`network_stats()` SECURITY DEFINER aggregate-only function (0005);
`/api/network/stats` returns membership metadata + aggregate counts, never
content. No policy grants the owner cross-user content reads.

### 20. RLS/security — IMPLEMENTED (live probe pending)
RLS on all tables incl. `app_config` (no client policies, revoked from
anon/authenticated), private storage bucket, prompt-injection defense on
all untrusted text, middleware degraded-mode regressions. Live Postgres
probe pending credentials.

### 21. PWA installation — IMPLEMENTED
Manifest, network-first service worker (no academic data cached),
`ServiceWorkerRegister`, platform-aware `/install`. Live probe this audit:
manifest + install 200. Device installs need physical devices.

### 22. Native Capacitor packaging — IMPLEMENTED
`android/` + `ios/` load the deployed web app via `server.url` (single
canonical implementation). Real local Gradle build verified with checksums
(TEST_REPORT §21); not device-tested.

### 23. Native deployment configuration — IMPLEMENTED (dormant)
`release.yml` matrix (Android/iOS/Windows/macOS/Linux), signing via
secrets with honest unsigned fallback, placeholder-URL refusal, SHA-256
checksums. Dormant pending `SOPHIRA_APP_URL` repo variable.

### 24. Legal documents — PARTIAL
LICENSE + ToS/Privacy templates + review notice are complete and tested
for presence; bracketed owner facts and attorney review are external by
design.

### 25. Production environment configuration — PARTIAL
Production is LIVE but DEGRADED (Vercel Production env vars unset) — the
top critical blocker (CB1), external. **Runbook defects found and fixed
this round:** README listed only 5 of 12 migrations and stated the
removed "first user becomes owner" rule; no owner-bootstrap SQL step
existed outside the migration file; there was no machine-checkable
readiness signal. Added: corrected README, RELEASE_PROCESS bring-up
section, `/api/health` configuration booleans + 8 tests.

### 26. Automated acceptance testing — IMPLEMENTED
285/285 offline assertions pass (verified this audit), strict typecheck,
production build, CI active on GitHub, live acceptance runbooks ready
and blocked only on credentials.

### 27. Production release gate — PARTIAL
Gate mechanics are honest and complete (placeholder refusal, checksums,
CI-green requirement). Dormant because `SOPHIRA_APP_URL` is unset (token
confirmed 403 `variables:write`), and the readiness signal that would let
the gate verify a deployment was missing until this round (now
`/api/health`).

## CRITICAL BLOCKERS

| ID | Blocker | Owner | Status |
|---|---|---|---|
| CB1 | Vercel Production env vars unset → production degraded | External: owner sets them in Vercel, verifies via `curl /api/health` | **OPEN** — cannot be done from the repository |
| CB2 | Fresh-install owner bootstrap undocumented; README stated the removed first-user-becomes-owner rule (a fresh deploy would be locked with wrong guidance) | Repository | **FIXED THIS ROUND** — README setup + RELEASE_PROCESS bring-up |
| CB3 | No machine-checkable deployment-readiness signal — the root cause of the days-long production 500s (§27) | Repository | **FIXED THIS ROUND** — `/api/health` configuration booleans + 8 tests (commit `50cedb9`) |
| CB4 | `SOPHIRA_APP_URL` Actions variable unset → release workflow dormant | External: repo Settings → Variables | **OPEN** — audit token confirmed 403 on the variables API |
| CB5 | Native signing secrets/certs absent → signed artifacts impossible | External | **OPEN** — unsigned fallback is honest by design; gates signed releases only |

Per Prompt 1, only the repository-owned critical blockers (CB2, CB3) were
implemented this round. No other category was touched.

## HIGH PRIORITY (not implemented — awaiting explicit authorization)

1. **Submission readiness** (MISSING) — aggregate per-assignment readiness
   verdict from verification + rubric audit + citation audit + conflicts.
2. **Stale-pattern detection** (MISSING) — aging/demotion of learning
   patterns by `last_observed`; UI staleness indicators.
3. Live research-engine verification — needs `SEARCH_API_KEY` (external).
4. Live RLS cross-user probe — needs Supabase credentials (external).
5. Legal placeholders — owner facts + attorney review (external).

## MEDIUM PRIORITY

1. CI step label says "144 assertions" (actual: 285) — cosmetic; editing
   `.github/workflows/` requires a workflow-scoped credential.
2. Browser-level (Selenium/Playwright) pacing/scheduler UI tests — logic is
   tested, rendering is not.
3. Real-device PWA/native acceptance matrix rows remain NOT TESTED.
4. Test-count drift across docs between rounds (now re-anchored by
   TEST_REPORT §28).

## OPTIONAL ENHANCEMENTS

1. Additional search providers behind the existing provider abstraction.
2. More typing passages / adaptive calibration difficulty.
3. `.ics` calendar export of scheduler plans.
4. Learning-pattern export/import for account portability.
5. Additional citation styles (Harvard, Turabian).

## What this round changed (summary)

- `src/app/api/health/route.ts` — per-capability configuration readiness
  booleans (no secret values), `force-dynamic` so env is read per request.
- `tests/run.ts` — 8 health-readiness regression tests (degraded / partial
  / full / custom-provider / secret-leak check). Suite: **285/285**.
- `README.md` — setup section rewritten: all 12 migrations, the mandatory
  `owner_email` bootstrap SQL, fail-closed explanation; removed the false
  "first user becomes owner" claim; test count corrected.
- `docs/RELEASE_PROCESS.md` — production bring-up: full env var list,
  one-command `/api/health` verification, owner bootstrap step.
- `TEST_REPORT.md` — §28 documents this round.
- `docs/IMPLEMENTATION_AUDIT.md` + `docs/implementation-checklist.json` —
  this audit (human- and machine-readable).

---

## Audit addendum: AI provider architecture (2026-10-06)

**Status: implemented, tested (offline), live-verified for the build path.**

- Free-first provider dispatch (`src/lib/ai/provider.ts`): Gemini free tier
  (default `gemini-2.5-flash`) → paid OpenAI ONLY on explicit owner opt-in.
  Zero-billing defaults fail closed — a paid key is reported and ignored.
- Key hygiene: provider keys are server-side only; `scripts/secret-scan.mjs`
  (release-gate check #39) scans the built client bundle, service worker,
  and native asset bundles for all four secret names and fails on any hit.
  The real production build scanned CLEAN.
- Owner diagnostics: `/owner` provider card + `GET /api/provider-status`
  (usage counts from `provider_usage`, migration 0021; "Cost unknown" is
  shown where cost cannot be verified rather than a fabricated figure).
- Local models: Qwen2.5-1.5B (laptop tier) added after hub verification;
  Gemma candidates are license-gated on the HF hub (401) and are NOT
  registered; the desktop tier has no entry rather than a fake one.
- Not live-verified: a real Gemini call (no key in this environment) and
  the owner-side blockers (env vars, migrations, device tests, legal
  placeholders) — unchanged and honestly BLOCKED in the release gate.

