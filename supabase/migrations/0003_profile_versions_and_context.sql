-- 0003: Profile versioning, rollback support, and applied-context transparency.
--
-- Goals (spec §14, §22, §30):
--   * Every approved Teacher/Writing profile change snapshots the previous state.
--   * Students can view what changed and roll back to any previous version.
--   * Every AI response records which academic context was ACTUALLY applied
--     (teacher rules, course, writing profile, sources, conflicts) so the UI can
--     show real backend state, never a fabricated badge.

-- 1. Append-only profile version history (snapshots of the previous approved state).
create table if not exists public.profile_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('teacher', 'writing')),
  target_id uuid not null,          -- teacher_profiles.id or writing_profiles.id
  version int not null,            -- the version this snapshot represents
  change_summary text not null default '',
  source text not null default '', -- e.g. 'proposal:<id>' or 'rollback'
  approved_by uuid not null references public.profiles(id),
  snapshot jsonb not null,         -- full previous state, enabling rollback
  created_at timestamptz not null default now()
);

create index if not exists profile_versions_target_idx
  on public.profile_versions (user_id, target_type, target_id, created_at desc);

alter table public.profile_versions enable row level security;

create policy "Users manage only their own profile versions"
  on public.profile_versions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Writing profile change summaries (spec §14: change summary + source of change).
alter table public.writing_profiles
  add column if not exists change_summary text not null default '';

-- 3. Teacher profile versioning columns (spec §14).
alter table public.teacher_profiles
  add column if not exists version int not null default 1,
  add column if not exists change_summary text not null default '';

-- 4. Record what was ACTUALLY applied for each AI response (spec §40 honesty).
alter table public.responses
  add column if not exists context_applied jsonb;

-- context_applied shape:
-- {
--   "teacher": {"name": "...", "applied": true, "sources_used": [...], "fields_applied": [...]},
--   "course": {"name": "...", "applied": true},
--   "writing_profile": {"applied": false, "reason": "not a writing task"},
--   "classification": {...},
--   "conflicts": [{"a": "...", "b": "...", "detail": "..."}],
--   "verification_method": "computational" | "self_check" | "none"
-- }
