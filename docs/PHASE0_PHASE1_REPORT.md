# Phase 0 audit and Phase 1 report — production honesty

**Date:** 2026-11-02 · **Audited baseline:** `74dfaa2` · **Branch:** work on `chore/phase1-production-honesty`,
merged to `master` after CI.

---

## PART A — PHASE 0 AUDIT (no changes made before this was written)

### A1. What was actually inspected

The complete repository at `74dfaa2`: 61 pages, 82 API routes, 41 migrations, 71 test files,
5 GitHub workflows, `vercel.json`, the operational docs, and the running application itself
(local production build plus `https://sophira.vercel.app`).

### A2. Base44 project versus GitHub — the crucial architectural finding

There **is** a Base44 app named "Sophira", and its ID (`6ab83b51b09e6e1b845f90d3`) is identical
to this Superagent's own ID. It is this agent's workspace, and its only entity schema is the
platform's default `User`. It contains **no** Sophira domain data, pages, or business logic.

**Conclusion:** there is no second implementation to reconcile, and nothing to copy in either
direction. `https://github.com/BridgeLine-Services/Sophira` is the single source of truth for
the application, and `https://sophira.vercel.app` is its deployment. Base44 cannot edit the
Next.js application directly; code changes happen in the repository. Any claim that Base44
"knows about" Sophira's database would be wrong: the database is Supabase, reached from the
deployed application.

### A3. Existing functionality — complete and working

Authentication (login, signup, invitations, password reset), middleware route protection,
course management across 8 subject routes, teacher profiles, assignment creation and workspaces,
proposals, the AI tutor surface, writing assistance and review, originality findings with honest
offsets, research with source verification, document extraction, Google Docs (9 routes),
Microsoft Word (7 routes), Canvas (library + 5 routes + panel), document history with gradual
insertion and recovery copies, offline mode with encrypted local storage, owner administration,
and the setup wizard.

### A4. Partially implemented

- **Notifications** — toasts (35 files) and email digests (9 files). No notification centre,
  no read state, no preferences. Disclosed in the Stage 5 report; unchanged here.
- **Canvas** — full read-only sync, but no live institution test, no rubric display, attachments
  referenced but not downloaded, sync manually initiated.
- **Accessibility** — structurally verified, no manual screen-reader or contrast certification.

### A5. Not implemented

Only the notification centre, as above.

### A6. Built and wired but never tested against real services

Google Docs, Microsoft Word, Canvas, and AI providers. No owner OAuth registration exists in this
environment, so no live call was made or is claimed.

### A7. Security controls present

48/48 tables with RLS and 61 policies; server-only secrets; OAuth state validation; SSRF guards
on extraction; prompt-injection suites; owner-scoped queries; guarded restoration; paid-AI
opt-in with a monthly ceiling; secret scanning in CI.

### A8. Database structure

41 additive migrations. Two new event types in Stage 4 reused existing text columns, so Stage 4
and 5 added no migration. Nothing in this phase touched the database.

### A9. Integrations

Canvas, Google, Microsoft via OAuth with per-student connections in `provider_connections`;
research via a configurable search provider; AI via Gemini/OpenAI/self-hosted/offline.

### A10. User-facing workflows

Sign in → dashboard → courses → assignment workspace → AI help → writing review → document
insertion → history and recovery. Every one of these has a path that works without any optional
integration, which the audit re-confirmed in code.

### A11. Technical debt

107 lint warnings (102 unused variables, 5 hook dependencies), pinned so they cannot grow.
Duplicate readiness logic between `src/lib/deployment.ts` and `scripts/verify-deployment.mjs`
(a documented mirror). No notification architecture to extend.

### A12. Conflicts and risks found

1. **Node mismatch (confirmed).** `package.json` requires 22.x; `ci.yml` and the release-gate job
   used 22, but `migrations.yml`, `health.yml` and five steps of `release.yml` used **20**.
