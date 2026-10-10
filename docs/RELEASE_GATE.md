# Sophira Release Gate

**The single authoritative production/testing release gate.**

One command evaluates every critical system and produces exactly one final
state:

```
RELEASE STATUS: GO
```

or

```
RELEASE STATUS: BLOCKED
```

There is no third state. A release is GO **only when every check below is
PASS**.

## How to run (repeatable, before every production deployment)

```bash
node scripts/release-gate.mjs              # full gate (runs npm test, build, tsc)
node scripts/release-gate.mjs --fast       # skip npm test/build/tsc — use ONLY when
                                           # the same CI job already ran them
node scripts/release-gate.mjs --report     # print the report, always exit 0
node scripts/release-gate.mjs --self-test  # verify the gate's own rules (fast)
```

Exit codes: **0 = GO**, **1 = BLOCKED or FAIL**, 2 = usage error. In CI the
release workflow runs the gate after its own test/build steps (with
`--fast --report`) and publishes the status; enforcement mode is for
deployment scripts and manual pre-flight checks.

Environment the gate reads: `SOPHIRA_APP_URL`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` (free tier — the preferred AI path; `OPENAI_API_KEY` is required ONLY when paid AI is explicitly enabled),
`SEARCH_API_KEY` (+ `SEARCH_PROVIDER` / `SEARCH_BASE_URL`),
`SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` /
`SUPABASE_TEST_SERVICE_ROLE_KEY` (live security matrices), `RUN_LIVE_TESTS`
(costs provider credits — only opt in deliberately).

## Status semantics (hard rules)

- **PASS** — the behavior was actually verified in this run. Evidence is
  printed with each line. A check is never PASS because code exists.
- **FAIL** — a verification ran and did not match the expected behavior.
- **BLOCKED** — verification is impossible in this environment because a
  prerequisite is missing (credentials, devices, owner facts). The blocker
  is named. BLOCKED is never treated as PASS.
- **NOT RUN** — runnable but deliberately not executed in this run (e.g.
  the live search test without `RUN_LIVE_TESTS=1`, or a Gradle build the
  operator schedules separately). NOT RUN is never treated as PASS.

Any check that is not PASS (FAIL, BLOCKED, or NOT RUN) blocks the release.

## The 39 checks

Each check prints its evidence. "Offline suite" evidence means the executed
`npm test` section(s) listed — behavior verified by real assertions, not by
code inspection.

| # | Check | How it is evaluated |
|---|---|---|
| 1 | Production URL works | `SOPHIRA_APP_URL` resolved + `scripts/verify-deployment.mjs` live check (health endpoint, configuration readiness) |
| 2 | Database migrations applied | production DB probe of the newest migration's table (0030 `subject_preferences`) via the REST API with service-role credentials — verifies the 0001-0030 chain |
| 3 | AI provider configured | free-first architecture: `GEMINI_API_KEY` (Gemini free tier, server-side only) — or `OPENAI_API_KEY` counting ONLY when paid use is explicitly allowed (`ALLOW_PAID_AI=true` / `MONTHLY_AI_BUDGET_USD>0`); zero-billing defaults reject a paid key |
| 4 | Search provider configured | `SEARCH_API_KEY` (+ custom `SEARCH_BASE_URL`) present |
| 5 | Search provider live test passes | real search request when `RUN_LIVE_TESTS=1`; otherwise NOT RUN |
| 6 | Invitation-only signup tested | live invitation matrix (`tests/security/invitation-regression.mjs`) when `SUPABASE_TEST_*` is configured |
| 7 | Invitation approval tested | live invitation matrix (owner approve → invitation issued path) |
| 8 | Owner privacy tested | live RLS matrix (`tests/security/rls-regression.mjs`): owner sees aggregates only |
| 9 | RLS isolation tested | live RLS matrix: cross-account probes denied |
| 10 | Student-to-student isolation tested | live RLS matrix: cross-student probes denied |
| 11 | Writing profile tested | offline suite §3/§5 |
| 12 | Teacher-specific rules tested | offline suite §1/§4 |
| 13 | Teacher rules override old personal habits | offline suite §8/§12a + §18 conflict loop |
| 14 | Learning corrections tested | offline suite §9-§12 |
| 15 | Learning stale-pattern detection tested | offline suite §8d + §18 decay |
| 16 | Typing test tested | offline suite §13/§15d |
| 17 | Typing-paced output tested | offline suite §14/§15b |
| 18 | Deadline scheduler tested | offline suite §15/§15c |
| 19 | Persisted break/session state tested | offline suite §19 (timestamp-driven state machine) |
| 20 | Rubric audit tested | offline suite §15e |
| 21 | Submission readiness gate tested | offline suite §15j/§15k + §16b-§16d |
| 22 | Research retrieval tested | offline suite §15i |
| 23 | Claim-to-source verification tested | offline suite §16b |
| 24 | Citation integrity tested | offline suite §15h/§16d |
| 25 | Source authority ranking tested | offline suite §16c |
| 26 | PWA tested on Android | `docs/DEVICE_ACCEPTANCE.md` Android/PWA row must record a real PASS |
| 27 | PWA tested on iPhone | `docs/DEVICE_ACCEPTANCE.md` iPhone/PWA row must record a real PASS |
| 28 | APK built if supported | built APK artifact under `android/app/build/outputs` |
| 29 | APK tested on physical Android device if available | `docs/DEVICE_ACCEPTANCE.md` Android/APK row |
| 30 | Native URL configured | `scripts/native-url.mjs` in release mode (no silent fallback) |
| 31 | Capacitor versions aligned | `@capacitor/*` toolchain packages share one major version |
| 32 | Legal placeholders removed or explicitly blocked pending owner input | `scripts/legal-status.mjs` — zero placeholders = PASS; any remaining owner fact = BLOCKED (the agent must not invent them) |
| 33 | Production environment variables verified | required production env vars present |
| 34 | No secrets committed | secret-pattern scan over all git-tracked files (private keys, sk-/rk-, AWS, ghp_, Slack) |
| 35 | npm test passes | full offline suite executed |
| 36 | npm build passes | `next build` executed |
| 37 | Type checking passes | `tsc --noEmit` executed |
| 38 | Security tests pass | both security suites' self-tests + offline conformance + the live matrices when configured |
| 39 | Client bundle secret scan passes | `scripts/secret-scan.mjs` scans built client artifacts (`.next/static`, service worker, Capacitor/Tauri asset bundles) for `OPENAI_API_KEY` / `GEMINI_API_KEY` / `SEARCH_API_KEY` / `SUPABASE_SERVICE_ROLE_KEY` and fails if any appears |

## Blocker policy

When BLOCKED, the gate lists **every** blocking reason, numbered, e.g.:

```
RELEASE STATUS: BLOCKED

BLOCKERS:

1. Search provider live test passes — NOT RUN: live search test not
   executed in this run (set RUN_LIVE_TESTS=1 …)
2. Claim-to-source verification tested — … (only if the suite failed)
3. APK tested on physical Android device — BLOCKED: no device available
4. Legal placeholders — BLOCKED: legal documents still carry owner-fact
   placeholders …
```

The gate never marks a release GO while a critical security,
research-integrity, build, or privacy requirement is FAIL, BLOCKED, or
NOT RUN.

## Known current state (2026-10-05)

The gate is honest about this repository's situation: without owner-side
configuration it reports BLOCKED. Checks 1-10, 26-29, 30, 32-33 and the live
part of 38 are blocked on the documented owner prerequisites (production
URL, database credentials, provider keys, `SUPABASE_TEST_*` secrets,
physical devices, legal owner facts). Checks 11-25, 31, 34-37 and the
offline security conformance are verifiable now and pass.

This is intentional: the gate exists precisely so a release cannot be
claimed ready while those prerequisites are missing.
