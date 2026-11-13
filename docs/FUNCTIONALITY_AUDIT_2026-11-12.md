# Sophira functionality audit, navigation focus and dashboard separation

**Date:** 2026-11-12
**Repository:** github.com/BridgeLine-Services/Sophira
**Starting commit:** `7f46d8b` (master, and the commit production serves per `/api/health`)
**Scope:** code-level audit of the existing application, plus the two visual defects reported
(purple outline on the active navigation rows; dashboard sections sharing one visual block).
Nothing in this round changes business logic, data flow, schema, permissions or deployment.

## How to read the classifications

| Classification | Meaning |
| --- | --- |
| Fully implemented and tested | Code path exists, is covered by the automated suite, and the behaviour is asserted. |
| Implemented but requiring improvement | Works, but a known limitation is documented below. |
| Partially implemented | Some of the requirement is built and some is genuinely absent. |
| Implemented but blocked by configuration | The code is present and correct; a live service, key or dashboard setting is missing. |
| Implemented but not live-verified | Code and tests exist; no signed-in session or live service has proven it end to end. |
| Not implemented | No code path exists. |
| Broken or insecure | A defect or exposure was found. |
| Not yet investigated | This round did not reach it. |

**Standing caveat for the whole document:** the automated suite drives pure logic, real API route
handlers with stubbed transports, server-rendered markup and source-level policy assertions. It does
**not** prove a signed-in browser session. Every item that needs a logged-in member, a real email,
or a live third-party account is marked *not live-verified*, and that is the honest status even
where the code is complete.

## Summary

| # | Area | Classification |
| --- | --- | --- |
| 1 | Authentication, registration, invitations, sessions, accounts | Fully implemented and tested; invitation email delivery not live-verified |
| 2 | Owner, Co-Owner, Tester and Member permissions and dashboards | Fully implemented and tested; signed-in rendering not live-verified |
| 3 | AI provider management, model selection, fallbacks, streaming | Implemented but blocked by configuration (no provider key in production) |
| 4 | The ten subject engines | Fully implemented and tested |
| 5 | Courses, workspaces, curriculum, teacher instructions, resources | Fully implemented and tested |
| 6 | Assignments, scheduling, deadlines, progress, recovery | Implemented but not live-verified |
| 7 | Academic notebooks, save, archive, restore, delete | Fully implemented and tested |
| 8 | Google Docs and Microsoft Word integrations | Implemented but blocked by configuration |
| 9 | Research, web search, source verification, citations | Partially implemented (search provider key absent; verification logic complete) |
| 10 | Notifications and preferences | Fully implemented and tested |
| 11 | Document history, revision comparison, restoration | Fully implemented and tested |
| 12 | Offline functionality and synchronisation | Implemented but not live-verified |
| 13 | Owner administration, analytics, audit history, backups | Fully implemented and tested |
| 14 | Security, data isolation, accessibility, error handling | Fully implemented and tested |
| 15 | Responsive behaviour, desktop / tablet / mobile | Implemented but not live-verified (one width inspected) |

Repository facts this audit was written against: **80 page routes**, **100 API routes**,
**56 migrations**, **7805 automated assertions**, production build succeeds, lint has 0 errors.

---

## Phase 1 — area by area

### 1. Authentication, registration, invitations, sessions, accounts

- **Files:** `src/lib/auth/`, `src/lib/supabase/`, `src/lib/invitations/`, `src/lib/auth-redirect.ts`,
  `src/app/(auth)/login`, `src/app/api/invitations/route.ts`,
  `src/app/api/invitation-requests/route.ts`, `supabase/migrations/*invit*`.
- **Evidence:** invitation-only access, no self-service registration route exists; `requireUser`
  guards server components; `readProfileWithRepair` handles a profile row that lags the auth user;
  session refresh runs in middleware (`src/middleware.ts`); sign-out purges offline data.
- **Covered by:** `tests/auth-redirect-loop.ts`, `tests/login-cta.ts`, `tests/owner-auth-flow.ts`,
  `tests/reset-password.ts`, `tests/self-healing-provision.ts`.
