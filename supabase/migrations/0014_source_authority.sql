-- =====================================================================
-- SOPHIRA migration 0014 — assignment-aware source authority (2026-10-05)
--
-- The research ranking system now classifies each assignment/research
-- task (history, science, current events, literature, social science,
-- general) and applies a configurable authority profile whose tiers the
-- profile defines — teacher requirements always override generic
-- preferences, and .gov/.edu are never blindly prioritized.
--
-- The AUTHORITY DECISION for each selected source is stored with the
-- source, so the final citation audit can explain exactly WHY the
-- source was accepted (profile tier, teacher-requirement match,
-- peer-review status, primary/secondary, date fit, relevance,
-- evidence quality — with human-readable reasons).
-- =====================================================================

alter table public.research_sources
  add column if not exists authority_category text not null default '',
  add column if not exists authority_decision jsonb;
