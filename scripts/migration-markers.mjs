/**
 * SHARED migration marker table (2026-10-07).
 *
 * Single source of truth for 'which database object proves migration N is
 * applied'. Consumed by BOTH the CI pipeline (scripts/apply-migrations.mjs)
 * AND the runtime first-launch wizard (via scripts/gen-db-migrations.mjs
 * -> src/lib/db-migrations.generated.ts), so the two can never disagree.
 */
export const MARKERS = {
  "0001_init.sql": "to_regclass('public.profiles') is not null",
  "0008_invitation_only_signup.sql": "to_regclass('public.app_config') is not null",
  "0019_access_revocation_audit.sql":
    "exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='access_revoked_at')",
  "0020_student_memory.sql": "to_regclass('public.student_memories') is not null",
  "0021_provider_usage.sql": "to_regclass('public.provider_usage') is not null",
  "0022_notebooks.sql": "to_regclass('public.notebooks') is not null",
  "0023_essay_sessions.sql": "to_regclass('public.essay_sessions') is not null",
  "0024_profile_status_constraint.sql":
    "exists(select 1 from pg_constraint where conname='profiles_status_check' and conrelid='public.profiles'::regclass)",
  "0025_first_owner_bootstrap.sql": "to_regclass('public.owner_bootstrap') is not null",
  "0026_first_owner_recovery.sql":
    "exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='complete_first_owner' and n.nspname='public')",
  "0027_grants_backfill.sql":
    "exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'SELECT')",
};
