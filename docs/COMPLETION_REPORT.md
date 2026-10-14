# Sophira Completion Report (latest round: 2026-10-14)

> Evidence-based status only. Historical rounds remain in git history.

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
