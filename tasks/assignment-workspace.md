# Task: Assignment workspace

You own EXACTLY these files: src/app/assignments/[id]/page.tsx (server) and src/app/assignments/[id]/Workspace.tsx ("use client"). Do not modify anything else. Never run npm install, next build, tsc, or git.

## src/app/assignments/[id]/page.tsx
SERVER component: auth (redirect /login if no user); load assignment by id → notFound() if missing; load course name + teacher name (if set); load the work session (work_sessions where assignment_id, single) with its messages; load responses for this assignment (order created_at desc, limit 10) — the latest response is displayed in full. Pass everything to `<Workspace ... />`.

## src/app/assignments/[id]/Workspace.tsx
"use client". Props: assignment, courseName, teacherName, session (with messages array) | null, latestResponse | null. Render inside `<AppShell title={assignment.title} backHref="/dashboard">`. Sections:

(a) HEADER: title (inline-editable via a small pencil button → Input + save → supabase update), Badges: MODE_MAP[assignment.mode].label, subject, academic_level, task_type (only if set), status (active/completed/archived as Badge tones accent/neutral/neutral). Course/teacher line: "Course: {courseName}" link /courses/[courseId], "Teacher: {teacherName}" link /teachers/[teacherId] (only if set).

(b) VERIFICATION PANEL (only if latestResponse): Card "Verification" with Badge from verification.status: verified=success "Verified (self-check)", needs_verification=warn "Needs verification", unverified=neutral "Unverified"; the checks list: each check name + ✓ (text-success) or ✗ (text-danger) + detail; warnings list (each with AlertTriangle icon, text-warn); honest footnote: "Self-check by the AI — not a guarantee. Always review important work yourself."

(c) RESULT: Card with `<ResultBody content={latestResponse.content} />`; footer row: Button "Copy" (navigator.clipboard.writeText, toast("success", "Copied.")), Button "Save to library" → supabase.from("study_materials").insert({ user_id, category: "ai_response", title: assignment.title + " — response", content: latestResponse.content, tags: [assignment.mode], assignment_id: assignment.id }) → toast; small Select to change assignment status (active/completed/archived → update row).

(d) FEEDBACK loop: Card "Tell Sophira how this went" with kind chips as small buttons: "Looks good" (kind approve), "Something's wrong" (kind error), "Teacher wanted something else" (kind teacher_wanted), "Note" (kind note) — clicking opens an inline Textarea + "Send feedback" → supabase.from("feedback").insert({ user_id, response_id: latestResponse?.id || null, assignment_id, course_id: assignment.course_id, teacher_id: assignment.teacher_id, kind, comment: text, content: "" }) → toast("success", "Thanks — saved with this assignment."). Honest note: "Approve a Writing/Teacher profile update from the Writing or Teachers page if Sophira proposes one."

(e) HISTORY: the session messages as a timeline (role user: right-aligned muted bubble; assistant: ResultBody in a Card) — render ALL messages in order from session.messages; if no session but latestResponse exists, show just the latest response.

(f) FOLLOW-UP (revision loop): Card "Ask for changes" with quick chips (buttons that fill the textarea): "Explain this step", "Make it simpler", "Show more work", "Follow my teacher's example", "Check this calculation", "Review the rubric again", "Make it sound more like my writing", "Shorten this", "Expand this". Textarea + Button "Send" → busy; POST /api/ai/solve { assignment_id, session_id: session?.id || null, mode: assignment.mode, question: text, course_id: assignment.course_id, teacher_id: assignment.teacher_id } → 200: toast("success") + router.refresh(); 503: toast("error", json.error); other: toast("error", json.error || "Something went wrong — your message is still in the box."). NEVER clear the textarea on error; on success clear it.

Error handling everywhere: preserve work, honest messages, no fake verification claims. Mobile-first single column. Plain language.
