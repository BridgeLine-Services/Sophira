-- =====================================================================
-- SOPHIRA - Private AI Academic Assistant
-- Initial schema. All user data is isolated with Row Level Security (RLS):
-- a signed-in user can only ever read/write rows where user_id = auth.uid().
-- Run this in the Supabase SQL editor (or supabase db push).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- profiles: one row per user, id matches auth.users
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  role text not null default 'user' check (role in ('owner','user')),
  academic_level text,
  explanation_level text,             -- e.g. 'simple','standard','advanced'
  answer_style text,
  formatting_pref text,
  learning_prefs jsonb default '{}',
  accessibility_prefs jsonb default '{}',
  preferred_language text,
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "profiles_select_own" on public.profiles for select using (id = auth.uid());
create policy "profiles_update_own" on public.profiles for update using (id = auth.uid());
-- inserts happen via the trigger below (service role).

-- auto-create a profile when a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', ''),
    case when not exists (select 1 from public.profiles) then 'owner' else 'user' end
  );
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- invitations: owner-controlled onboarding for a small private group
-- ---------------------------------------------------------------------
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token text not null unique default encode(gen_random_bytes(24),'hex'),
  status text not null default 'pending' check (status in ('pending','accepted','revoked')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
alter table public.invitations enable row level security;
create policy "invitations_owner_manage" on public.invitations
  for all using (invited_by = auth.uid()) with check (invited_by = auth.uid());

-- Anonymous lookup of ONE pending invitation by token is required for signup.
-- Exposed as a SECURITY DEFINER function instead of a permissive select policy.
create or replace function public.get_invitation_by_token(p_token text)
returns public.invitations
language sql
security definer set search_path = public
as $$
  select * from public.invitations
  where token = p_token and status = 'pending';
$$;
grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- teachers + teacher_profiles
-- teacher_profiles keeps sections explicitly separated:
--   official_* (from teacher), examples (teacher-provided worked examples),
--   corrections (graded feedback), and ai_notes (unconfirmed AI guesses).
-- ---------------------------------------------------------------------
create table public.teachers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  notes text default '',
  created_at timestamptz not null default now()
);
alter table public.teachers enable row level security;
create policy "teachers_own" on public.teachers
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.teacher_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  -- structured teacher requirements
  required_methods text default '',
  required_steps text default '',
  preferred_notation text default '',
  units_sig_figs text default '',
  formatting_requirements text default '',
  citation_requirements text default '',
  essay_structure text default '',
  lab_report_requirements text default '',
  preferred_terminology text default '',
  show_work_rules text default '',
  calculator_rules text default '',
  allowed_tools text default '',
  prohibited_tools text default '',
  -- official documents / rubrics with source references
  rubrics jsonb default '[]',              -- [{title, content, source, source_date}]
  official_instructions jsonb default '[]',-- [{title, content, source, source_date}]
  -- teacher-provided worked examples
  examples jsonb default '[]',             -- [{title, content, source, source_date}]
  -- feedback / corrections from graded work (confirmed by the student)
  corrections jsonb default '[]',           -- [{content, source, source_date}]
  -- AI-generated interpretations NOT yet confirmed (never treated as official)
  ai_notes jsonb default '[]',             -- [{note, proposed, status}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id)
);
alter table public.teacher_profiles enable row level security;
create policy "teacher_profiles_own" on public.teacher_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- courses
-- ---------------------------------------------------------------------
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  subject text,
  academic_level text,
  institution text,
  term text,
  teacher_id uuid references public.teachers(id) on delete set null,
  instructions text default '',
  created_at timestamptz not null default now()
);
alter table public.courses enable row level security;
create policy "courses_own" on public.courses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- writing samples + writing profile
-- ---------------------------------------------------------------------
create table public.writing_samples (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  genre text,                             -- essay, discussion post, lab report...
  course_id uuid references public.courses(id) on delete set null,
  academic_level text,
  sample_date date,
  representativeness text not null default 'neutral'
    check (representativeness in ('preferred','neutral','not_representative')),
  content text not null,
  created_at timestamptz not null default now()
);
alter table public.writing_samples enable row level security;
create policy "writing_samples_own" on public.writing_samples
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.writing_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  summary jsonb default '{}',   -- analyzed style patterns
  guidance text default '',     -- distilled writing guidance for the AI
  status text not null default 'draft' check (status in ('draft','approved')),
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.writing_profiles enable row level security;
create policy "writing_profiles_own" on public.writing_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- assignments, files, work sessions, responses
-- ---------------------------------------------------------------------
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  course_id uuid references public.courses(id) on delete set null,
  teacher_id uuid references public.teachers(id) on delete set null,
  mode text not null default 'assignment'
    check (mode in ('learn','assignment','check','writing','study','explain','custom')),
  subject text,
  academic_level text,
  task_type text,
  output_type text,
  instructions_text text default '',
  status text not null default 'active'
    check (status in ('active','completed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.assignments enable row level security;
create policy "assignments_own" on public.assignments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.assignment_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  file_name text not null,
  storage_path text not null,   -- private Supabase storage bucket path
  mime_type text,
  extracted_text text default '',
  extraction_confidence text default 'unprocessed'
    check (extraction_confidence in ('unprocessed','high','medium','low','failed')),
  extraction_notes text default '',
  created_at timestamptz not null default now()
);
alter table public.assignment_files enable row level security;
create policy "assignment_files_own" on public.assignment_files
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete cascade,
  mode text not null default 'assignment',
  messages jsonb default '[]',  -- [{role:'user'|'assistant', content, meta}]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.work_sessions enable row level security;
create policy "work_sessions_own" on public.work_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete cascade,
  session_id uuid references public.work_sessions(id) on delete cascade,
  content text not null,
  mode text,
  verification jsonb default '{}',  -- {status, checks:[], warnings:[]}
  model_used text,
  created_at timestamptz not null default now()
);
alter table public.responses enable row level security;
create policy "responses_own" on public.responses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- feedback + profile_update_proposals (approval-controlled learning loop)
-- ---------------------------------------------------------------------
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  response_id uuid references public.responses(id) on delete set null,
  assignment_id uuid references public.assignments(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  teacher_id uuid references public.teachers(id) on delete set null,
  kind text not null check (kind in ('approve','error','correction','teacher_wanted','writing_pref','note')),
  comment text default '',
  content text default '',
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
create policy "feedback_own" on public.feedback
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.profile_update_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null check (target_type in ('teacher','writing')),
  target_id uuid,                -- teacher id or writing profile id
  change_summary text not null,
  proposed_changes jsonb not null default '{}',  -- field -> new value
  context jsonb default '{}',    -- assignment/course/feedback ids
  status text not null default 'pending'
    check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
alter table public.profile_update_proposals enable row level security;
create policy "profile_update_proposals_own" on public.profile_update_proposals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- study_materials: personal library
-- ---------------------------------------------------------------------
create table public.study_materials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in
    ('assignment','course','teacher_instructions','worked_example','writing_sample',
     'writing_profile','study_guide','practice_question','note','ai_response','correction')),
  title text not null,
  content text default '',
  tags text[] default '{}',
  assignment_id uuid references public.assignments(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.study_materials enable row level security;
create policy "study_materials_own" on public.study_materials
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Private storage bucket for uploaded documents
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('private-docs', 'private-docs', false)
  on conflict (id) do nothing;

-- Users can manage files ONLY inside their own uid folder.
create policy "private_docs_own_select" on storage.objects
  for select using (bucket_id = 'private-docs' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "private_docs_own_insert" on storage.objects
  for insert with check (bucket_id = 'private-docs' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "private_docs_own_update" on storage.objects
  for update using (bucket_id = 'private-docs' and auth.uid()::text = (storage.foldername(name))[1]);
create policy "private_docs_own_delete" on storage.objects
  for delete using (bucket_id = 'private-docs' and auth.uid()::text = (storage.foldername(name))[1]);

-- ---------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles
  for each row execute procedure public.touch_updated_at();
create trigger teacher_profiles_touch before update on public.teacher_profiles
  for each row execute procedure public.touch_updated_at();
create trigger writing_profiles_touch before update on public.writing_profiles
  for each row execute procedure public.touch_updated_at();
create trigger assignments_touch before update on public.assignments
  for each row execute procedure public.touch_updated_at();
create trigger work_sessions_touch before update on public.work_sessions
  for each row execute procedure public.touch_updated_at();
