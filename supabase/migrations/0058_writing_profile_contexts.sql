-- 0058: CONTEXT-SPECIFIC WRITING PROFILES (2026-11-13, directive Part 5).
--
-- Before this, a student had ONE writing profile: every sample fed the same
-- analysis, and one approved guidance blob was applied to every piece of
-- writing - an essay, a text message, an email to an employer. Students write in
-- different registers and were being flattened into one voice.
--
-- This migration ADDS that distinction: a profile, and a sample, now declares
-- which context it belongs to (academic, casual, professional). It also adds
-- style_closeness, the student-controlled 0-100 dial for how strongly the
-- approved guidance is applied.
--
-- PURELY ADDITIVE. No row is deleted, merged or rewritten, no column is dropped
-- or retyped, and no constraint is added that existing rows could violate:
--
--   * BOTH new text columns default to 'academic' and are NOT NULL, so every
--     existing profile and sample becomes an ACADEMIC one automatically. That is
--     the correct reading of the old data: until now there was one
--     undifferentiated profile, and every existing writing workflow is academic.
--   * style_closeness defaults to 70, the neutral middle used by the app.
--   * NO uniqueness constraint is introduced. writing_profiles has never been
--     unique per student (0001/0003 kept a version column and the app reads the
--     newest row per student), and existing data may already hold several rows.
--     Adding one here could fail on live data, so it is deliberately absent.
--
-- RLS IS UNCHANGED: both tables keep their existing "own row only" policies from
-- 0001_init.sql, and nothing added here widens who can read a profile or sample.
-- A student still sees only their own writing.
--
-- The indexes are for the reads this feature performs: "my profiles in this
-- context" and "my samples in this context".

alter table public.writing_profiles
  add column if not exists profile_context text not null default 'academic';
alter table public.writing_profiles
  add column if not exists style_closeness int not null default 70;

alter table public.writing_samples
  add column if not exists profile_context text not null default 'academic';

-- Allowed values. Added separately and guarded so re-running this file is safe,
-- and named so a future migration can find them by name rather than by guess.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'writing_profiles_profile_context_check'
      and conrelid = 'public.writing_profiles'::regclass
  ) then
    alter table public.writing_profiles
      add constraint writing_profiles_profile_context_check
      check (profile_context in ('academic', 'casual', 'professional'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'writing_profiles_style_closeness_check'
      and conrelid = 'public.writing_profiles'::regclass
  ) then
    alter table public.writing_profiles
      add constraint writing_profiles_style_closeness_check
      check (style_closeness between 0 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'writing_samples_profile_context_check'
      and conrelid = 'public.writing_samples'::regclass
  ) then
    alter table public.writing_samples
      add constraint writing_samples_profile_context_check
      check (profile_context in ('academic', 'casual', 'professional'));
  end if;
end $$;

create index if not exists writing_profiles_user_context_idx
  on public.writing_profiles (user_id, profile_context, created_at desc);
create index if not exists writing_samples_user_context_idx
  on public.writing_samples (user_id, profile_context, created_at desc);

comment on column public.writing_profiles.profile_context is
  'Which register this profile describes: academic, casual or professional. Existing rows are academic.';
comment on column public.writing_profiles.style_closeness is
  'How strongly the approved guidance is applied, 0-100. A student preference, not an AI proposal.';
comment on column public.writing_samples.profile_context is
  'Which register this sample represents, so casual samples never feed academic analysis.';
