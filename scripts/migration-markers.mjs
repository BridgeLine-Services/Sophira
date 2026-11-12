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
  "0028_network_stats_repair.sql":
    "exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'network_stats' and n.nspname = 'public' and p.proargnames is not null and p.proargnames[1] = 'o_user_id')",
  "0032_provider_connections.sql": "to_regclass('public.provider_connections') is not null",
  "0033_provider_connection_metadata.sql":
    "exists(select 1 from information_schema.columns where table_schema='public' and table_name='provider_connections' and column_name='granted_scopes')",
  "0034_workload_selections.sql":
    "to_regclass('public.workload_selections') is not null",
  "0035_typing_event_metrics.sql":
    "exists(select 1 from information_schema.columns where table_schema='public' and table_name='typing_attempts' and column_name='backspaces')",
  "0036_invitation_email_status.sql":
    "exists(select 1 from information_schema.columns where table_schema='public' and table_name='invitations' and column_name='email_status')",
  "0037_workspace_archive.sql":
    "exists(select 1 from information_schema.columns where table_schema='public' and table_name='notebooks' and column_name='archived_at')",
  "0038_teacher_material_archive.sql":
    "exists(select 1 from information_schema.columns where table_schema='public' and table_name='teachers' and column_name='archived_at')",
  "0039_supabase_security_hardening.sql":
    "exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'touch_updated_at' and n.nspname = 'public' and p.proconfig::text like '%search_path%' and p.proconfig::text not like '%public, pg_temp%')",
  "0040_document_history.sql": "to_regclass('public.document_history') is not null",
  "0041_canvas_integration.sql": "to_regclass('public.canvas_assignments') is not null",
  "0042_member_notifications.sql": "to_regclass('public.member_notifications') is not null",
  "0043_member_phone.sql": "exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'phone')",
  // 0044 (media ingestion) had no marker, so the self-test refused the whole
  // chain and the Migrations workflow failed on master. The probe checks the
  // last table it creates, which only exists once the migration really ran.
  "0044_media_ingestion.sql": "to_regclass('public.media_frames') is not null",
  // 0045 (response edits) had no marker, so the Migrations workflow failed again at
  // #289 exactly like 0044 did. The probe asks for the column that migration adds,
  // so it is false before the migration and true only once it really ran.
  "0047_memory_teacher_assignment_scope.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_memories' and column_name = 'assignment_id')",
  "0048_membership_roles.sql":
    "exists (select 1 from pg_constraint where conname = 'profiles_role_check' and pg_get_constraintdef(oid) like '%co_owner%')",
  "0049_member_phone_verification.sql":
    "exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'network_member_phones' and n.nspname = 'public' and 'verified' = any(p.proargnames))",
  "0050_member_presence.sql":
    "to_regclass('public.member_presence') is not null",
  // 0051 changes a function's signature and four policies, so the probe asks for the
  // invitation policy by name: it exists only once this migration really ran, and the
  // directory's academic columns are checked by its own test.
  "0051_directory_privacy_and_staff_invitations.sql":
    "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'invitations' and policyname = 'invitations_staff_insert')",
  "0046_response_provenance.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'responses' and column_name = 'provider_used')",
  "0045_response_edits.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'responses' and column_name = 'updated_at')",
  // backfilled 2026-11-11 so a skip of this migration is detectable
  "0003_profile_versions_and_context.sql":
    "to_regclass('public.profile_versions') is not null",
  // backfilled 2026-11-11 so a skip of this migration is detectable
  "0004_sources_and_audit.sql":
    "to_regclass('public.academic_sources') is not null",
  // backfilled 2026-11-11 so a skip of this migration is detectable
  "0005_owner_membership_and_learning.sql":
    "to_regclass('public.invitation_requests') is not null",
  // backfilled 2026-11-11 so a skip of this migration is detectable
  "0009_typing_calibration.sql":
    "to_regclass('public.typing_attempts') is not null",
  // backfilled 2026-11-11 so a skip of this migration is detectable
  "0010_deadline_scheduling.sql":
    "to_regclass('public.work_schedules') is not null",
  // backfilled 2026-11-11 so a skip of this migration is detectable
  "0011_rubric_audits.sql":
    "to_regclass('public.rubric_audits') is not null",
  // backfilled 2026-11-11 so a skip of this migration is detectable
  "0012_research_tables.sql":
    "to_regclass('public.research_projects') is not null",
  // backfilled 2026-11-11 so a skip of this migration is detectable
  "0017_schedule_executions.sql":
    "to_regclass('public.schedule_executions') is not null",
  // backfilled 2026-11-11 so a skip of this migration is detectable
  "0018_adaptive_typing_profile.sql":
    "to_regclass('public.typing_profiles') is not null",
  // backfilled 2026-11-11 so a skip of this migration is detectable
  "0030_subject_preferences.sql":
    "to_regclass('public.subject_preferences') is not null",
  // backfilled 2026-11-11: there was no probe, so CI could not tell whether it ran.
  "0002_owner_only_invitations.sql":
    "exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_insert_own')",
  // backfilled 2026-11-11: there was no probe, so CI could not tell whether it ran.
  "0006_invitation_expiry.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invitations' and column_name = 'expires_at')",
  // backfilled 2026-11-11: there was no probe, so CI could not tell whether it ran.
  "0007_intentional_habits.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_patterns' and column_name = 'intentional')",
  // backfilled 2026-11-11: there was no probe, so CI could not tell whether it ran.
  "0013_claim_evidence.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'research_claims' and column_name = 'claim_id')",
  // backfilled 2026-11-11: there was no probe, so CI could not tell whether it ran.
  "0014_source_authority.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'research_sources' and column_name = 'authority_category')",
  // backfilled 2026-11-11: there was no probe, so CI could not tell whether it ran.
  "0015_submission_gate.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'responses' and column_name = 'submission_gate')",
  // backfilled 2026-11-11: there was no probe, so CI could not tell whether it ran.
  "0016_pattern_evidence.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'learning_patterns' and column_name = 'confirmation_count')",
  // backfilled 2026-11-11: there was no probe, so CI could not tell whether it ran.
  "0029_study_materials_course.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'study_materials' and column_name = 'course_id')",
  // backfilled 2026-11-11: there was no probe, so CI could not tell whether it ran.
  "0031_student_memory_course_scope.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_memories' and column_name = 'course_id')",
  // 0052: the AI response-time column behind the owner's AI Operations view.
  "0052_ai_response_latency.sql":
    "exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'provider_usage' and column_name = 'latency_ms')",
  // 0053: the administrative history beyond role changes. The probe asks for the function
  // that writes the other categories, which only exists once this migration really ran.
  "0053_admin_audit_events.sql":
    "exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'record_admin_event' and n.nspname = 'public')",
  "0054_tester_workspace_and_learning_goals.sql": "to_regclass('public.qa_reports') is not null",
  "0055_announcements.sql": "to_regclass('public.announcements') is not null",
  // 0056: the staff-gated per-day counts behind the dashboard charts. The probe asks for the
  // function itself, which only exists once this migration really ran.
  "0056_network_activity_series.sql":
    "exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'network_activity_daily' and n.nspname = 'public')",
};