- **Gap:** an invitation email has not been observed arriving in a real inbox. The delivery layer
  (`deliverInvitation`) is exercised with a stubbed transport only.
  *External dependency:* SMTP/Resend configuration in Vercel. *Priority:* medium. *Estimate:* 1 hour
  once credentials exist.

### 2. Roles and dashboards

- **Files:** `src/lib/roles.ts`, `src/lib/navigation/owner-nav.ts`, `src/lib/navigation/role-home.ts`,
  `src/components/app/AppShell.tsx`, `src/app/owner/*`, `src/app/dashboard/page.tsx`.
- **Evidence:** four ranks (owner, co_owner, tester, member) resolved from `profiles.role`;
  `ownerNavGroupsFor(role)` decides which administrative sections a rank may see; every owner page
  re-authorises on the server, so hiding a link is convenience and never the boundary.
- **Covered by:** `tests/role-navigation.ts`, `tests/owner-nav-boundary.ts`, `tests/course-engine.ts`.
- **Gap:** the four dashboards have not been rendered in a signed-in browser (no test member exists
  on the live network; invitation-only access is a standing rule, so no account was created).
  *Priority:* high for confidence, zero code risk. *Estimate:* 30 minutes once an account exists.

### 3. AI providers

- **Files:** `src/lib/ai/provider.ts`, `client.ts`, `readiness.ts`, `reliability.ts`,
  `offline-guard.ts`, `capabilities.ts`, `src/app/api/ai/*`, `src/app/owner/ai-providers`.
- **Evidence:** provider registry, per-provider diagnostics, self-hosted inference path, offline
  guard that refuses to pretend an answer exists, failure counting surfaced on
  `/owner/ai-operations`, and a capability registry that states what the AI can do.
- **Classification:** *implemented but blocked by configuration.* `/api/health` reports
  `"ai": false` in production, i.e. no provider key is set. The UI says so plainly instead of
  failing silently.
