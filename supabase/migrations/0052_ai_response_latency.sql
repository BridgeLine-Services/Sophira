-- =====================================================================
-- 0052: AI RESPONSE TIME MEASUREMENT (2026-11-13)
--
-- WHY: the owner's AI Operations view can show how many AI requests succeeded
-- and how many failed, because provider_usage (0021) already records those.
-- It could NOT show how long an answer took, so "the AI feels slow" had no
-- evidence behind it either way. This adds ONE nullable column: the wall-clock
-- time a request took, in whole milliseconds.
--
-- PRIVACY: this is a number, like the token counts already stored. No prompt,
-- no answer, no question text, no member identifier and no provider secret is
-- written here. A row is a fact about Sophira's own performance, not about a
-- member's work.
--
-- SAFETY: additive and idempotent. Existing rows keep NULL, which is read as
-- "not measured" - never as 0 ms, and never averaged in as a fast request.
-- Nothing is backfilled, no table is rewritten, no policy changes, and no
-- client can read this table (RLS stays enabled with no policies, so only the
-- server's privileged client sees it).
-- =====================================================================

alter table if exists public.provider_usage
  add column if not exists latency_ms integer;

-- Guard the meaning of the number: a negative duration is a bug, not data.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'provider_usage')
     and not exists (
       select 1 from pg_constraint
       where conname = 'provider_usage_latency_ms_check'
         and conrelid = 'public.provider_usage'::regclass
     )
  then
    alter table public.provider_usage
      add constraint provider_usage_latency_ms_check
      check (latency_ms is null or (latency_ms >= 0 and latency_ms <= 3600000));
  end if;
end $$;

-- Reading the newest month of measurements is the only access pattern.
create index if not exists provider_usage_created_at_latency_idx
  on public.provider_usage (created_at desc)
  where latency_ms is not null;

-- No new grants and no new policy: the table remains service-role only.
