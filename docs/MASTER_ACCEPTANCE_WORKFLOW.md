# SOPHIRA — Master Acceptance Workflow

**The definitive end-to-end acceptance test for the project.**

This is a single continuous scenario. Run it top-to-bottom on a live backend
(Supabase configured, AI provider key set) with the app deployed or running
locally, with one owner account and one student account. Every step lists its
current status so nothing is claimed that was not executed.

## Status legend (P11)

- **IMPLEMENTED** — the code path exists (verified by code inspection)
- **AUTO-VERIFIED** — covered by `npm test` (141 assertions, fully offline)
- **LIVE-VERIFIED** — executed against a real backend (date noted)
- **DEVICE-VERIFIED** — executed on a real device (device/date noted)
- **NOT-YET-VERIFIED** — requires a live backend / real device; not executed yet

## The workflow

Each numbered step must complete exactly as described. A step fails if any of
its checks fails. Sub-checks reference the section of `ACCEPTANCE_TESTS.md` or
`tests/run.ts` that covers the same behavior.

### 1. OPEN APP
Visit the deployed Sophira URL.
- Login page renders; unauthenticated users cannot reach `/dashboard` or any
  app route (middleware redirect). [IMPLEMENTED, AUTO-VERIFIED — tests §1]
- The PWA is served: manifest, icons, service worker register without errors.
  [IMPLEMENTED — live PWA check pending]

### 2. AUTHENTICATE
Sign in with the owner account (magic link or OAuth per the Supabase config).
- Session persists across reloads (persistent login where supported).
  [IMPLEMENTED — LIVE-VERIFIED required]

### 3. IDENTIFY USER
- The app loads the profile and shows the owner's name in Settings.
  [IMPLEMENTED]
- A user with NO account and no invitation cannot sign in (invite-only).
  [IMPLEMENTED, AUTO-VERIFIED — migration 0001/0002 policies]

### 4. OWNER/MEMBER ACCESS
- Owner sees `/owner` in the navigation and the Owner Dashboard works.
  [IMPLEMENTED]
- Member (invited student) can use the app normally but gets 403 on `/owner`
  and on all owner APIs. [IMPLEMENTED, AUTO-VERIFIED — guard + RLS]
- Revoked user: EVERY page redirects to `/access-denied`; EVERY protected API
  returns 403; data untouched. [IMPLEMENTED, AUTO-VERIFIED — tests §2;
  LIVE-VERIFIED required]

### 5. COURSE
Owner creates a course (e.g. "Calculus I", subject Mathematics).
- Course appears on the dashboard and is visible ONLY to its owner
  (cross-account isolation). [IMPLEMENTED, AUTO-VERIFIED — tests §3]

### 6. TEACHER + 7. TEACHER REQUIREMENTS
Add teacher "Prof. X" with required method: "solve by factoring" and a rubric
or written instruction in the teacher profile.
- Teacher requirements attach to this course only.
- A second teacher "Prof. Y" (different requirements) on a different course
  never appears in Prof. X's context. [IMPLEMENTED, AUTO-VERIFIED — tests §4/§5]

### 8. ASSIGNMENT
Create an assignment in the course: "Homework 3 — quadratic equations", with
per-assignment instructions (e.g. "show all steps").

### 9. UPLOAD DOCUMENT
Upload the homework as a document (PDF/image).
- Document ingestion extracts text (PDF) or queues handwriting review
  (image). [IMPLEMENTED, AUTO-VERIFIED — tests §9]

### 10. CLASSIFY
- The solve flow classifies subject Mathematics and routes to the math
  sub-workflow (quadratics → algebra engine). [IMPLEMENTED, AUTO-VERIFIED —
  tests §8]

### 11. SOLVE
- The answer uses the TEACHER'S REQUIRED METHOD (factoring), not a different
  method, even if another method is mathematically valid.
  [IMPLEMENTED — LIVE-VERIFIED required]

### 12. VERIFY + 13. SHOW WORK
- The response includes step-by-step work, an honest verification block
  (machine checks recomputed server-side where possible), and a separate
  method-compliance status. A failed or unverifiable check is SHOWN, never
  hidden. [IMPLEMENTED, AUTO-VERIFIED — tests §6/§7]

