-- =====================================================================
-- 0040: DOCUMENT HISTORY (cross-provider, 2026-10-26)
-- Owner-scoped record of document operations Sophira PERFORMED and
-- versions it actually OBSERVED. This is NOT an authorship detector and
-- stores no tokens. Snapshots (canonical text for Google Docs) are private
-- student work: RLS owner-only reads; writes happen exclusively through
-- the service role in /api/integrations/* routes.
-- Additive + reversible (dropping the table restores the prior schema).
-- =====================================================================

create table if not exists public.document_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google','microsoft')),
  provider_document_id text not null,
  selection_id uuid references public.workload_selections(id) on delete set null,
  document_title text,
  document_url text,
  event_type text not null check (event_type in (
    'document_discovered','baseline_captured','document_read','draft_prepared',
    'insertion_attempted','insertion_confirmed','document_created',
    'replacement_attempted','replacement_confirmed',
    'external_change_observed','conflict_detected',
    'restore_attempted','restore_completed','restore_refused'
  )),
  actor text not null check (actor in ('user','sophira','external','provider')),
  provenance text not null check (provenance in (
    'sophira-generated','sophira-inserted','user-requested','user-confirmed',
    'external-observed','provider-reported','unknown'
  )),
  outcome text not null check (outcome in ('pending','confirmed','failed','conflicted','unavailable')),
  sequence integer not null,
  provider_revision text,
  previous_revision text,
  content_fingerprint text,
  previous_fingerprint text,
  snapshot_text text,
  snapshot_truncated boolean not null default false,
  snapshot_format text,
  target_section text,
  summary text not null,
  error_category text,
  diff_summary jsonb,
  observed_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  parent_event_id uuid references public.document_history(id) on delete set null,
  unique (user_id, provider, provider_document_id, sequence)
);

alter table public.document_history enable row level security;

-- The OWNER may read their own history. There are deliberately NO insert,
-- update, or delete policies: history rows are written only by the service
-- role inside authenticated API routes, so a client cannot forge or erase
-- events (and cannot insert rows for another user).
create policy "own document history: read"
  on public.document_history for select to authenticated
  using (auth.uid() = user_id);

create index if not exists document_history_doc_idx
  on public.document_history (user_id, provider, provider_document_id, sequence desc);

create index if not exists document_history_user_time_idx
  on public.document_history (user_id, recorded_at desc);
