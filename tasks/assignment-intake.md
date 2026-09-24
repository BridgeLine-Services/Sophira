# Task: Assignment intake wizard

You own EXACTLY this file: src/app/assignments/new/page.tsx (plus any components you create inside src/app/assignments/new/). Do not modify anything else. Never run npm install, next build, tsc, or git.

"use client". IMPORTANT: the page reads useSearchParams (?course_id=, ?mode=), so it MUST wrap the working component in `<Suspense>` (default export = simple wrapper; inner component does the work).

AppShell title="New assignment" backHref="/dashboard". 3 steps with a progress indicator ("Step 1 of 3") and Back buttons; ALL entered state is kept throughout (never lost on error).

STEP 1 — "What do you need?": a grid of 7 selectable mode cards from MODES (import from @/lib/modes): each selectable Card-button with icon (learn: BookOpen, assignment: FileText, check: ClipboardCheck, writing: PenLine, study: Layers, explain: Lightbulb, custom: Wrench), label, short description; the selected card gets ring-2 ring-accent. Preselect from ?mode= if valid, else "assignment". Button "Continue".

STEP 2 — "Course & teacher": load user's courses + teachers (useEffect). Select "Course (optional)": "No course — general question" + course names; selecting a course with a teacher_id auto-selects that teacher. Select "Teacher (optional)": "No teacher" + teacher names. Small helper text: "Course & teacher rules are applied automatically — only the selected ones." Button "Continue".

STEP 3 — "Your assignment": title Input (optional, "Give it a name (optional)"); then two input methods:
(a) Textarea "Type or paste your assignment or question" (min-h-44);
(b) file upload: file input (accept .pdf,.txt,.md,image/*, multiple) → for EACH file sequentially POST /api/extract (multipart field "file"); collect attachments state [{file_name, extracted_text, confidence, notes, storage_path}]; render each as a small card: file_name + confidence Badge (high=success, medium=warn, low=warn) + notes (small text) + remove button; per-file uploading state (Spinner). On 413/415 error toast("error", errorMessage) and DON'T add the file.
Also "Anything else I should know?" Textarea (custom_instructions).
Before continuing, require EITHER question text OR at least one attachment: else toast("error", "Add your question or at least one file.").

REVIEW & START: final panel summarizing mode label, course/teacher names, title, question excerpt, file list. Button "Start working" (primary, lg, Sparkles icon). On click: set busy; POST /api/ai/solve with body:
{ mode, question: questionText || "Please work through the attached assignment documents.", title: title || undefined, course_id: courseId || null, teacher_id: teacherId || null, custom_instructions: customInstructions || undefined, files: attachments.map(a => ({ file_name: a.file_name, extracted_text: a.extracted_text })) }

ALSO after solve succeeds (data.assignment_id available): for each attachment insert into assignment_files: { user_id, assignment_id, file_name, storage_path: a.storage_path || "", mime_type: null, extracted_text, extraction_confidence: a.confidence, extraction_notes: a.notes || "" } (ignore individual insert errors — the assignment already exists).

Response handling: 200 → toast("success", "Here it is.") → router.push(`/assignments/${data.assignment_id}`); 401 → toast("error", "Your session expired — please sign in again."); 503 → toast("error", json.error) and KEEP EVERYTHING (stay on page, busy=false); other errors → toast("error", json.error || "Something went wrong. Your work is still here — please try again."). Never clear state on any error. While busy show a subtle note under the start button: "This can take up to a minute for big assignments…".

Mobile-first: single column, large touch targets, no horizontal scroll. Plain friendly language.
