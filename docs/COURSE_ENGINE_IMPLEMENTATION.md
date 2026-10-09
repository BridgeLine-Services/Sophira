# Course Engine Implementation Report (2026-10-09)

Incremental gap-closure against the course-engine specification. No rebuilds:
no new AI backends, no parallel database, no removed features, no mock
implementations. All changes are in this repository, on the existing
Next.js + Supabase + AI-provider + offline/PWA architecture.

## What was already working (unchanged)

Essay staged pipeline, Writing workspace and samples, Math scan-to-solve with
independent verification, Teachers, Library, Notebooks, Offline, Proposals,
Memory engine and store, invitation/owner systems, account management,
PWA/native shells.

## What was built

### 1. Course-engine workspace (Phase 2)
- `src/lib/courses/engines.ts` — subject classification into 8 engines
  (Writing, Math, Biology, Chemistry, Physics, Humanities, Programming,
  General Academic) + per-engine tool registry. Pure navigation over the
  EXISTING pages; the AI subject router (`src/lib/ai/subjects.ts`) is untouched.
- `src/app/courses/[id]/page.tsx` — every course now opens into its engine
  workspace: subject + engine badges, tool grid scoped with
  `?course_id=`, honest empty state when no teacher/subject is set,
  assignments list retained.

### 2. Typing calibration relocated (Phase 3)
- Removed from `src/app/settings/page.tsx` (card, TypingTest import, unused icon).
- New `src/app/writing/typing/page.tsx` under the Writing Engine. Same
  `TypingTest` component, same `/api/typing` backend, same attempts/baseline —
  no recalibration, no data change. Settings keeps profile, password,
  invitations, export, deletion.

### 3. Learning / Memory consolidated (Phase 4)
- New `src/app/learning/page.tsx`: one destination with separated sections —
  personalization setup checklist (incl. the previously BROKEN
  `/typing-calibration` link, now fixed to `/writing/typing`), corrections and
  learning patterns (CorrectionsPanel), subject/course memories (MemoryManager),
  and a pointer to Changes for history/versions.
- `/corrections` and `/memories` remain as backward-compatible redirects.
- Same tables, routes, and RLS policies — nothing deleted or duplicated.

### 4. Changes preserved (Phase 5)
- `/proposals` unchanged and exposed as the Changes destination in every
  course engine.

### 5. Course-scoped Library (Phase 6)
- `supabase/migrations/0029_study_materials_course.sql` — additive
  `course_id` on `study_materials` + partial index. NO policy changes
  (`study_materials_own` still governs every row).
- `src/app/library/page.tsx` — `?course_id=` view: materials attached to the
  course, its assignments, or intentionally global (deduplicated; notes saved
  from the course attach to it). Filtering happens in the RLS-scoped database
  query, never only in the browser.

### 6. Essay course context (Phase 2D)
- `src/app/essay/page.tsx` — accepts `?course_id=`, persists it via the plan
  API (which already supported `course_id`/`teacher_id` on `essay_sessions`),
  shows a back-to-course route.

### 7. Navigation (Phase 7)
- `AppShell` single NAV entry "Learning / Memory" (`/learning`); desktop rail,
  tablet top nav, and mobile bottom bar all render it. Home, Owner, Settings,
  Offline, and all other destinations untouched. Stale `/corrections` links in
  dashboard and assignment workspace updated to `/learning`.

## Changed files

- `src/lib/courses/engines.ts` (new)
- `src/app/courses/[id]/page.tsx`
- `src/app/writing/typing/page.tsx` (new)
- `src/app/learning/page.tsx` (new)
- `src/app/corrections/page.tsx`, `src/app/memories/page.tsx` (redirects)
- `src/components/app/AppShell.tsx`
- `src/app/settings/page.tsx`
- `src/app/library/page.tsx`
- `src/app/essay/page.tsx`
- `src/app/dashboard/page.tsx`, `src/app/assignments/[id]/Workspace.tsx` (links)
- `supabase/migrations/0029_study_materials_course.sql` (new)
- `src/lib/db-migrations.generated.ts` (regenerated, 29 migrations embedded)
- `tests/course-engine.ts` (new), `tests/run.ts`, `tests/self-healing-provision.ts`,
  `tests/tsconfig.json`
- `docs/COURSE_ENGINE_IMPLEMENTATION.md` (this report)

## Tests

- `tests/course-engine.ts`: 92 conformance/unit assertions covering subject→engine
  routing, per-engine tools, course-context propagation, typing relocation
  (no Settings copy, no backend change), consolidation without data deletion,
  course-scoped library queries (server-enforced), migration safety (additive,
  no policy changes), owner-guard retention, and subject isolation.
- Full suite: **2856/2856 passing** (was 2764). tsc clean. Production build clean.

## Migrations

Only `0029_study_materials_course.sql` (additive, backward-compatible). The
runtime migration chain was regenerated and CI deploys it automatically on
master pushes.

## Remaining limitations (owner-side, pre-existing)

Production environment variables, live API credentials, GitHub
SUPABASE_TEST_* secrets, device/PWA testing, and legal documentation facts
remain outstanding owner tasks — unchanged by this work.