2. **False-confidence migration job (confirmed).** `migrations.yml` prints
   `MIGRATIONS-LIVE-STATUS: BLOCKED_NO_CREDENTIALS` and exits **0**. A green tick therefore never
   proved production migrations were applied. Mitigating factor: `scripts/release-gate.mjs`
   `db-migrations` *does* probe the newest tables and fails a release when the schema is unverified.
   The release path was already honest; the secondary job's green tick was not.
3. **Readiness overstated and understated at once (confirmed).** `/api/health` reported whether
   settings were *present*, never whether anything *worked*, and `evaluateDeploymentReadiness`
   treated a remote AI key as required. Both the Stage 5 report and this audit had to say so.
4. **Production has no AI configured (confirmed, new).** Live `https://sophira.vercel.app/api/health`
   returns `supabase: true, supabase_service_role: true, ai: false, search: false`. Online academic
   help is therefore unavailable in production while offline help remains — exactly the
   built-in-versus-remote distinction the brief asked about.
5. **Deployment cannot prove its commit (confirmed, now fixed in code).** The deployed build does
   not report which commit it runs, so "deployed equals GitHub" could not be demonstrated.

### A13. Files that must be preserved

Every existing route, page, component, migration, RLS policy, and test. This phase added files and
extended three: `src/lib/deployment.ts`, `src/app/api/health/route.ts`, and the environment manifest.
No file was rewritten and no behaviour removed.

### A14. Regression risks and how they were prevented

| Risk | Mitigation |
|---|---|
| Changing readiness semantics breaks the release gate | Capabilities added as a **new field**; `ready`/`missing` untouched, and both old contracts re-asserted in the new test file |
| Public `/api/health` abused for database load | Deep check is opt-in (`?deep=1`), 60s cached, 5s timeout, booleans only |
| A strict migration gate breaks first-launch | Attempted and **reverted**: the existing test pins the push path as a non-failing notice. The authoritative failure stays in `release-gate.mjs` |
| Env variable reads break the manifest audit | Health reads only manifest-declared names; `.env.example` regenerated from the manifest |
| My own verification script misreading absence as failure | Caught in practice, fixed: three outcomes (PASS / FAIL / UNVERIFIED) |

---

## PART B — PHASE 1 CHANGES COMPLETED

### B1. Node.js alignment

`migrations.yml`, `health.yml`, and 5 steps in `release.yml` moved from Node 20 to 22, matching
`package.json` and `ci.yml`. **7 references fixed.** YAML validated for all four workflow files.

### B2. Honest capability reporting

`src/lib/deployment.ts` now exposes `describeDeploymentCapabilities()` returning nine capabilities
in the brief's vocabulary (ready / needs_attention / not_connected / not_configured / checking /
unable_to_verify) with a plain-language sentence each. Rules enforced by test:

- Storage and sign-in say **"unable to verify"** until a real check succeeds. Configuration alone
  never yields "ready".
- Optional capabilities (research, Canvas, Google, Microsoft, notifications) can never make the
  application look broken.
- A different service answering at the URL is flagged.
- Missing online AI says what *still works*, so nobody concludes the app is dead.

### B3. Health check that actually checks

`/api/health?deep=1` performs a real read against the database and a real request to the sign-in
service, returning only `ready` / `unreachable` / `not_configured`. Cached 60s, 5s timeout, no
values, no hostnames, no keys. It also reports the deployed commit so parity can be proven.

### B4. Production verification report

`npm run verify:production` (`scripts/production-verification.mjs`) prints deployed commit versus
GitHub head, reachability, storage, sign-in, AI, research, and per-student integrations, with
release blockers separated from unverified items.

### B5. Owner-facing setup vocabulary

Capability messages are written for someone who has never heard of an API key: "Sophira cannot
reach its private storage right now. Nothing you saved has been deleted." No SQL, no tokens, no
status codes, no provider internals. Enforced by a jargon regex in the test suite.

---

## PART C — TESTS PERFORMED

