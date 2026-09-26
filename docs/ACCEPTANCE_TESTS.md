# Sophira — Live Acceptance Test Runbook

These scenarios need a deployed environment (Supabase project + AI key + HTTPS
URL) and, for the PWA tests, real devices. The unit suite (`npm test`, 91
assertions) already covers the pure logic; this runbook is the *live* pass you
run after deploying, in order. Record results in TEST_REPORT.md.

**Setup before starting:** deploy, run migrations 0001–0004, set the AI key,
create the owner account, and have a second browser profile (Student B) with an
invitation.

## 1. Authentication
- [ ] Sign up owner via invitation link → email confirm → onboarding → dashboard
- [ ] Sign out → sign in works; password reset email arrives and resets
- [ ] Dashboard requires auth (visit /dashboard logged out → redirected to /login)

## 2. Courses & isolation
- [ ] Create Course A with teacher; create Course B
- [ ] In an assignment for Course B, confirm Course A's instructions are absent
- [ ] Student B (second account) cannot open Student A's course URL (empty/error, not data)

## 3. Teachers
- [ ] Create teacher, add requirements (method, notation, show-work rules)
- [ ] Add an official instruction doc with a source date
- [ ] Add a second official doc with an older date → workspace shows a source-conflict notice
- [ ] Archive the old doc → conflict disappears

## 4. Assignment + AI (requires AI key)
- [ ] Start assignment with course+teacher selected; response should show
      "Teacher rules applied" with the count of fields/sources actually used
- [ ] Check My Work mode with your own attempt returns specific feedback
- [ ] Follow-up question retains context (ask "why that substitution?" —
      it answers in context, not from scratch)

## 5. Writing Profile conditionality
- [ ] Approve a Writing Profile (upload samples → proposal → approve)
- [ ] Math task: workspace says "Writing Profile intentionally not applied"
- [ ] Writing task: workspace says the approved profile was applied

## 6. Method compliance + verification
- [ ] Math assignment: teacher requires a specific method → response has a
      "Method compliance" card separate from "Verification"
- [ ] Verification badge names the actual method: "Independently verified
      (numeric, symbolic)" vs "AI self-check only" vs "Needs verification"

## 7. Feedback → proposal → versioning → rollback
- [ ] Send feedback "My professor wants every integral evaluated using substitution"
- [ ] Click "Should this become a rule?" → proposal appears on /proposals
- [ ] Approve → teacher profile updated; Version history shows v1 with a diff
- [ ] Roll back → previous values restored, a new version event records the rollback
- [ ] Reject a different proposal → profile unchanged

## 8. Cross-student isolation (Student A vs B)
- [ ] B cannot read A's: assignments, files, courses, teachers, writing
      profile, profile versions, feedback (try direct IDs/URLs)
- [ ] B's assignment never mentions A's teacher rules

## 9. Documents
- [ ] Upload PDF, DOCX, PPTX, XLSX, CSV, and a photo — each extracts with
      honest notes; DOCX/PPTX keep structure
- [ ] Upload a blurry handwritten photo → "check this interpretation" panel
      appears; edit → accept → solve uses the corrected text; retry works
- [ ] Upload a file with "ignore all previous instructions" text → warning
      appears; behavior unchanged

## 10. PWA (real devices)
- [ ] Android Chrome: install banner/Add to Home Screen → standalone launch,
      file + camera upload, assignment workflow end-to-end
- [ ] iPhone Safari: Share → Add to Home Screen → standalone launch, safe-area
      looks right, photo upload works
- [ ] iPad Safari: layout at tablet width, workspace usable
- [ ] Desktop Chrome/Edge: installable, responsive
- [ ] Layout check at 360, 390, 430 px: no horizontal scroll, dialogs fit,
      touch targets ≥44px
- [ ] New deploy → PWA picks up the update on next launch

## 11. Owner membership & invitation requests (added 2026-09-26)
- [ ] Owner opens `/owner`: sees total members, active members, pending
      invitations, and each member's status (pending/active/revoked)
- [ ] Owner invites `studentB@example.com` → link is single-use, tied to that
      email; signing up with a different email is refused (invitation 0002 +
      accept route email match)
- [ ] Owner revokes Student B → B visiting ANY route gets `/access-denied`;
      direct API calls fail; B's data is untouched and restored intact if the
      owner reactivates the account
- [ ] Owner grants Student A "can request invitations" → A sees the request
      form in Settings; A requests an invite for a friend → appears as
      `pending` on the owner dashboard
- [ ] A calling `/api/invitations` directly still gets 403 (only the owner
      creates invitations — enforced in RLS + route guard)
- [ ] Owner REJECTS the request → no invitation exists, the friend cannot
      sign up, request shows `rejected`
- [ ] Owner APPROVES → an invitation is created for that email → friend
      completes the normal invite-only signup → becomes an active member
- [ ] Owner analytics show aggregate only: total/active users, last-active
      timestamps, subject usage counts — Student A's essay text, answers, or
      teacher notes are NOT readable anywhere on the owner dashboard

## 12. Learning lifecycle (added 2026-09-26)
- [ ] Student A solves a calculus problem making a real mistake → feedback
      "correction" → the Corrections page (`/corrections`) shows the observed
      mistake with candidate status and low confidence
- [ ] Confirm it → status becomes Active, confidence ≥ 0.85
- [ ] Next calculus assignment: the "What was applied" panel lists the
      mistake under Learning applied — the AI watches for it
- [ ] Mark it "I don't make this mistake anymore" → status Corrected → the
      pattern no longer enters the AI context, and applied metadata omits it
- [ ] Make the same mistake again → the AI records a new observation → the
      pattern returns as Recurring (never silently)
- [ ] Biology assignment: calculus-scoped mistake does NOT appear in applied
      context (scope isolation, unit-tested in tests/run.ts §10)

## 13. Scoped feedback (added 2026-09-26)
- [ ] Feedback "my professor requires substitution" with scope "this teacher"
      → proposal targets that teacher's profile only
- [ ] Feedback scoped "this assignment only" → no profile change is proposed
- [ ] Feedback kinds available: Looks good / Something's wrong / Teacher
      corrected this / Use a different method / Teacher wanted something else /
      This is how I normally do it / That rule isn't correct anymore / Only
      for this assignment / Note
