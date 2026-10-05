-- =====================================================================
-- SOPHIRA migration 0013 — full claim→evidence traceability
-- (research-integrity round, 2026-10-05)
--
-- Requirement: every substantive factual claim must trace
--   CLAIM → SOURCE → EXACT SUPPORTING PASSAGE → SOURCE URL → STATUS
-- and may be VERIFIED only when the retrieved content actually supports
-- it — never merely because the URL resolves / page exists / title
-- matches / domain is reputable.
--
-- The research_claims table (0012) already held claim/source/evidence/
-- status. This migration ADDS the required trace fields and the new
-- 'unverified' status (a claim whose source content is unavailable can
-- never be verified — it is marked unverified, never guessed). Existing
-- columns and values are untouched.
-- =====================================================================

alter table public.research_claims
  add column if not exists claim_id text not null default '',          -- stable server-assigned label (C1, C2, ...)
  add column if not exists assignment_id uuid references public.assignments(id) on delete set null,
  add column if not exists source_url text not null default '',        -- denormalized trace: URL the claim cites
  add column if not exists source_title text not null default '',     -- denormalized trace: verified page title
  add column if not exists evidence_start int,                        -- char offsets into stored content_extract
  add column if not exists evidence_end int,
  add column if not exists confidence real not null default 0,        -- deterministic 0..0.95, never 1.0
  add column if not exists authority_score int not null default 0,    -- deterministic 1..9 from the source record
  add column if not exists verified_at timestamptz,
  add column if not exists reasons jsonb not null default '[]'::jsonb; -- machine-readable verification reasons

-- Extend the status check with 'unverified' (source content unavailable /
-- no passage supplied — never guessed, never silently verified).
alter table public.research_claims
  drop constraint if exists research_claims_status_check;
alter table public.research_claims
  add constraint research_claims_status_check
  check (status in ('supported','partially_supported','unsupported','missing','verified','unverified'));

-- Statuses stored by the new pipeline (verified/partially_supported/
-- unsupported/unverified) map onto the legacy values as: supported↔verified,
-- missing↔unverified. Both spellings are kept valid so historical rows
-- remain queryable.

create index if not exists research_claims_project_response_idx
  on public.research_claims (project_id, response_id);

-- Latest research-integrity report for a project (counts + failures +
-- research_complete), stored with the response id it belongs to.
alter table public.research_projects
  add column if not exists research_integrity jsonb;
