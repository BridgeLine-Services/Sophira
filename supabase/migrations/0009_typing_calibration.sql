-- =====================================================================
-- SOPHIRA migration 0009 — typing calibration persistence (spec §9)
--
-- src/lib/typing.ts computes WPM / accuracy / net WPM from a raw attempt
-- (unit-tested, unchanged). This migration stores attempts and the
-- user-selected baseline with strict per-user RLS:
--
--   * every attempt is recomputed SERVER-SIDE from the submitted raw
--     attempt against the canonical reference passage (see
--     src/lib/typing-passage.ts) — the client only ever sends the typed
--     text and its own timestamps; the server derives and persists the
--     metrics, so a tampered client cannot store a fake speed.
--   * the typed text itself is NEVER stored (privacy: only the metrics).
--   * at most ONE baseline attempt per user is enforced by a partial
--     unique index, so "select baseline" is atomic and unambiguous.
--   * RLS: user_id = auth.uid() on every operation — the owner or any
--     other member can never read another user's typing history.
-- =====================================================================

create table if not exists public.typing_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  test_date timestamptz not null default now(),
  duration_ms bigint not null check (duration_ms > 0),
  characters_typed int not null check (characters_typed >= 0),
  wpm numeric not null check (wpm >= 0),
  accuracy numeric not null check (accuracy >= 0 and accuracy <= 1),
  net_wpm numeric not null check (net_wpm >= 0),
  valid_attempt boolean not null default false,
  flags text[] not null default '{}',
  is_baseline boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists typing_attempts_user_idx
  on public.typing_attempts (user_id, created_at desc);

-- At most one selected baseline per user.
create unique index if not exists typing_attempts_one_baseline
  on public.typing_attempts (user_id) where is_baseline;

alter table public.typing_attempts enable row level security;

create policy "typing_attempts_own_all"
  on public.typing_attempts for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Baseline selection is done through the API route with a single
-- transactional UPDATE (clear the old baseline, set the new one) because
-- two statements from the client would briefly violate the unique index.
-- The route uses the user's own RLS-scoped client, so it stays per-user.

-- Atomic baseline selection: one statement pair inside a single function
-- call, invoker-security so RLS still applies. Only a VALID attempt owned
-- by the caller can become the baseline (an invalid/suspicious attempt
-- can never be selected).
create or replace function public.select_typing_baseline(p_attempt_id uuid)
returns void
language plpgsql
security invoker set search_path = public
as $$
begin
  update public.typing_attempts
     set is_baseline = false
   where user_id = auth.uid() and is_baseline;

  update public.typing_attempts
     set is_baseline = true
   where id = p_attempt_id and user_id = auth.uid() and valid_attempt = true;

  if not found then
    raise exception 'That attempt is not an eligible baseline (it must be a valid attempt of your own).'
      using errcode = '42501';
  end if;
end;
$$;
grant execute on function public.select_typing_baseline(uuid) to authenticated;
