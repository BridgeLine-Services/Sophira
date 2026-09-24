# Task: Teachers + teacher profiles

You own EXACTLY these files (create all 3). Do not modify anything else. Never run npm install, next build, tsc, or git.

## 1. src/app/teachers/page.tsx
"use client". AppShell title="Teachers". Load teachers. Cards: name, notes excerpt, fmtDate(created_at), link /teachers/[id]. EmptyState (GraduationCap) "No teachers yet" + description "A teacher profile saves exactly how each teacher wants work done — methods, steps, notation, formats." + action → /teachers/new. Header action "+ Add teacher".

## 2. src/app/teachers/new/page.tsx
"use client". AppShell title="New teacher" backHref="/teachers". Form: name (required), notes (Textarea, "Anything that helps identify this teacher's style"). Submit: insert teachers row, then insert teacher_profiles row ({ user_id, teacher_id }) (ignore unique-duplicate error), toast, router.push("/teachers/" + id).

## 3. src/app/teachers/[id]/page.tsx
SERVER component: auth; load teacher + teacher_profile (by teacher_id) + courses taught by this teacher. `<AppShell title={teacher.name} backHref="/teachers">`. Render `<ProposalsPanel targetType="teacher" targetId={teacherProfile?.id} />` near the top (pending extracted-rule proposals appear there). Then client child `src/app/teachers/[id]/TeacherProfileEditor.tsx` ("use client", props: teacher, teacherProfile or null). Sections:

(a) "Basics": edit teacher name + notes; delete teacher (ConfirmDialog destructive: "Delete this teacher? Their profile and rules are deleted too. Courses keep running without one." → delete teacher_profiles row then teachers row → router.push("/teachers")).
(b) "Requirements" — the 13 text fields of teacher_profiles, each Label + Textarea (min-h-20) + tiny hint:
- required_methods "Required solution methods" (hint: "How this teacher wants problems solved — e.g. \"use the substitution method\"")
- required_steps "Required solution steps"
- preferred_notation "Preferred notation"
- units_sig_figs "Units & significant figures"
- formatting_requirements "Formatting requirements"
- citation_requirements "Citation & referencing"
- essay_structure "Essay structure"
- lab_report_requirements "Lab report requirements"
- preferred_terminology "Preferred terminology"
- show_work_rules "Showing work"
- calculator_rules "Calculator restrictions"
- allowed_tools "Allowed tools"
- prohibited_tools "Prohibited tools"
"Save changes" → update (or insert the profile row first with user_id + teacher_id if it does not exist).

(c) "Documents" — four subsections with headings: "Official instructions" (official_instructions), "Rubrics & grading criteria" (rubrics), "Teacher's worked examples" (examples), "Corrections & feedback" (corrections). Each column is a TeacherDoc[] {title, content, source?, source_date?} stored as jsonb. For each: list existing docs (title + source, expandable content via details/summary), per-doc delete with ConfirmDialog, and an "Add document" inline form (title required, content Textarea, source optional e.g. "syllabus p.3", source_date optional). Saving a doc = update that jsonb column with the appended array.

(d) "AI notes (unconfirmed)" — render ai_notes items with Badge tone="warn" "Unconfirmed" + note text; explain "These are AI interpretations, never treated as official requirements."

(e) "Extract rules from a document" card: Select kind (official="Official instructions", rubric="Rubric or grading criteria", example="Worked example", correction="Feedback / corrections"), title Input, content Textarea ("Paste the document text — a syllabus page, rubric, assignment feedback…"), Button "Analyze with AI" → POST /api/ai/extract-teacher-doc with { teacher_id, kind, title, content }. 200 with proposal_id → toast("success", "Proposed — review it above before anything changes."); data.message (proposal_id null) → toast("info", message); 503 → toast("error", json.error) and PRESERVE the pasted text; never auto-clear the textarea on error.

Tone: plain language, structured, calm. Disabled+Spinner on all mutations, toast feedback, inputs never lost on error. This is the teacher-rules core of the product.
