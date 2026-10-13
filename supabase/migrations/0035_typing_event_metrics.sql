-- =====================================================================
-- SOPHIRA migration 0035 — honest typing event metrics (2026-10-13)
--
-- The original accuracy column is FINAL-TEXT accuracy: how closely the
-- submitted text matches the reference. That alone cannot distinguish a
-- flawless typist from one who mistyped and corrected everything (the
-- reported "100% accuracy despite backspacing" defect).
--
-- These OPTIONAL columns store the event summary the calibration UI
-- records (counts only — never what was typed):
--   raw_accuracy  how accurately characters were first entered (0..1)
--   corrections  wrong characters the user then deleted
--   backspaces   total deletions, correct or wrong
--
-- Non-destructive: add column if not exists; existing rows keep NULL
-- ("not captured by that attempt"), and every consumer treats NULL as
-- unknown rather than zero. RLS is unchanged (table policy 0009).
-- =====================================================================

alter table public.typing_attempts
  add column if not exists raw_accuracy numeric check (raw_accuracy is null or (raw_accuracy >= 0 and raw_accuracy <= 1)),
  add column if not exists corrections int check (corrections is null or corrections >= 0),
  add column if not exists backspaces int check (backspaces is null or backspaces >= 0);
