-- =====================================================================
-- SOPHIRA migration 0007 — intentionally preserved habits (workflow §12)
--
-- The workflow supports a nuance: a recurring mistake that is part of the
-- user's ESTABLISHED writing voice may be intentionally preserved when the
-- user explicitly asks the AI to reproduce their established style.
--
-- Safety rules (enforced in code, tested in tests/run.ts):
--   - the flag can ONLY be set by an explicit user action (corrections UI)
--   - it applies ONLY to writing tasks, and ONLY as style reproduction
--   - it NEVER overrides teacher/assignment requirements
--   - academic correctness in fresh work is unaffected — non-intentional
--     mistakes remain watch-for lines, never reproduced
-- =====================================================================

alter table public.learning_patterns
  add column if not exists intentional boolean not null default false;
