-- =====================================================================
-- SOPHIRA migration 0015 — FINAL SUBMISSION READINESS GATE (2026-10-05)
--
-- The mandatory final gate is machine-enforced: submission_ready is
-- false whenever ANY hard teacher/rubric/formatting/research/assignment
-- requirement fails. The evaluated gate result is persisted with the
-- draft it evaluated, so the UI can never display a stale or misleading
-- "Ready to Submit" state, and the exact blocking reasons stay on record.
-- =====================================================================

alter table public.responses
  add column if not exists submission_gate jsonb;
