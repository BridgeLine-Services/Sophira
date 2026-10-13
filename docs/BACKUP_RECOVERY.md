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
