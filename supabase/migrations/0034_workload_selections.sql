-- =====================================================================
-- 0034: WORKLOAD SELECTIONS (document access + explicit scope, 2026-10-12)
-- A selection records WHICH provider document the AUTHENTICATED user
-- chose for a Sophira task, plus their EXPLICIT workload scope (section,
-- questions, deliverables). It is the boundary record for the personal
-- AI workload rule: Sophira processes only the authenticated member's
-- selected workload, never a non-member's work.
-- Owner-scoped like other private user records: RLS ON with
-- authenticated, owner-only policies (NOT service-role-only like
-- provider_connections 0032 — these rows carry no secrets; they carry
-- the user's own task choices and are needed by the user's own client).
-- Additive + reversible.
-- =====================================================================

create table if not exists public.workload_selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('microsoft','google')),
  provider_document_id text not null,
  document_title text,
  document_url text,
  access_state text not null default 'unverified' check (access_state in ('unverified','read','write')),
  scope_description text,
  content_fingerprint text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, provider_document_id)
);

alter table public.workload_selections enable row level security;

create policy "own selections: read"
  on public.workload_selections for select to authenticated
  using (auth.uid() = user_id);

create policy "own selections: insert"
  on public.workload_selections for insert to authenticated
  with check (auth.uid() = user_id);

create policy "own selections: update"
  on public.workload_selections for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "own selections: delete"
  on public.workload_selections for delete to authenticated
  using (auth.uid() = user_id);

create index if not exists workload_selections_user_idx
  on public.workload_selections (user_id);
