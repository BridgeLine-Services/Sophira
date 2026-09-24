# Task: Dashboard + onboarding

You own EXACTLY these files (create both). Do not modify anything else. Never run npm install, next build, tsc, or git.

## 1. src/app/dashboard/page.tsx
SERVER component. `createClient()` from @/lib/supabase/server; `supabase.auth.getUser()`; if (!user) redirect("/login"). Load profile row (profiles, id = user.id); if (!profile) redirect("/login"); if (!profile.onboarded) redirect("/onboarding").

Load: courses (order created_at desc), teachers, latest writing profile (limit 1), assignments (order updated_at desc, limit 5), study_materials count (select with head: true, count: "exact").

Render `<AppShell title={"Welcome" + (profile.display_name ? ", " + profile.display_name : "")}>`. Content:

(a) Two prominent action buttons in a sm:grid-cols-2 grid: "Start an assignment" (primary, → /assignments/new, FileText icon) and "Ask a question" (secondary, → /assignments/new?mode=learn, HelpCircle icon).
(b) "My Courses": up to 3 course cards (name, subject/level badges, teacher name if teacher_id — fetch teacher names) + "All courses" link to /courses. EmptyState (BookOpen icon) "No courses yet" + action Button → /courses/new "Add your first course".
(c) "My Teachers": similar (→ /teachers, → /teachers/new, GraduationCap icon).
(d) "Writing Profile" card: if an APPROVED writing profile exists show Badge "Approved" + guidance excerpt + link /writing "View & manage"; else an honest card "I don't know your writing style yet" + link /writing "Add writing samples".
(e) "Recent assignments" list: title, mode Badge, fmtDate(updated_at), status, each linking to /assignments/[id]. EmptyState "Nothing yet — start your first assignment".
(f) Footer row of small links: Library, Settings, "Install on your phone" (→ /install).

NO FAKE DATA anywhere — honest empty states only.

## 2. src/app/onboarding/page.tsx
"use client" wizard, 4 steps. Protect: useEffect → `supabase.auth.getUser()`; if no user `router.replace("/login")`; load profile into state. `<AppShell title="Welcome to Sophira">`. Progress indicator ("Step 2 of 4" + dots).

STEP 1 Welcome: what Sophira does (adapts to your courses, teachers, and your own writing; private to you; invite-only) + honest note "I will not know your personal writing style until you give me writing samples." Buttons "Get started" + "Skip setup" (jump to finish).
STEP 2 Academic level + explanation style (Selects: academic_level [Kindergarten/Elementary, Middle school, High school, College/Undergraduate, Graduate/Master's, PhD, Other]; explanation_level [Simple, Standard, Advanced]) + display_name Input. "Save & continue" + "Skip"; save via `supabase.from("profiles").update({...}).eq("id", user.id)`.
STEP 3 First course + teacher (all optional): course name, subject, teacher name inputs. On continue, if teacher name: insert teachers row, then insert teacher_profiles {user_id, teacher_id}; if course name: insert courses {user_id, name, subject, teacher_id}.
STEP 4 "Learn more": three small cards linking to /writing ("Add writing samples"), /install ("Install on your phone"), and "Jump straight in" (finish).
FINISH: `profiles.update({ onboarded: true })` → router.push("/dashboard") + router.refresh().

Every step skippable; Back buttons on steps 2+; values in React state; toasts on save errors; plain language for a non-technical student.
