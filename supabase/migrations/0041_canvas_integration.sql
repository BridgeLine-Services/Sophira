-- =====================================================================
-- 0041: CANVAS LMS INTEGRATION (2026-11-02)
--
-- Reuses the EXISTING token table rather than duplicating it: Canvas OAuth
-- tokens live in public.provider_connections alongside Google and Microsoft,
-- which is already RLS-enabled with NO client policies (service-role only).
-- Additive and reversible: every object created here can be dropped, and the
-- two provider_connections changes widen constraints without touching rows.
--
-- Why (user_id, canvas_*) uniques: Canvas ids are stable per instance, and a
-- student's sync must be idempotent — re-running it must not create duplicate
-- Sophira assignments or move one student's work onto another account.
-- =====================================================================

-- 1. Allow the canvas provider, and remember which Canvas instance the token
--    belongs to (Canvas OAuth is per-institution, unlike Google/Microsoft).
alter table public.provider_connections
  drop constraint if exists provider_connections_provider_check;
alter table public.provider_connections
  add constraint provider_connections_provider_check
  check (provider in ('microsoft', 'google', 'canvas'));

alter table public.provider_connections
  add column if not exists base_url text;

comment on column public.provider_connections.base_url is
  'Canvas instance origin (e.g. https://school.instructure.com). NULL for Google/Microsoft.';

-- 2. Courses discovered on the student's own Canvas account.
create table if not exists public.canvas_courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canvas_course_id text not null,
  name text not null,
  course_code text,
  workflow_state text,
  term_name text,
  instructor_name text,
  -- The Sophira course row this Canvas course is mapped to, so a sync reuses one
  -- course instead of creating a duplicate on every run.
  sophira_course_id uuid references public.courses(id) on delete set null,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, canvas_course_id)
);

-- 3. Assignments discovered through the Canvas API, with the metadata needed
--    to detect instruction / due-date / rubric / attachment changes.
create table if not exists public.canvas_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  canvas_course_id text not null,
  canvas_assignment_id text not null,
  title text not null default '',
  description text default '',
  due_at timestamptz,
  points_possible numeric,
  submission_types jsonb default '[]'::jsonb,
  html_url text,
  rubric jsonb,
  attachments jsonb default '[]'::jsonb,
  published boolean not null default true,
  content_fingerprint text,
  canvas_updated_at timestamptz,
  last_seen_at timestamptz not null default now(),
  -- 'missing' means Canvas no longer returns it (deleted or unshared); the row
  -- and the student's own work are kept so nothing is lost silently.
  sync_state text not null default 'active'
    check (sync_state in ('active', 'missing')),
  sophira_assignment_id uuid references public.assignments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, canvas_assignment_id)
);

-- 4. Audit trail for connections and synchronizations (no tokens, ever).
create table if not exists public.canvas_sync_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'connected', 'disconnected', 'sync_started', 'sync_completed', 'sync_failed',
    'assignment_new', 'assignment_updated', 'assignment_missing', 'attachment_failed'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 5. Owner-only RLS. Unlike provider_connections (tokens, service-role only),
--    these rows hold assignment metadata the student is entitled to see, so the
--    client may read them — but only their own.
alter table public.canvas_courses enable row level security;
alter table public.canvas_assignments enable row level security;
alter table public.canvas_sync_events enable row level security;

drop policy if exists "canvas_courses_own" on public.canvas_courses;
create policy "canvas_courses_own" on public.canvas_courses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "canvas_assignments_own" on public.canvas_assignments;
create policy "canvas_assignments_own" on public.canvas_assignments
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "canvas_sync_events_own" on public.canvas_sync_events;
create policy "canvas_sync_events_own" on public.canvas_sync_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists canvas_courses_user_idx
  on public.canvas_courses (user_id, canvas_course_id);
create index if not exists canvas_assignments_user_course_idx
  on public.canvas_assignments (user_id, canvas_course_id, canvas_assignment_id);
create index if not exists canvas_assignments_due_idx
  on public.canvas_assignments (user_id, due_at);
create index if not exists canvas_sync_events_user_idx
  on public.canvas_sync_events (user_id, created_at desc);