### 14. USER CORRECTION
The student gives feedback: "my professor requires completing the square".
- Scoped feedback creates a proposal, never a silent profile change.
  [IMPLEMENTED, AUTO-VERIFIED — tests §12]

### 15. LEARNING PROPOSAL + 16. USER APPROVAL
- The proposal appears for review; the student approves it.
  [IMPLEMENTED, AUTO-VERIFIED — tests §11]

### 17. PERSIST LEARNING
- The approved pattern is stored with scope (subject/teacher/course), status
  active, source "user". Nothing was learned without approval.
  [IMPLEMENTED, AUTO-VERIFIED — tests §10]

### 18. FUTURE TASK USES LEARNING
- The next relevant calculus assignment's "What was applied" panel lists the
  learned method. [IMPLEMENTED, AUTO-VERIFIED — tests §10/§25]

### 19. PREVENT INCORRECT LEARNING FROM SPREADING
- A biology assignment does NOT retrieve the calculus pattern.
- Teacher B's assignment does NOT retrieve Teacher A's correction.
- Corrected (fixed) patterns never re-enter context.
  [IMPLEMENTED, AUTO-VERIFIED — tests §10/§12]

### 20. WRITING TASK + 21. WRITING STYLE
- Create a Writing Profile from approved samples; run a writing task.
- The approved Writing Profile is applied (writing tasks only).
  [IMPLEMENTED, AUTO-VERIFIED — tests §5]

### 22. TEACHER REQUIREMENT OVERRIDES STYLE
- In the same writing task, an explicit teacher requirement (e.g. "no first
  person") overrides the student's demonstrated style, and the conflict, if
  any, is surfaced — never silently resolved. [IMPLEMENTED, AUTO-VERIFIED —
  tests §5/§12a; the composer declares the ORDER OF AUTHORITY first]

### 23. SAVE
- The result is saved to the assignment version history; earlier versions can
  be rolled back. [IMPLEMENTED, AUTO-VERIFIED — tests §11]

### 24. LOG OUT → 25. LOG IN
- Sign out, sign back in on the same device: courses, teachers, assignments,
  learning patterns, and the Writing Profile are all still there
  (persistence is server-side, not chat history). [IMPLEMENTED —
  LIVE-VERIFIED required]

### 26. INSTALL PWA
- From the app: Settings → "Install on your phone" → `/install` detects the
  platform and shows exact instructions. Install via Add to Home Screen /
  Install app; launch standalone; login persists. [IMPLEMENTED —
  DEVICE-VERIFIED required: iPhone Safari, Android Chrome]

### 27. CONTINUE WORKING
- In the installed PWA, reopen the assignment from step 8 and continue work:
  data, learning, and writing state all present. [DEVICE-VERIFIED required]

## Sign-off table

| Area | Implemented | Automated tests | Live backend | Real device |
| --- | --- | --- | --- | --- |
| Auth + invite-only access | ✅ | ✅ (§1, §2) | ⬜ | ⬜ |
| Owner dashboard / membership | ✅ | ✅ (§2, §11) | ⬜ | ⬜ |
| Invitations (single-use, email-tied, expiring, revocable) | ✅ | ✅ (§11, §14) | ⬜ | ⬜ |
| Courses / teachers isolation | ✅ | ✅ (§3, §4, §5) | ⬜ | ⬜ |
| Document ingestion / handwriting | ✅ | ✅ (§9) | ⬜ | ⬜ |
| Subject routing / math engines | ✅ | ✅ (§8) | ⬜ | ⬜ |
| Solve / verify / method compliance | ✅ | ✅ (§6, §7) | ⬜ | ⬜ |
| Learning lifecycle + scopes | ✅ | ✅ (§10, §12) | ⬜ | ⬜ |
| Feedback → proposal → persist | ✅ | ✅ (§11, §12) | ⬜ | ⬜ |
| Writing profile + habits safety | ✅ | ✅ (§5, §12) | ⬜ | ⬜ |
| "What was applied" transparency | ✅ | ✅ (§13, §25) | ⬜ | ⬜ |
| PWA / install | ✅ | ✅ (§10) | ⬜ | ⬜ |

The ⬜ cells are the ONLY remaining work for go-live: executing this workflow
against a real backend and real devices, then ticking them off with dates.
