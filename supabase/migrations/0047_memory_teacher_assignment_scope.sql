-- ---------------------------------------------------------------------
-- student_memories: teacher + assignment scope (2026-11-11)
--
-- The standing rule is FIVE memory scopes with explicit precedence:
--   General < Subject < Course < Teacher < Assignment
-- Only two of them existed. A memory had `subject` (0020) and `course_id` (0031),
-- so a rule that belongs to ONE teacher ("Mr Reyes wants APA headings") or ONE
-- assignment ("this lab report needs an uncertainty column") had nowhere to live
-- except as a course-wide or global fact — where it would follow the member into
-- other teachers' work and quietly change answers it has nothing to do with.
--
-- Both columns are nullable, so every existing memory keeps its current meaning:
-- NULL means "not scoped that narrowly", never "belongs to teacher X".
--
-- ON DELETE SET NULL on purpose: deleting a teacher or an assignment must not
-- delete what the member learned; it only stops the fact being narrowed to that
-- teacher/assignment (it falls back to its course/subject scope).
-- ---------------------------------------------------------------------
alter table public.student_memories
  add column if not exists teacher_id uuid references public.teachers(id) on delete set null;

alter table public.student_memories
  add column if not exists assignment_id uuid references public.assignments(id) on delete set null;

-- Retrieval is always "this member, this teacher/assignment", so index that pair
-- the way the course scope is indexed.
create index if not exists student_memories_user_teacher_idx
  on public.student_memories (user_id, teacher_id);
create index if not exists student_memories_user_assignment_idx
  on public.student_memories (user_id, assignment_id);

comment on column public.student_memories.teacher_id is
  'Teacher this memory is confined to (scope 4). NULL = not teacher-scoped. Retrieved only while working with that teacher.';
comment on column public.student_memories.assignment_id is
  'Assignment this memory is confined to (scope 5, the narrowest and highest precedence). NULL = not assignment-scoped.';
