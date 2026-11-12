# Sophira Completion Report (latest round: 2026-10-14)

> Evidence-based status only. Historical rounds remain in git history.

## This round: the complete administrative history (2026-11-11)

**Baseline audited:** `945265af` (master had not advanced; 0 open pull requests; CI, CodeQL and
Migrations green on it). **This round:** migration `0053_admin_audit_events.sql`, the recorder, the
wiring into every real event source, the extended reader and 139 new assertions.

### A. Implemented and tested

- **One history, not two.** The existing `public.membership_audit` table and its staff-only read
  policy are extended, not replaced. `0048`'s role-change function and every existing row are
  untouched.
- **`public.record_admin_event()`**: SECURITY DEFINER, pinned `search_path`, closed action list
  (13 categories), ten filtered metadata keys with length caps, actor taken from the session (or
  from the server channel that verified it), five-second retry guard, `EXECUTE` for `service_role`
  only, INSERT/UPDATE/DELETE revoked from `anon` and `authenticated`.
- **Recorded after the action succeeds**, at every real source: `/api/network/members` (suspend,
  restore, remove, invitation permission, plus refusals), `/api/invitations` (created, cancelled,
  deleted, plus a separate refused entry when mail was not accepted), `/api/invitations/accept`
  (joined), `/api/invitation-requests` (approved, declined), and the provider connection store
  (connected on first connection only, disconnected only when something was connected).
- **One plain sentence per entry** for every category, including a removed member (name captured at
  the time) and an unrecognised provider (named as unrecognised, never invented).
- **Security page** filters and pages in the database across all categories; the filters are derived
  from the one vocabulary, so the page cannot offer a category that is never written.
- **Tests:** 7268/7268 (`tests/admin-audit.ts` is new). Type check clean, lint 0 errors
  (32 warnings, ceiling unchanged at 33), production build OK, secret scan clean, 53-migration chain
  applied to a throwaway PostgreSQL 15 with 86 policies and RLS on every table.

### B. Implemented but not live-verified

- The new categories have never been written by the deployed app. The live database has the table
  but not `0053` (probed with a refused no-op, nothing written), so recording currently returns
  "unavailable" and the page shows what it has. One database update closes this.

### C. Blocked by owner configuration

- `0052` (AI response times) and `0053` (this history) are not applied live: Owner Dashboard →
  Database updates → **Update database**.
