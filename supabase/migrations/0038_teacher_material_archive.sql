-- =====================================================================
-- SOPHIRA migration 0038 — teachers + study materials join the archive
-- lifecycle (2026-10-13, post-archive audit round).
--
-- Same contract as 0037: archived_at NULL = ACTIVE (every existing row),
-- NOT NULL = removed from the active workspace but fully intact and
-- restorable. Additive only: no drops, no rewrites, RLS unchanged.
--
--   * teachers: archiving removes the teacher from active lists and
--     ACTIVE teacher context; courses that reference the teacher keep
--     their reference and fall back to honest "no teacher context".
--   * study_materials (Library): archiving removes the item from the
--     active Library and active study workflows; the DB row and any
--     storage object are preserved (no storage deletion on archive).
-- =====================================================================

alter table public.teachers        add column if not exists archived_at timestamptz;
alter table public.study_materials add column if not exists archived_at timestamptz;

create index if not exists idx_teachers_user_archived
  on public.teachers (user_id, archived_at);
create index if not exists idx_study_materials_user_archived
  on public.study_materials (user_id, archived_at);
