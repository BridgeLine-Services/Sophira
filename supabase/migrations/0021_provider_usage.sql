-- =====================================================================
-- SOPHIRA migration 0021 — PROVIDER USAGE LOG (2026-10-06)
--
-- Server-side usage record for the owner provider-diagnostics screen.
-- Rows are written ONLY by API routes through the service-role client
-- (best-effort, never blocking an AI response). RLS is enabled with NO
-- policies: no client (owner included) can read or write through the
-- anon/authenticated role; only the service role (server) touches this
-- table. Contains NO user content and NO secrets — only provider id,
-- model, cost classification, success flag, and token counts.
-- =====================================================================

create table if not exists provider_usage (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  provider text not null,
  model text not null,
  classification text not null check (classification in ('local', 'free-tier', 'paid')),
  ok boolean not null,
  tokens_in integer,
  tokens_out integer
);

-- No client access at all — server/service-role only.
alter table provider_usage enable row level security;

create index provider_usage_created_at_idx on provider_usage (created_at desc);
