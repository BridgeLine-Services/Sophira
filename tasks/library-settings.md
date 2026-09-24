# Task: Library + settings

You own EXACTLY these files: src/app/library/page.tsx and src/app/settings/page.tsx. Do not modify anything else. Never run npm install, next build, tsc, or git.

## 1. src/app/library/page.tsx
"use client". AppShell title="Library". Load study_materials (order created_at desc). Header controls row: Select category filter ("All" + assignment, course, teacher_instructions, worked_example, writing_sample, writing_profile, study_guide, practice_question, note, ai_response, correction — displayed with spaces like "AI response"), search Input (filters title + content, case-insensitive, client-side), sort Select ("Newest first", "Oldest first", "Title A-Z").

List of Cards: title, category Badge, tags as small Badges, fmtDate(created_at), details/summary expandable showing full content (pre-wrap). Delete per item (ConfirmDialog destructive "Delete this item? This cannot be undone."). "+ New note" button opening a small inline form (title + content) → insert { user_id, category: "note", title, content, tags: [] } → toast + reload list.

EmptyState (Library icon) "Your library is empty" + description "Responses you save, study notes, and materials you keep will live here." — NO fake data.

## 2. src/app/settings/page.tsx
"use client". AppShell title="Settings". Load profile + user (supabase.auth.getUser()). Sections as Cards:

(a) "You & how I explain things": display_name Input, academic_level Select (Kindergarten/Elementary, Middle school, High school, College/Undergraduate, Graduate/Master's, PhD, Other), explanation_level Select (Simple/Standard/Advanced), answer_style Input (placeholder "e.g. brief bullet points, or full paragraphs"), formatting_pref Input (placeholder "e.g. headings + numbered steps"), preferred_language Input. "Save" → supabase.from("profiles").update({...}).eq("id", user.id) → toast. Show email (read-only, text-ink-soft) and role Badge ("owner" accent / "user" neutral).

(b) "Privacy" card (static, honest bullets): "Your assignments, documents, writing samples, and profiles are stored privately and can only be read by your account (row-level security)."; "Nobody else — not even the owner — can browse your academic work in the app."; "Sophira never uses your data to personalize someone else's AI."; "Uploaded files live in a private storage bucket only you can open."

(c) "Install on your phone" card: short text + Link Button variant secondary to /install.

(d) OWNER ONLY (if profile.role === "owner"): "Invitations" card. GET /api/invitations on mount; list: email, status Badge (pending=warn, accepted=success, revoked=neutral), fmtDate(created_at), invite link with a "Copy link" Button (navigator.clipboard), Delete Button (ConfirmDialog) → DELETE /api/invitations?id=. "Invite someone" form: email Input + "Create invitation" → POST /api/invitations { email } → toast("success", "Invitation created — copy the link and send it.") and show the returned link with copy button; errors (403 etc.) toast verbatim.

(e) "Danger zone" card (border-danger/30): "Delete my account" Button variant danger → ConfirmDialog destructive with message "This permanently deletes your account and ALL your data — assignments, courses, teachers, writing samples, everything. This cannot be undone." + a typed-confirmation Input where the user must type DELETE to enable the confirm button → POST /api/account/delete → 200: await supabase.auth.signOut(); router.push("/login"); toast("success", "Account deleted. Take care."); error → toast("error", message).

Tone: plain language, calm, honest, no fake data. All mutations disabled+Spinner while pending, toasts, inputs preserved on error.
