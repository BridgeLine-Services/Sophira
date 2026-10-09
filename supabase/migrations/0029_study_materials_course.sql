-- =====================================================================
-- SOPHIRA migration 0029: course-scoped Library (2026-10-09)
--
-- The course-engine workspace exposes a per-course Library view. The
-- existing study_materials schema could not scope a material to a course
-- (only assignment_id existed), so this adds an optional course_id.
--
-- PRIVACY: no RLS policy changes — "study_materials_own" (user_id =
-- auth.uid()) continues to govern every row. course_id only narrows the
-- user's OWN material set; it can never widen access to another user's
-- data. A null course_id + null assignment_id keeps a material global.
-- =====================================================================

alter table public.study_materials
  add column if not exists course_id uuid
  references public.courses(id) on delete set null;

create index if not exists idx_study_materials_course
  on public.study_materials (user_id, course_id)
  where course_id is not null;
