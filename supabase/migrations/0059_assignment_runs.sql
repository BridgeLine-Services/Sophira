-- =====================================================================
-- SOPHIRA migration 0059 — AUTONOMOUS ASSIGNMENT RUNS
-- (2026-11-15, directive Part 4)
--
-- A run is the durable record of one assignment carried through
-- plan → draft → audit → verify without the student requesting every
-- section. It is a NEW table: 0001-0058 are untouched, and nothing
-- existing is altered, dropped or renamed.
--
-- Honesty is enforced by the shape, not by convention:
--   * state is a closed set, and 'completed' is only written by the
--     server after every section is stored AND a verification verdict
--     is recorded (src/lib/essay/autonomous.ts canClaimCompletion).
--   * lease_token / lease_expires_at make a second worker's callback a
--     no-op instead of a duplicate generation.
--   * the unique partial index on (user_id, idempotency_key) refuses a
--     second live run for the same request.
--
-- No provider token, key or secret is ever stored here.
-- Strict per-user RLS, identical in shape to every other Sophira table.
-- =====================================================================

create table if not exists public.assignment_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- the artifact this run produces, when it uses an existing essay session
  essay_session_id uuid references public.essay_sessions(id) on delete set null,
  assignment_id uuid references public.assignments(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  teacher_id uuid references public.teachers(id) on delete set null,
  research_project_id uuid references public.research_projects(id) on delete set null,

  mode text not null default 'autonomous_draft'
    check (mode in ('autonomous_draft')),

  state text not null default 'queued'
    check (state in ('queued','analyzing','planning','researching','drafting',
                     'auditing','verifying','completed','blocked','failed','cancelled')),

  -- which step the runner has finished; monotonic, used for idempotency
  step_index int not null default 0 check (step_index >= 0),
  total_steps int not null default 0 check (total_steps >= 0),

  attempt int not null default 0 check (attempt >= 0),
  max_attempts int not null default 3 check (max_attempts between 1 and 10),

  -- one worker at a time; an expired lease may be taken over
  lease_token text,
  lease_expires_at timestamptz,

  -- duplicate-run prevention: unique per owner while the run is live
  idempotency_key text not null default 'default',

  -- what the student asked for (never contains a provider key)
  request jsonb not null default '{}'::jsonb,

  plan jsonb,
  outline jsonb,
  outline_approved boolean not null default false,
  sections jsonb not null default '[]'::jsonb,
  final_verification jsonb,
  -- unresolved limitations, shown to the student rather than hidden
  findings jsonb not null default '[]'::jsonb,
  progress jsonb not null default '{}'::jsonb,

  last_error text,
  -- the honest sentence describing what was actually produced
  completion_claim text,

  deadline timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  created_date timestamptz not null default now(),
  updated_date timestamptz not null default now()
);

alter table public.assignment_runs enable row level security;

drop policy if exists "Users read own assignment runs" on public.assignment_runs;
create policy "Users read own assignment runs" on public.assignment_runs
  for select using (auth.uid() = user_id);

drop policy if exists "Users insert own assignment runs" on public.assignment_runs;
create policy "Users insert own assignment runs" on public.assignment_runs
  for insert with check (auth.uid() = user_id);

drop policy if exists "Users update own assignment runs" on public.assignment_runs;
create policy "Users update own assignment runs" on public.assignment_runs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- no delete policy: a student cannot erase the record of a generated artifact,
-- and no member-facing route offers deletion.

-- One live run per owner per request. Cancelled and failed runs do not block a retry.
create unique index if not exists assignment_runs_one_live_per_key
  on public.assignment_runs (user_id, idempotency_key)
  where state <> 'cancelled' and state <> 'failed';

create index if not exists assignment_runs_owner_recent
  on public.assignment_runs (user_id, created_date desc);

create index if not exists assignment_runs_owner_state
  on public.assignment_runs (user_id, state);

-- the worker's sweep: runs that are live but not held by anyone
create index if not exists assignment_runs_resumable
  on public.assignment_runs (state, lease_expires_at)
  where state not in ('completed','cancelled','failed','blocked');

comment on table public.assignment_runs is
  'Durable record of one autonomous assignment run (migration 0059). Owner-scoped by RLS; created, advanced and completed only by the server.';