- A real invitation email needs a configured mail provider.
- The scheduled backup needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` as
  repository secrets; until then the workflow reports Blocked on purpose.

### D. Blocked by test accounts

- Ten signed-in checks are BLOCKED: the saved test member address is not an email address (no
  "@"), so no sign-in was attempted. `npm run verify:live-membership` now says exactly that instead
  of blaming the app. Everything else it checks passes (13).

### E. Not implemented

- Failed sign-in history. Supabase's authentication does not provide a reliable, safe event, and
  Sophira will not infer one from an ordinary API error. The page states the gap.

### F. Deliberately not implemented

- Deploy and rollback controls (no tested rollback path).
- Per-feature individual activity tracking for analytics (a data-collection decision, not a code
  one).
- A second audit table, a second reader, or a client-side writer of any kind.


## This session: dependency, Windows, and UI foundation work (2026-10-15)

- Upgraded Next.js 14.2.35 to patched 15.5.28, moved `pdf-parse` to the
  current `serverExternalPackages` option, and migrated server cookies and
  page route parameters to the async API. Legal-document tracing is now
  recognized by Next.js, and the integrations page renders a user-facing
  access error instead of returning an API response as a page.
- Pinned the compatible PostCSS patch and overrode `image-size` to 2.0.4.
  `npm audit --omit=dev`: 0 critical, 0 high, 3 moderate (Mammoth's CLI-only
  `argparse`/`sprintf-js` chain). The full tree still reports 5 high and 5
  moderate development/build-tool findings; see `docs/SECURITY_UPGRADE.md`.
- Fixed Windows test portability: source assertions normalize CRLF, the
  doctoral-registry check no longer shells out to Unix `grep`, and generated
  `.env.example` verification accepts Windows line endings.
- Started the visual/accessibility redesign in the shared shell and student
  dashboard: added a keyboard skip link and main landmark, current-page
  semantics to navigation, reduced-motion support, and clearer hierarchy for
  the primary assignment/question actions. The repository contains 60
  user-facing page modules; only the dashboard received route-specific visual work
  in this pass. A default-viewport login screenshot was reviewed, but there
  was no authenticated dashboard or mobile-device review. The application-wide
  redesign remains incomplete.
- Verification: `npx tsc --noEmit` PASS; `npm run build` PASS on Next.js
  15.5.28; focused course-engine/navigation tests PASS (693 checks); secret
  scan CLEAN; environment-template check PASS; migration-runner self-test
  PASS. The earlier full `npm test` run passed 3747/3747 before this UI pass;
  its latest rerun did not complete because the existing `owner-system-health`
  integration's `scripts/health-json.mjs` subprocess reported `ETIMEDOUT`.
  The release gate reports
  21 PASS, 17 BLOCKED, 1 NOT RUN: live deployment/database/providers,
  security matrices, physical devices, and legal owner facts remain
  prerequisites. Its `--fast` mode skipped build/test/typecheck, which were
  run independently above.
- `npm run lint` remains blocked: Next.js prompts for ESLint configuration
  because the repository has no ESLint setup. Live migration verification
  also remains blocked without the Supabase Management API credentials.
- This session did not perform the requested application-wide visual
  redesign, authenticated browser workflows, or device review. No full
  redesign or live workflow completion is claimed. The release remains blocked on external
  configuration and live security/device/legal verification.

## This round: the false-green migration gate is closed

Verified root-cause chain (from the live workflow logs):
1. The Migrations CI job exits 0 with a notice when its optional Supabase
   credentials are absent — a green checkmark never proved migrations ran.
2. Both apply paths use frontier logic: migrations after the LAST marker are
   invisible and can be skipped forever (exactly what happened to 0035-0038,
   causing the live "backspaces" schema-cache error).

Fixes (all test-pinned):
- scripts/release-gate.mjs: the LIVE migration probe now verifies the NEWEST
  tail markers (typing_attempts.backspaces 0035, invitations.email_status
  0036, notebooks.archived_at 0037, teachers.archived_at 0038) instead of the
  stale 0034 table. A partially missing tail is FAIL with the exact repair
  action; missing credentials remain BLOCKED, never PASS.
- scripts/apply-migrations.mjs --self-test: recurrence guard — the newest
  migration in the chain MUST carry a probe marker.
- .github/workflows/migrations.yml: missing credentials emit an explicit
  "MIGRATIONS-LIVE-STATUS: BLOCKED_NO_CREDENTIALS" output, a job summary that
  states the run did NOT check the production database, and the two required
  secrets by name.

## Verification (final commit of this round)

- npm test: 3706/3706 PASS. npx tsc --noEmit: PASS. npm run build: PASS.
- Secret scan: CLEAN. apply-migrations --self-test: PASS.
- Release gate (--fast, no live credentials): exit 1 = BLOCKED, honest —
  live URL, live schema, live security, search, and invitation matrices are
  BLOCKED on owner-side credentials. This is the correct verdict, not a
  failure: the gate refuses to claim live verification it cannot perform.

## Standing truth table (unchanged unless evidence changes)

- Live production schema (0035-0038 columns): BLOCKED until the owner runs the
  /setup repair once or configures the two migration secrets.
- Live security matrices: BLOCKED on the test Supabase project.
- Backups / PITR / storage-object backups / restore drill: BLOCKED on owner
  access (docs/BACKUP_RECOVERY.md).
- OAuth (Word/Google), invitation email, live research providers: BLOCKED on
  owner registration/configuration.
- Physical device tests: NOT RUN.
- Legal publication: BLOCKED on owner facts + attorney review.

Release verdict: BLOCKED (owner-side verification outstanding; all
repository-side work is implemented, tested, and pushed).
