-- =====================================================================
-- 0031: STUDENT MEMORY COURSE SCOPE (shared-memory round 2026-10-11)
-- Hierarchical memory, level 3 of 5: student_memories gains an explicit
-- course_id identifier so course-level memories can be recorded and
-- retrieved WITHOUT relying on display names or duplicated rows.
-- Additive + reversible (removing the column restores the prior schema).
-- RLS: unchanged — policies are user_id own-row, so course-scoped
-- rows inherit the same strict isolation automatically.
-- =====================================================================

alter table public.student_memories
  add column if not exists course_id uuid
    references public.courses(id) on delete set null;

-- A course-scoped memory is retrieved only inside that course (handled in
-- lib/memory/engine.ts relevance selection); never in another course or a
-- bare subject prompt.
create index if not exists student_memories_user_course_idx
  on public.student_memories (user_id, course_id);
