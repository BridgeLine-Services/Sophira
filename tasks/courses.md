# Task: Courses module

You own EXACTLY these files (create all 3). Do not modify anything else. Never run npm install, next build, tsc, or git.

## 1. src/app/courses/page.tsx
"use client". AppShell title="Courses". useEffect: load courses + teachers (for name lookup). List of course Cards: name, subject Badge, academic_level, term, teacher name (lookup by teacher_id), fmtDate(created_at), each linking to /courses/[id]. EmptyState (BookOpen): "No courses yet" + description "Courses tell Sophira which subject, level, and teacher rules to use." + action Button → /courses/new "Add a course". Header action: AppShell actions prop = Link to /courses/new with a small "+ Add course" Button.

## 2. src/app/courses/new/page.tsx
"use client". AppShell title="New course" backHref="/courses". Form: name (required), subject (Input, placeholder "e.g. Calculus, Biology, US History"), academic_level (Select: Middle school, High school, College, Undergraduate, Graduate, PhD, Other), institution (optional), term (optional, placeholder "e.g. Fall 2026"), teacher (Select from user's teachers + "No teacher yet"; if no teachers exist show hint "Teachers are added from the Teachers tab — you can set one later"), instructions (Textarea, hint "Anything this course requires: formats, methods, tools…").

Submit: insert courses row (user_id, name, subject or null, academic_level or null, institution or null, term or null, teacher_id or null, instructions) → toast success → router.push("/courses"). Validate name non-empty ("Please give the course a name."). Keep form values in state; on error toast and DO NOT clear the form.

## 3. src/app/courses/[id]/page.tsx
SERVER component: auth; load course by id; notFound() if missing; load teacher name + this course's assignments (where course_id, order updated_at desc). `<AppShell title={course.name} backHref="/courses">`. Sections:

(a) Client child `src/app/courses/[id]/CourseEditor.tsx` ("use client", props: course, teacherName): editable form of all course fields (same fields as the new page) with "Save changes" → supabase update; delete flow with ConfirmDialog ("Delete this course? Its assignments stay, but lose their course link. This cannot be undone." destructive) → delete → router.push("/courses").
(b) "Teacher" card: teacher name linking to /teachers/[id] or "No teacher set".
(c) "Assignments in this course" list: title, mode Badge, status, updated date, link /assignments/[id]. EmptyState "No assignments started in this course yet" + action Link → /assignments/new?course_id=<id> "Start an assignment".

Tone: plain language, helpful hints under fields, honest empty states, no fake data. All mutations: disabled button + Spinner while pending, toast success/error, inputs preserved on error.
