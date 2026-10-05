-- =====================================================================
-- SOPHIRA migration 0016 — PATTERN EVIDENCE, CONFIDENCE DECAY & THE
-- LOWER_CONFIDENCE STATUS (2026-10-05)
--
-- Upgrades the existing learning-pattern lifecycle (0005, workflow
-- §9–§12) WITHOUT replacing it. Adds the evidence-tracking columns the
-- confidence-decay engine (src/lib/learning/evidence.ts) needs and the
-- intermediate 'lower_confidence' status, so a pattern demotes
-- candidate → active → lower_confidence → inactive and can become
-- active again — it is never abruptly deleted.
--
-- Field mapping (requested → column):
--   pattern_id→id, user_id→user_id, pattern_type→kind,
--   pattern_scope→scope, confidence→confidence, created_at→created_at,
--   last_confirmed_at, last_used_at, observation_count,
--   confirmation_count, contradiction_count, correction_count, status.
-- =====================================================================

alter table public.learning_patterns
  add column if not exists last_confirmed_at timestamptz,
  add column if not exists last_used_at timestamptz,
  add column if not exists confirmation_count int not null default 0,
  add column if not exists contradiction_count int not null default 0,
  add column if not exists correction_count int not null default 0;

-- Status ladder gains the intermediate demotion step.
alter table public.learning_patterns
  drop constraint if exists learning_patterns_status_check;
alter table public.learning_patterns
  add constraint learning_patterns_status_check check (
    status in ('candidate', 'active', 'corrected', 'inactive', 'recurring',
               'temporary', 'teacher_required', 'lower_confidence')
  );
