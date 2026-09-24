# Task: Writing samples + writing profile

You own EXACTLY these files (create both). Do not modify anything else. Never run npm install, next build, tsc, or git.

## 1. src/app/writing/page.tsx
"use client". AppShell title="Writing Profile". Structure:

- Top: `<ProposalsPanel targetType="writing" />` (pending analysis proposals appear there for approval — nothing is applied without approval).
- "Writing Profile" card: if no writing_profiles row exists: EmptyState (PenLine icon) "No writing profile yet" + honest description "I won't guess your writing style. Add at least one writing sample marked \"preferred\" or \"neutral\", then analyze." + action → /writing/new "Add a writing sample". If it exists: Badge tone success "Approved" (or tone warn "Draft (not used for writing yet)") + "Version {version}" + guidance paragraph + summary as a definition list (Object.entries of the summary jsonb, friendly-capitalized keys, skip empty values) + Button "Re-analyze from my samples" → POST /api/ai/analyze-writing with `{}` → 200 → toast("success", "Analysis ready — review and approve it above."); 400/503 → toast("error", error) (preserve everything).
- "My writing samples" section: load writing_samples. Cards: title, genre Badge, representativeness Badge (preferred=success "Preferred", neutral=neutral "Neutral", not_representative=warn "Not representative"), fmtDate(sample_date || created_at), content excerpt (first 140 chars). Each card expandable to full content (details/summary). Per-sample inline controls: Select to change representativeness (updates row), delete button (ConfirmDialog destructive "Delete this sample?").
- "+ Add a sample" button → /writing/new. Honest empty state when no samples.

## 2. src/app/writing/new/page.tsx
"use client". AppShell title="Add a writing sample" backHref="/writing". Form: title (required, placeholder "e.g. History essay — Civil War"), genre (Select: Essay, Discussion post, Short answer, Lab report, Reflection, Research writing, Other), course (Select from user's courses + "None"), academic_level (Select: Kindergarten/Elementary, Middle school, High school, College/Undergraduate, Graduate/Master's, PhD, Other), sample_date (date Input, optional), representativeness (Select with EXPLANATORY labels: preferred="Represents how I want to write (preferred)", neutral="Neutral / okay example", not_representative="Does NOT represent my style"), content: Textarea (min-h-64, "Paste your writing here").

PLUS an upload helper: file input (accept .txt,.md,.pdf) labeled "…or upload a text file or PDF" → on change POST /api/extract (multipart field "file") → 200 → fill the content textarea with data.extracted_text and toast("info", data.notes); 413/415 errors → toast("error", error) — never lose pasted content.

Submit: insert writing_samples row ({ user_id, title, genre, course_id: or null, academic_level: or null, sample_date: or null, representativeness, content }) → toast success → router.push("/writing"). Title non-empty validation, preserve inputs on error, disabled+Spinner while pending.

Tone: plain language, honest ("I will not invent your style"), no fake data, inputs never lost.