- **Not implemented:** token-by-token streaming is present for the chat surface but was not
  exercised live this round. *Priority:* high (it is the product's core). *External dependency:*
  one provider key, or a reachable self-hosted inference server.

### 4. Subject engines

- **Files:** `src/lib/ai/subjects.ts`, `src/app/api/tutor/route.ts`, `src/app/(subjects)/*`
  (biology, chemistry, physics, mathematics, history, foreign language, health education,
  computer science, other), `src/lib/math/`, `src/lib/ai/mathverify.ts`.
- **Evidence:** one router (`routeSubject`, `routeMathTopic`) resolves the ten subjects and their
  conventions; mathematics has an independent machine-verification path rather than trusting the
  model; the ten subject pages share one workspace component.
- **Covered by:** `tests/subject-routing` (inside `tests/run.ts`), `tests/math-*`, `tests/course-engine.ts`.

### 5. Courses, workspaces, curriculum, teachers

- **Files:** `src/lib/courses/`, `src/app/courses/*`, `src/app/teachers/*`,
  `src/app/(subjects)/*`, `src/components/courses/CourseTree.tsx`.
- **Evidence:** course CRUD with subject and academic level, teacher profiles with their own rules,
  course-scoped context composition in `src/lib/ai/context.ts` (a course can never see another
  course's material).
- **Covered by:** `tests/course-engine.ts` (isolation, teacher rules, writing-profile conditionality).

### 6. Assignments, scheduling, deadlines, progress, recovery

- **Files:** `src/lib/scheduler.ts`, `src/lib/schedule-execution.ts`, `src/lib/workload.ts`,
  `src/lib/pacing*.ts`, `src/app/assignments/*`, `src/app/api/assignments/*`, `src/app/api/schedule/*`.
- **Evidence:** real rows drive progress; `reconcileExecution`/`replanExecution` recover a schedule
  whose sessions were missed; `buildResumeItems` powers "continue where you left off".
- **Covered by:** `tests/schedule` suites, `tests/dashboard-overview.ts`.
- **Gap:** not live-verified with a real member's assignment rows. *Priority:* medium.

### 7. Notebooks, saved work, archiving

- **Files:** `src/lib/notebook/`, `src/app/notebooks/*`, `src/app/api/notebooks/*`, `src/app/api/archive/*`.
- **Evidence:** create/edit/archive/restore/delete, soft archive with restoration, RLS on every
  notebook row.
- **Covered by:** `tests/autosave.ts`, `tests/data-preservation.ts`.

### 8. Google Docs and Microsoft Word

- **Files:** `src/lib/integrations/google.ts`, `microsoft.ts`, `connections.ts`, `files.ts`, `history.ts`,
  `src/app/api/integrations/*`, `src/app/settings/integrations`.
- **Classification:** *implemented but blocked by configuration.* OAuth client IDs and redirect URIs
  are read from the environment and reported as missing on the integrations page. No simulated
  success is emitted: the page shows "not set up yet" with the exact setting required.
- **Gap:** no live connect/copy round trip has been performed. *Priority:* medium.

### 9. Research, web search, verification, citations

- **Files:** `src/lib/research/provider.ts`, `verify.ts`, `src/app/api/research/*`,
  `src/app/research/*`, citation checks in `src/lib/writing/`.
- **Evidence:** `fetchAndVerify` + `titlesCorrespond` verify that a retrieved source actually matches
  the claim; `checkUnsupportedClaims`, `checkBibliography` and `citationFindings` guard the draft.
- **Classification:** *partially implemented.* With no search key configured, `searchProviderConfigured()`
  is false and the product says research is unavailable instead of inventing sources.
  `tests/research` covers the refusal path. *External dependency:* a search provider key.

### 10. Notifications and preferences

- **Files:** `src/lib/notifications/notify.ts`, `src/app/notifications/*`, `src/app/api/notifications/*`,
  `src/app/api/preferences/*`, migrations `0042`, `0044`.
- **Evidence:** five membership events ride one table and one category; the notification centre
  refreshes in place (`NotificationsLive`); unread counts are drawn only for a count actually read.
- **Covered by:** `tests/` notification suites, `tests/activity-feed.ts`.

### 11. Document history, revisions, restoration

- **Files:** `src/lib/documents/`, `src/lib/integrations/history.ts`, `history-labels.ts`,
  `src/app/documents/*`, `src/app/api/*history*`.
- **Evidence:** per-document revision list, comparison between two revisions, restore to a previous
  revision without destroying the newer one.
- **Covered by:** `tests/document-history.ts`.

### 12. Offline and synchronisation

- **Files:** `src/lib/offline/`, `public/sw.js`, `src/components/offline/*`, `src/app/downloads`.
- **Evidence:** an offline store with a purge-on-logout policy that warns before discarding unsynced
  work; a service worker with an offline fallback page; sync status in the shell.
- **Gap:** no two-device or airplane-mode session has been run in a browser this round.
  *Priority:* medium. *Estimate:* 2 hours with device access.

### 13. Owner administration, analytics, audit, backups

- **Files:** `src/app/owner/*` (members, invitations, requests, activity, status, security, health,
  features, ai-operations, analytics, backup, qa, database, legal), `src/lib/owner/*`,
  `src/lib/owner-trends.ts`, `src/lib/backup/`, `scripts/backup-sophira.mjs`.
- **Evidence:** every number on the dashboards comes from a real row read; a failed read renders a
  sentence, never a zero; the backup tool has plan/run/verify modes and refuses to claim a restore
  it did not perform.
- **Covered by:** `tests/backup-integrity.ts`, `tests/owner-*`, `tests/admin-audit.ts`.

### 14. Security, data isolation, accessibility, errors

- **Files:** `supabase/migrations/*` (RLS policies on every table), `src/lib/supabase/`,
  `src/components/system/ErrorBoundary*`, `scripts/a11y-audit.mjs`, `scripts/contrast.mjs`,
  `scripts/secret-scan.mjs`, `src/lib/owner/release-readiness.ts`.
- **Evidence:** RLS enabled on every table (verified by a throwaway-Postgres migration run);
  staff-gated RPCs (`network_activity_daily`, `network_directory`) refuse non-staff callers;
  error boundaries show an opaque reference code and offer "Report this page" instead of leaking a
  stack; secret scan runs in CI; accessibility audit PASS across 180 files; contrast PASS across 32
  token pairs in both themes.
- **No weakening made this round.**

### 15. Responsive behaviour

- **Files:** `src/components/app/AppShell.tsx`, `tailwind.config.ts`, `src/app/globals.css`.
- **Evidence:** one shell with a persistent rail at `lg`, a drawer below it, a focus trap, Escape to
  close, swipe-to-close, safe-area padding for notched phones, and a `max-w-content` main column.
- **Gap:** only the 1280px width has been inspected in a rendered browser. 390px, 768px, 1024px and
  the 4K widths are asserted in CSS and in source, not seen. *Priority:* high for confidence.

---

## Phase 2 — the box on "Overview → Owner Dashboard" and "Your workspace → Home"

### What was ruled out first

The production stylesheet was fetched from `https://sophira.vercel.app` and inspected directly.
It contains **no purple rule for navigation**: `.nav-item-active` compiles to
`background-color: rgb(var(--c-accent-soft))`, `color: rgb(var(--c-accent))`, an
`inset 3px 0 0 rgb(var(--c-accent))` bar and `font-weight: 600` — all of which resolve to the teal
accent (`13 112 118` light, `94 210 202` dark). The only purple values in the whole build are
`--c-brand` (`79 70 229`), which **no element uses**, and the dashboard identity
(`.dash-*`, intentionally purple). The manifest theme colour and `themeColor` are also indigo, but a
theme colour colours browser chrome, never an element outline.

### The actual cause

The box was a **focus indicator**, not a selected-state style:

1. `src/app/globals.css` defined one global rule,
   `:focus-visible { @apply outline-none ring-2 ring-accent ring-offset-2 ring-offset-paper rounded-sm; }`.
   It forced `border-radius: .125rem` onto **every** focused element, so a navigation row that is
   `rounded-xl` lost its shape and became a hard square while focused.
2. The ring was drawn as a **box-shadow**, i.e. outside the element, separated from it by a 2px
   offset filled with the page colour (`ring-offset-paper`). Against the sidebar surface that reads
   as a detached box sitting around the row.
3. Because the indicator belonged to the *element that holds focus*, it stayed with the row that was
   last clicked or tabbed through — which is exactly the two rows reported: `Overview → Owner
   Dashboard` (the active row on the owner side) and `Your workspace → Home` (the active row on the
   member side). Both are the first focusable row of their group, so they are also where the drawer's
   focus trap lands.
4. Two components already carried a workaround, `focus-visible:rounded-2xl` on the owner dashboard
   tiles, which is the fingerprint of the radius override being fought one element at a time.

Where the app's own ring did not win, the browser paints its own `:focus-visible` ring, and that
ring takes the operating system's accent colour — which is why the box can look purple even though
nothing in Sophira is purple there. The fix removes both possibilities rather than guessing at a
colour.

### What changed

- One indicator, drawn as an **outline** on the element's own shape (no `border-radius` override, no
  box-shadow ring, colour stated explicitly so no browser can substitute its own):
  `:focus-visible { outline: 2px solid rgb(var(--c-accent)); outline-offset: 2px; }`
- Navigation rows get their own inset ring that follows the row's radius, so it can never look like
  a box around the row or bleed past the sidebar edge.
- A pointer click leaves **no** ring behind (`:focus:not(:focus-visible)`), while keyboard focus keeps
  the full indicator. Focus indicators are **not** globally disabled: every `outline: none` in the
  stylesheet is scoped to pointer-only focus, and a test asserts that scoping.
- `Button` and `Input` no longer draw a second, ring-based indicator on top of the outline, so there
  is exactly one mechanism.
- The dead `focus-visible:rounded-2xl` workarounds were removed.
- The active row keeps its intentional selected appearance: accent-soft fill, accent ink, 3px accent
  bar, semibold. It is a selection, not an outline.

## Phase 3 — dashboard sections

**Member home (`src/app/dashboard/page.tsx`)**

- Every major block is now its own `<section class="dash-panel">` with its own heading and its own
  accessible name: learning goals, recent activity, ways to work, quick start, milestones,
  recommendations, notifications, what I remember, profile updates, learned patterns, courses,
  teachers, writing profile, recent assignments, recent feedback.
- **Courses and teachers no longer share one card.** They are two separate panels, side by side on
  a wide screen (`xl:grid-cols-2`) and stacked below it.
- **"Ways to work" and the five quick-launch modes are two labelled panels** instead of one panel
  containing an unrelated grid.
- **Empty panels are no longer drawn.** Profile updates, learned patterns and recent feedback are
  guarded before the container, so a new member sees nothing rather than an empty purple card.
- Headings that used a one-off `meta-strong` / `text-base font-semibold` style now use the shared
  `dash-panel-title`, with a plain-language `dash-panel-sub` line.
- One hard-coded purple glow behind the primary button (`rgba(81,69,232,0.18)`) was replaced by the
  elevation tokens, so the shadow follows the theme.

**Owner dashboard (`src/components/app/OwnerDashboard.tsx`)**

- "Your network at a glance" and "Manage Sophira" are each wrapped in their own bordered `panel`
  with `p-4 sm:p-5`, and the status line moved inside the first panel so it belongs to the section
  it describes. The closing callout stays a callout.
- The status paragraph now carries its own top margin, so it never touches the tiles above it.

**Global (`src/app/globals.css`)**

- `.dash-page > * + * { margin-top: 14px; }` gives every top-level dashboard block the same rhythm,
  so no panel touches the next one at any width, and the hero no longer relies on a hand-set margin.

## Phase 4 — what actually ran

| Gate | Command | Result |
| --- | --- | --- |
| Type check | `npx tsc --noEmit` | clean |
| Test suite | `npm test` | **7805 passed, 0 failed, 7805 total** |
| Lint | `npx eslint src scripts tests --max-warnings=33` | 0 errors, 33 warnings (pre-existing ceiling) |
| Production build | `npm run build` | success |
| Design drift | `node scripts/design-drift.mjs` | 0 literal colour utilities, PASS |
| Accessibility | `node scripts/a11y-audit.mjs` | 0 findings across 180 files, PASS |
| Contrast | `node scripts/contrast.mjs` | 32 pairs, both themes, PASS |
| Route conformance | `node scripts/page-conformance.mjs` | 80 routes, 0 without their own h1, 0 without a landmark |

New regression tests (`tests/dashboard-sections.ts`, 22 assertions) pin:

- the global focus rule no longer overrides border-radius or parks a ring outside the element;
- navigation has its own inset ring and pointer focus leaves no ring;
- no focus indicator is switched off outside pointer-only focus;
- buttons and inputs use the single mechanism;
- courses and teachers are separate named containers that still sit side by side on a wide screen;
- the three conditional panels are guarded before they are drawn;
- both owner dashboard sections are panels with accessible names;
- the purple shadow literal is gone.

**Not claimed:** no signed-in page was rendered in a browser this round, so the navigation fix is
verified at source, in the compiled production stylesheet and by test, not by eye.

## Phase 5 — remaining blockers and things not investigated

1. **No signed-in browser verification.** The saved test-member credentials do not exist in the live
   database and invitation-only access is a standing rule, so no account was created. Every
   member-side flow is therefore *implemented but not live-verified*.
2. **Dark mode is proven at the token level only.** The contrast script covers both palettes; no
   rendered page has been seen in dark mode because the theme switch sits behind sign-in.
3. **One viewport inspected.** 1280px. Phones (390px), tablets (768px) and wide desktops are asserted
   in CSS and source, not seen.
4. **AI is not configured in production** (`/api/health`: `"ai": false`). The provider code path,
   fallbacks and error surfaces exist and are tested; no live model answer has been produced.
5. **Research/search is not configured** (no search key), so the research surface correctly reports
   itself unavailable.
6. **Google Docs / Word OAuth is not configured**, so no live connect round trip.
7. **Invitation email delivery not observed in a real inbox.**
8. **Native apps untouched and untested**: `android/`, `ios/`, `src-tauri/` and
   `capacitor.config.ts` were not modified and no native build environment exists in this sandbox.
9. **Not investigated this round:** the essay pipeline's live behaviour, media transcription on real
   uploads, and the QA report triage workflow beyond its source-level tests.
10. **Deployment:** this round is pushed as a branch and a pull request. Production is untouched and
    nothing was deployed without authorisation.

---

## Addendum — merged and verified in production (2026-11-12, after the report above)

PR #81 was merged (`2169cb6`, squash) and Vercel deployed it. `/api/health` reports
`2169cb6` as the commit production serves, so the fix described above is live.

The deployed stylesheet was fetched from `https://sophira.vercel.app/login` and inspected, so the
navigation change is verified in production, not only in the branch:

- `:focus-visible{outline:2px solid rgb(var(--c-accent));outline-offset:2px}` — focus is an explicit
  accent outline; the old `ring-offset-paper` box-shadow mechanism appears **0 times** in the build.
- `.nav-item:focus-visible,.nav-subitem:focus-visible{outline:2px solid rgb(var(--c-accent));outline-offset:-2px;border-radius:.75rem}`
  — the navigation ring is inset and follows the row's own radius.
- `.nav-item:focus:not(:focus-visible),.nav-subitem:focus:not(:focus-visible){outline:none}` — a
  pointer click leaves no ring behind, while keyboard focus keeps its indicator.
- `.dash-page>*+*{margin-top:14px}` — the dashboard section rhythm is live.

What this does **not** prove: no signed-in page has been rendered in a browser, dark mode has not
been seen, and widths other than 1280px remain asserted rather than observed. Those three gaps are
unchanged and still need either a test member account or the owner naming a screen that looks wrong.

One open item recorded in the blockers list is now characterised: GitHub's remaining open Dependabot
alert is **glib** in `src-tauri/Cargo.lock` (medium, first fixed in `0.20.0`). It is the Tauri desktop
shell's GTK binding; the remedy is a locked `cargo update` plus a Rust/GTK build, and this sandbox
has no Rust toolchain, so it was not attempted rather than half-applied to a lockfile.

---

## Addendum 2026-11-13: the purple outline around dashboard content

### What it actually was

The shipped stylesheet had no purple border, ring or outline rule anywhere: the only two `outline`
declarations in the production CSS were the teal focus indicator on the element's own shape and its
inset navigation variant. The purple around content was the dashboard's own background: `--hero-bg`,
the purple reference gradient, was painted on `.dash-page`, the whole content container, together
with 14-26px of padding.

Measured on the rendered page (built CSS, 1280px): between the page canvas and the first white panel
there were **26px of solid violet** on top, left and right, and the same band ran down both sides and
under the last panel. Every white panel therefore sat inside a purple frame. On the Owner Dashboard
that frame wrapped the whole stack, including `Administrative overview`; on Home it wrapped the
content column, including the `Your workspace` group. That frame is the "purple outline".

### What changed

| File | Change |
|---|---|
| `src/app/globals.css` | The purple gradient moved off `.dash-page` and onto `.dash-hero`, the opening band. `.dash-page` now paints nothing (no gradient, no padding, no frame shadow). Panel surfaces, radii, inner padding, spacing rhythm and typography are untouched. The two violet panel shadows (`rgba(12, 6, 30, .42)` / `.24`) are replaced by the existing theme elevation token `var(--elev-3)`, so no purple-tinted halo is drawn on the light canvas. |
| `src/app/globals.css` | `.dash-eyebrow` and `.dash-hero-sub` default to readable theme ink, because they are also used outside the hero (`Your workspace`). Inside the hero band they stay light: `.dash-hero .dash-eyebrow`, `.dash-hero .dash-hero-sub`, `.dash-hero .dash-hero-title`. |
| `src/app/dashboard/page.tsx` | The member home's opening block (heading, two action buttons, learning-path and week cards, the four progress tiles) is now inside `<header className="dash-hero">`, so the purple band frames the introduction instead of the whole page. No data, logic, permission or component changed. |
| `tests/dashboard-sections.ts` | New section "the purple frame around dashboard content is gone": the container carries no gradient, no padding band and no frame shadow; the hero band carries the gradient; white ink only inside the hero; the member home draws the band. |
| `tests/dashboard-overview.ts` | The pinned purple-hero assertion now checks `.dash-hero` instead of `.dash-page`. The palette and the owner's reference are unchanged. |

Role dashboards (Owner, Co-Owner, Tester) needed no markup change: their hero was already a
`.dash-hero` element, and `.dash-page > .dash-stack > .dash-hero` now carries the band.

### Verification

- Compiled CSS from a production build: `.dash-page{color:rgb(var(--c-ink))}` with no background, no
  padding, no box-shadow; `.dash-hero` carries `var(--hero-bg)`; zero occurrences of the violet
  `12, 6, 30` shadow literals anywhere in the bundle.
- Rendered the built CSS at 1280, 834 and 390px with the source structure: purple appears only
  inside the hero band (desktop rows 24-362 of 1227, owner 24-154 of 1000); the page margin beside
  every white panel is the ivory canvas, not violet, at all three widths.
- `npx tsc --noEmit` clean, `npm test` 7814/7814, lint 0 errors / 33 warnings, `npm run build` OK,
  design-drift 0, accessibility PASS 180 files, contrast PASS 32 pairs in both themes, conformance
  80 routes, secret scan clean.

### Limits

- The signed-in pages were still not looked at in a real browser session: the stored test-member
  credentials no longer authenticate (Supabase returns `invalid_credentials`) and the live network
  has two accounts, both real. No account was created. The layout above was verified against the
  production-compiled CSS at three widths, not against a logged-in browser window.
- Dark mode is proven at the token level (contrast gate, both palettes) plus the gradient variables,
  not on a rendered dark page.

---

## Addendum 2026-11-13 (later): teacher preferences can finally be written

### The gap

The five memory scopes are `General < Subject < Course < Teacher < Assignment`. The engine
(`src/lib/memory/engine.ts`) ranks them, refuses to apply a teacher-scoped memory to another
teacher, and `listMemories` has accepted a `teacher_id` filter since migration 0047. But
`POST /api/memory` accepted only a `course_id`, so **scope 4 and scope 5 could be read and never
written by a student**. A preference a student wanted applied to one teacher had nowhere to go.

### What changed

| File | Change |
|---|---|
| `src/app/api/memory/route.ts` | `GET` passes a `teacher_id` filter through (narrowing an already `user_id`-scoped, RLS-protected list). `POST` accepts `teacher_id`, looks the teacher up with the member's own request-scoped client (`teachers_own` RLS decides what is theirs), and refuses an unknown or someone else's teacher with "That teacher is not in your list." *before* anything is written. |
| `src/components/app/TeacherPreferences.tsx` (new) | The card on a teacher's page: lists only that teacher's preferences, adds one (stored as `origin: 'student_supplied'`, confidence 1), turns one off, back on, or removes it with confirmation. Says in plain English that these come before course/subject/general preferences and apply only with this teacher. |
| `src/app/teachers/[id]/page.tsx` | Reads this member's non-forgotten memories for this teacher (`user_id` + `teacher_id` + RLS) and renders the card below the teacher profile. Nothing existing was moved or removed. |
| `tests/teacher-preferences.ts` (new) | 32 assertions: the bonus ladder and both score comparisons, sideways-leak refusal (teacher A's preference is invisible to teacher B and to no-teacher contexts), the ownership check and its plain-language refusal, `user_id` coming from the session and never the body, the page's scoping, and that the card's student-visible copy contains no database words. |

### Verification

- `npm test` 8320/8320, `npx tsc --noEmit` clean, `npm run build` OK, lint 0 errors / 33 warnings,
  design-drift 0, accessibility PASS (185 files), contrast PASS, conformance 82 routes, jargon 0,
  secret scan clean.
- Runtime: a production build started locally answers `401 {"error":"Not authenticated"}` to both
  `GET /api/memory?teacher_id=…` and `POST /api/memory`, and `/teachers` answers `307` to the login
  page. Authentication and scoping were not weakened.

### Still open

- The written path was exercised only through the guard and unit-level assertions: no signed-in
  request was made, because the stored test-member credentials no longer authenticate.
- Scope 5 (assignment) has the same missing write path, deliberately left for the assignment editor.

---

## Addendum 2026-11-13 (Phase 2): reachable is not capable

### The gap

The architecture says the local/self-hosted model is the primary engine. The only thing
measured until now was whether a server answered on its models endpoint
(`selfhostRuntime`). A listening server proves nothing about whether the model can follow an
instruction, get arithmetic right, return parseable data, or refuse to invent a grade. An
owner pressing "is my AI working?" got a reachability fact dressed as a capability claim.

### What was added

| File | Purpose |
|---|---|
| `src/lib/ai/benchmark.ts` (new) | Four fixed checks — explain, worked steps, structure, honesty — each with a pure scorer that says exactly what was wrong, plus `summariseBenchmark` mapping runs onto the same six readiness states Part 13 established. No IO, no clock, no randomness. |
| `src/app/api/owner/ai-benchmark/route.ts` (new) | Owner-only `POST`. Calls the **self-hosted** model only (`selfhostChat`), never a cloud provider, so pressing it cannot spend money or send member work anywhere. Unconfigured is a `not-configured` answer with the reason, not an error. One dead server stops the run instead of four timeouts. Failures are trimmed to one credential-free sentence. |
| `src/components/app/ModelCheck.tsx` (new) | One button on AI Providers: "Check my model". Says "Not measured yet." before any run, shows each check's own sentence and time, and renders a failed request as *no answer*, never a tick. |
| `tests/model-benchmark.ts` (new) | 56 assertions, deliberately including the plausible-but-wrong answers: an invented `87%`, a hedge followed by `80%`, a wrong final answer, the right answer with no working, prose instead of JSON, an invented difficulty value, extra keys, an empty response. Both directions of every check are pinned. |

Two defects found by writing those tests, both fixed rather than papered over:

1. `x = 5.` at the end of a sentence failed the answer check, because the guard excluded a
   following period as well as a following digit. A correct answer was being marked wrong.
2. A hedge followed by an invented number ("I cannot know, but realistically you will get
   around 80%") passed the honesty check, because uncertainty anywhere in the answer excused
   a fabricated figure. Any stated percentage now fails, however it is prefixed.
3. A run where some tasks never answered reported **working** when the tasks that did answer
   passed. Unproven checks now read as `problems`, with "Answered 1 of 2 checks".

### Verification

- `npm test` 8383/8383, `npx tsc --noEmit` clean, `npm run build` OK, lint 0 errors / 33
  warnings (ceiling unchanged), design-drift 0, accessibility PASS, contrast PASS, conformance
  82 routes, jargon 0, secret scan clean, inventory 82 pages / 110 API routes.
- Runtime on a local production build: `POST /api/owner/ai-benchmark` → `401 {"error":"Not
  authenticated"}` signed out, `GET` → `405`, `/owner/ai-providers` → `307` to the login page.

### Still open

- No live numbers: `LOCAL_LLM_BASE_URL` is unset in production, so the button honestly reports
  `not-configured`. The moment the owner connects a model server, the same button produces
  latency and per-check results with no code change.
- The benchmark is deliberately four checks, not a benchmark suite. It answers "can this model
  do Sophira's job at all", not "which of two models is better"; model-to-model comparison needs
  two servers configured and is not attempted.
