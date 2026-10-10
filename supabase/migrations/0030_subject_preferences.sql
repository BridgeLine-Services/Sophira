-- 0030: subject-level preferences (Foreign Language selector and any future
-- per-subject settings). Owned strictly by the authenticated user via RLS.
create table if not exists public.subject_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject text not null,
  target_language text,
  explanation_language text,
  proficiency text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, subject)
);

alter table public.subject_preferences enable row level security;

create policy "subject_preferences_own_all"
  on public.subject_preferences
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.subject_preferences to authenticated;