| Test | Type | Result |
|---|---|---|
| `npm ci` | automated | PASS |
| `npm run lint` | automated | PASS, 0 errors, 107 pre-existing warnings (unchanged) |
| `npx tsc --noEmit` | automated | PASS |
| `npm test` | automated | **4,485 passed, 0 failed** (was 4,462; +23) |
| `npm run build` | automated | PASS |
| `npm run verify` | automated | PASS |
| `npm run scan:secrets` | automated | CLEAN |
| `npm run smoke:runtime` | live, local build | 26/26 PASS |
| `npm run verify:production` | live, real deployment | Completed; see Part F |
| Workflow YAML parse | automated | 4/4 valid |
| Canvas / Google / Microsoft / AI provider live calls | — | **NOT RUN — no credentials** |

The 23 new assertions cover capability states, the no-jargon rule, the "configured is not working"
rule, optional-service non-blocking, wrong-service detection, and preservation of the original
readiness contract.

---

## PART D — OUTSTANDING WORK

1. Notification centre (Phase 5), unchanged and still disclosed in the capability list.
2. Live integration verification for Canvas, Google, Microsoft, AI and research (Phase 3).
3. Canvas rubric display, attachment retrieval, optional automatic sync (Phase 4).
4. Accessibility: manual screen-reader and contrast pass (Phase 5).
5. 107 lint warnings (Phase 6).
6. Production has no AI provider configured, so online academic help is unavailable there.
7. Stage 4/5 features (gradual insertion, recovery copies, review workspace) are merged but the
   deployed build predates today's commits until Vercel redeploys.

## PART E — OWNER ACTIONS REQUIRED

Each is one step, and none requires a student to do anything.

1. **Vercel Node version:** set the project's Node.js version to **22.x** to match `package.json`.
   The build log already shows 22 is used, so this only removes the warning.
2. **Academic AI:** production reports no AI provider. Either add a provider key to enable online
   help, or accept offline-only help in production. Nothing else breaks either way.
3. **Online research (optional):** add a search provider if source lookup should work.
4. **Integrations (optional, per service):** register the Canvas developer key, Google Cloud OAuth
   client, and Microsoft Entra application when those features should go live. Provide redirect
   URIs from the setup screen; do not paste secrets into chat.
5. **Migration automation (optional):** add `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF`
   repository secrets so the Migrations workflow can verify production instead of reporting BLOCKED.

## PART F — DEPLOYMENT STATUS (measured, not assumed)

| Item | Status |
|---|---|
| Branch | `chore/phase1-production-honesty`, merged to `master` after green CI |
| GitHub `master` head before this phase | `74dfaa2` |
| CI | PASS (verified for each commit pushed) |
| Build | PASS |
| Production reachability | PASS — reachable and identifying itself |
| Production storage | **UNVERIFIED** — settings present; deployed build predates the deep check |
| Production sign-in | **UNVERIFIED** — same reason |
| Production AI | **NOT CONFIGURED** (`ai: false`) |
| Production research | NOT CONNECTED (optional) |
| Production database schema | Not verified by this run; the release gate is the authoritative check |
| Deployed commit | **UNKNOWN** — the deployed build does not report a commit; this fix makes it reportable after the next deploy |
| Staging | Not used in this phase |

**The honest summary:** production is up and answering, its storage settings are present, and its
schema is unconfirmed by this phase. It is **not** accurate to call production "fully verified"
until the next deployment reports a commit and a deep check passes.

## PART G — ROLLBACK

- **Changes:** one capability-reporting module extended, one health route extended, environment
  manifest plus `.env.example` extended, three workflow files' Node version aligned, two new
  scripts, two new/updated docs, one test file added.
- **Safest rollback:** `git revert` the phase commit. No data changes exist to reverse.
- **Migration added:** none. The database was not touched.
- **Existing data changed:** none.
- **External service configuration changed:** none. No Vercel setting, Supabase setting, or secret
  was created, modified, or deleted by this phase.
