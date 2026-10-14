# Backup and Recovery Runbook (2026-10-13)

Honest status labels used below: **Configured and verified**, **Configured but
not restore-tested**, **Documented but not configured**, **Blocked**.

## Current state

| Capability | Status | Evidence / next action |
| --- | --- | --- |
| Additive, non-destructive migrations | Configured and verified | Migrations 0001-0038 apply `if not exists` / `add column if not exists`; CI Migrations workflow green on every push |
| Deployment does not touch user data | Configured and verified | Vercel deploys app code only; no reset/recreate steps exist in the release pipeline |
| Archive lifecycle as accidental-removal recovery | Configured and verified | Removal from the active workspace archives (0037/0038); restore returns the original row (tested, 3661 assertions) |
| Supabase automated database backups | Documented but not configured | Supabase takes daily backups on Pro projects; free-tier backup retention is minimal. Owner action: confirm the project's plan in the Supabase dashboard → Settings → Add-ons |
| Point-in-time recovery (PITR) | Blocked | PITR is a Pro add-on the owner must enable from the Supabase dashboard; this agent has no project access |
| Uploaded-file (storage bucket) backups | Blocked | Database backups do NOT include storage objects. Owner action: enable a storage-level backup strategy (Supabase docs: Storage → backups, or an external sync) |
| Restore drills in an isolated environment | Blocked | Requires the owner's separate test Supabase project (already listed in docs/WHAT_I_NEED_TO_DO_NEXT.md) |

## Recommended targets

- RPO: 24h with daily managed backups; down to minutes with PITR enabled.
- RTO: under 2h for app-only failures (Vercel rollback); under 24h for a
  database restore (owner-executed via the Supabase dashboard).

## Recovery procedures

1. **Accidental archive** — open the notebooks Archive page and Restore.
   The original row returns with its original ID and relationships.
2. **Bad application deployment** — Vercel dashboard → Deployments →
   Instant Rollback. Database and storage are untouched by a rollback.
3. **Failed/partial migration** — all migrations are `if not exists`-guarded
   and idempotent; re-running the Migrations workflow completes safely.
4. **Database corruption / accidental modification** — Supabase dashboard →
   Database → Backups → restore a point-in-time snapshot (Pro). Requires the
   owner's dashboard access; never attempt from application code.
5. **Missing/corrupted uploaded file** — restore the storage object via the
   Supabase dashboard (or the storage-level backup strategy chosen in the
   Blocked row above); the database row keeps its provenance intact.
6. **Verified owner visibility after restore** — every restored row keeps its
   original `user_id`; RLS continues to scope it to its owner.

No backup claim in this document is based on a configuration this agent could
not see. Everything marked Blocked requires owner-side access.


## Deployment and migration incident response matrix

| Scenario | Detection signal | Safe immediate response | App rollback enough? | DB restore needed? | Files? | Verify before reopening |
|---|---|---|---|---|---|---|
| Bad application deployment | CI red on the deploy commit; health check fails; users report breakage | Vercel "Instant Rollback" to the previous deployment (code only — it never touches the database) | Yes | No | No | Health workflow + login + one active workflow on the rolled-back build |
| Failed/partially applied migration | Migrations workflow fails on a commit | STOP: do not redeploy. The migration chain is idempotent (`add column if not exists`), so re-running after fixing the migration is safe | No | No — re-apply forward | No | Migration workflow green + app boots + active lists render |
| Migration applied but runtime defect appears | Health/tests fail post-deploy | Roll the app back (old code is forward-compatible: new columns are nullable and unused by old code) then fix forward | Usually yes (additive-only policy) | No | No | Full suite + targeted workflow |
| Broken integration config | Integrations page reports "not configured" honestly | Fix the provider env/registration; no data is at risk | n/a | No | No | Connect flow completes end to end |
| Email provider unavailable | Invitation shows `failed` status with a safe reason | Owner copies the invitation link manually; retry when the provider recovers | n/a | No | No | Invitation status returns "sent" |
| Missing/inaccessible stored file | Library entry shows an honest missing-file error | Restore the object from storage recovery, or remove the entry through Archive | No | Only if bucket objects were lost | Yes | Signed URL opens; owner-only |
| Accidental archival | Record missing from active list | Archive page -> Restore (original ID preserved) | No | No | No | Record reappears in active list |
| Accidental permanent deletion / corruption | User report; record gone even from Archive | Supabase PITR (Pro add-on, owner-gated) to a point before the event — evaluate data-loss window FIRST; never restore over newer valid data | No | Yes (PITR to a clean branch, then selective recovery) | If files affected | Ownership intact; RLS active; counts consistent |

**Golden rule for every scenario:** application rollback and database recovery are INDEPENDENT. Never roll back the database merely because code failed, and never restore an old snapshot over newer valid user data without a data-loss evaluation.

## Schema-drift incident and fix (2026-10-14)

Evidence: the live typing error ("Could not find the 'backspaces' column of
'typing_attempts' in the schema cache") while the Migrations workflow reported
success. Root cause, verified from the workflow definition and logs: the job
exits 0 with a notice when its two optional Supabase credentials are absent,
and the apply/wizard logic only applied unmarked tail migrations after the
first missing MARKED migration — 0035-0038 had no markers, so they were
skipped everywhere. Status before fix: **Unknown schema state reported as
applied**. Fix: markers for 0035-0038 (probe-verifiable column checks) so both
the CI job and the runtime wizard detect the gap and apply the idempotent
migrations. Status after fix: **code verified; live schema verification
Blocked** until the owner runs /setup repair or configures the CI credentials —
only then can "backspaces exists in production" be claimed as Verified.
