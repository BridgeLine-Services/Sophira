# Sophira

A private, invite-only AI academic assistant. Sophira adapts to your courses, your
teachers' exact requirements, and your own writing style — from elementary school
through PhD work — and installs on your phone as an app.

Built with Next.js 14 (App Router), Supabase (auth + database + private storage,
with row-level security on every table), and an OpenAI-compatible AI provider.

## What Sophira does

- **Private by default.** Every table is protected by row-level security: your
  assignments, documents, writing samples, teacher profiles, and feedback are
  visible only to your account — not even the owner can browse them.
- **Teacher-aware.** A structured profile per teacher (required methods, notation,
  units, formats, citations, rubrics, worked examples, corrections). AI-extracted
  rules always land as *proposals* you approve or reject — nothing changes silently.
- **Your writing voice.** A Writing Profile built only from writing samples you
  provide (labeled preferred / neutral / not representative). It is applied only
  to writing tasks, and only where it doesn't violate the assignment's requirements.
- **Honest AI.** Verification is a self-check with a "Needs verification" status,
  never a fake guarantee. Unreadable documents produce a clear error, not invented
  text. If the AI provider isn't configured, the app says so plainly and preserves
  your work.
- **Installable.** A Progressive Web App — one tap on Android, "Add to Home
  Screen" on iPhone. No app store needed.
- **Invite-only network.** The owner manages membership from a dedicated Owner
  Dashboard: invite by email, approve or reject member-requested invitations,
  revoke and restore access instantly. Invitation links are single-use, tied to
  the invited email, and revocable — enforced in the database, not just hidden UI.
- **Privacy-safe ownership.** The owner sees who is a member and aggregate
  activity (active users, last-active times, subject usage counts) — never
  another member's essays, answers, teacher notes, or files. Owner analytics
  are aggregate-only at the database level.
- **Learns how you work.** Corrections you approve become structured learning
  patterns, each scoped (assignment / course / teacher / subject / global) so a
  calculus habit never leaks into biology. Mistakes have a real lifecycle:
  observed → confirmed → *corrected* → recurring if they return. The AI watches
  for active mistakes but never reintroduces a corrected one.
- **Seven modes:** Learn, Assignment, Check my work, Writing, Study, Explain
  simply, Custom.

## Architecture

```
src/
  app/
    api/
      ai/solve               # central engine: classify → retrieve rules →
                             #   solve → self-verify → persist (single honest call)
      ai/analyze-writing     # samples → style analysis → PENDING proposal
      ai/extract-teacher-doc # pasted doc → structured rules → PENDING proposal
      extract                # PDF/txt/image upload → text extraction + private storage
      invitations, invitations/accept, invitation-requests,
      learning/patterns, network/members, network/stats, account/delete
    owner/                  # owner-only dashboard: membership, invitation
                           #   requests, aggregate activity (RLS-enforced)
    corrections/            # learning & corrections: pattern lifecycle
                           #   (confirm, corrected, returned, temporary)
    access-denied/          # explicit state for revoked members
    (login, signup, reset-password, auth/callback)   # invite-only auth
    (dashboard, onboarding, courses, teachers, writing,
     assignments/new (intake wizard), assignments/[id] (workspace),
     library, settings, install)
  components/ (ui kit, AppShell, ResultBody, ProposalsPanel, PWA register)
  lib/ (supabase clients, AI client + prompt builders, types, modes)
supabase/migrations/  (0001 schema + RLS, 0002 owner-only invitations)
```

### Upgrade round 2: academic engines (2026-09-24, later)

- **Fine-grained math workflows** (`routeMathTopic`) — 15 sub-workflows
  (arithmetic → proof-based) each with method-specific guidance: calculus II
  must name its technique and show the substitution variable, linear algebra
  shows row operations one at a time, proofs never hide steps behind "clearly".
  A correct answer never excuses a different method than the teacher required.
- **Expanded independent verification** — mathjs now verifies six typed kinds:
  numeric evaluation, symbolic simplification equivalence, symbolic
  derivatives, equation identities at sample points, matrix
  det/product/transpose/inverse, and statistics. Statuses honestly say
  "Independently verified (numeric, symbolic)" vs "AI self-check only".
- **Method Compliance Check** — a separate card from mathematical correctness:
  required method, notation, steps, calculator restrictions, formatting, units.
  The normalizer demotes an overclaimed "compliant" if any check failed.
- **Document ingestion** — PPTX (slide text + speaker notes + table text, via
  JSZip), XLSX (all sheets, headers, formulas-as-values, via SheetJS), and CSV
  added to PDF/DOCX/TXT/Markdown/images. Everything keeps structure, and
  unreadable parts are named, never invented.
- **Handwriting workflow** — photos flagged as handwriting open a review panel
  with the AI's interpretation in an editable box: Accept / Edit / Retry /
  Cancel. Uncertain OCR is never treated as fact.
- **Source metadata** — teacher docs now carry description, effective date,
  and archived status; conflicts show dates and suggest the newer source
  without silently choosing. Migration 0004 adds the structured
  `academic_sources` table (authority 1–9, official/AI origin, supersedes
  links) and a richer version audit trail (field-level diffs, assignment and
  feedback origin, approval timestamps).
- **Version history compare** — each approved change shows previous → new
  values and links to the assignment that caused it; rollback remains
  append-only.
- **Citation honesty** — research/writing workflows now forbid citing anything
  except student-provided sources and label general model knowledge as such.
- **Injection defense expanded** — profile-change, exfiltration,
  teacher-rule-override, and privacy-probe patterns are detected and flagged.
- **Tests: 91 assertions** (was 47) including offline round-trip tests that
  build a real XLSX and PPTX and parse them back.
- See `docs/ACCEPTANCE_TESTS.md` for the live post-deploy acceptance runbook.

### Upgrade: personalization architecture (2026-09-24)

- **Academic context composer** (`src/lib/ai/context.ts`) — pure, unit-tested
  hierarchy engine. Scope inheritance: global student profile → course →
  teacher → assignment instructions; each layer explicitly overrides the one
  above. Teacher/course isolation is by construction (only the selected
  teacher's rules are ever loaded).
- **Subject router** (`src/lib/ai/subjects.ts`) — routes each task to a
  specialized workflow (math, physics, chemistry, biology, CS, writing/
  humanities, history, research, general) with its own prompting and
  verification strategy.
- **Independent verification stack** (`src/lib/ai/mathverify.ts`) — for
  math/physics/chemistry, the model emits `machine_checks` (arithmetic
  identities from its actual solution) that the server re-computes with
  [mathjs](https://mathjs.org). UI labels distinguish "independent
  computation" from "AI self-check" honestly (spec §40).
- **Prompt-injection defense** — every uploaded document and teacher doc is
  wrapped in UNTRUSTED DATA fences; obvious injection attempts are flagged to
  the student, never obeyed.
- **Source management** — teacher documents carry source dates and
  active/archived status; two active official sources with different dates
  produce a visible conflict notice (never silently resolved).
- **Feedback → proposal loop** (`/api/ai/feedback-to-proposal`) — a student
  correction can be analyzed for reusability and turned into a PENDING
  Teacher/Writing profile proposal. Nothing is applied without approval.
- **Profile versioning + rollback** (migration 0003) — every approved change
  snapshots the previous profile into `profile_versions`; the UI shows a
  version history with rollback on each Teacher and Writing profile.
- **"What was applied" panel** — each response stores `context_applied`
  (teacher rules, sources, course, writing profile, conflicts), and the
  workspace renders real backend state, never a decorative badge.
- **DOCX ingestion** — Word documents are parsed with mammoth, preserving
  headings, numbered lists, and tables instead of a wall of text.
- **Unit tests** — `npm test` runs 47 assertions covering teacher/course
  isolation, writing-profile conditionality, conflict detection, injection
  defense, subject routing, and the math verifier.

Key design decisions:

- **AI calls are server-only.** The API key never reaches the browser.
- **Approval-controlled learning.** `profile_update_proposals` holds proposed
  Teacher/Writing profile changes; the user approves or rejects them in the UI,
  and only then is anything applied.
- **Writing profile is conditional.** The classify stage decides whether a task
  is a writing task; math questions never receive writing-style instructions.
- **Instruction priority** (baked into the system prompt): current assignment
  instructions → official course rules/rubrics → teacher examples & corrections.
  Conflicts are surfaced to the user, never silently resolved.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run **all migrations in order**:
   `supabase/migrations/0001_init.sql` through `0012_research_tables.sql`
   (0001 schema + RLS + private `private-docs` bucket; 0002 owner-only
   invitations; 0003 profile versioning; 0004 sources + audit trail;
   0005 owner membership, invitation requests, learning patterns, aggregate
   owner analytics; 0006 invitation expiry; 0007 intentional habits;
   0008 invitation-only signup; 0009 typing calibration; 0010 deadline
   scheduling; 0011 rubric audits; 0012 research tables).
3. **Configure the owner email (required — signup is fail-closed without
   it).** Migration 0008 removed the old "first user to sign up becomes
   owner" rule (any stranger could claim ownership of a fresh install).
   The initial owner is now taken from `public.app_config`. Run once,
   replacing the address with the owner's real email:

   ```sql
   insert into public.app_config (key, value)
   values ('owner_email', to_jsonb('owner@example.com'::text))
   on conflict (key) do update set value = excluded.value;
   ```

   Until this is set, **every** signup (including the first) is rejected by
   the database with a clear operator-facing message — that is the intended
   fail-closed behavior, not a bug.
4. In **Authentication → Providers**, keep Email enabled. For a truly closed
   group, also set **Authentication → Sign In / Up → "Confirm email" on**, and
   consider disabling anonymous access. Signup is invitation-only **at the
   database level** (migration 0008): an account is only created when the
   registering email has a pending, unexpired invitation, or when the very
   first signup matches the configured owner email above.
5. From **Project Settings → API**, copy the project URL, anon key, and
   service-role key.

### 2. Environment

Copy `.env.example` to `.env.local` and fill in:

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | your Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** — never shipped to the client |
| `OPENAI_API_KEY` | leave empty to see the honest "not configured" state |
| `OPENAI_BASE_URL` | any OpenAI-compatible endpoint |
| `SOPHIRA_MODEL` | e.g. `gpt-4o-mini` (vision-capable models enable photo reading) |
| `NEXT_PUBLIC_SITE_URL` | deployed URL, used in invite links |

### 3. Run

```bash
npm install
npm run dev        # http://localhost:3000
```

The account configured as `owner_email` in `app_config` (step 3 above) becomes the
**owner** on first signup. The owner manages membership from the **Owner Dashboard**
(`/owner`): invite by email, copy the one-time `/signup?invite=TOKEN` link, approve or
reject invitation requests from members (the owner can grant a member permission to
*request* invitations for others — requests never create access on their own), and
revoke or restore access at any time. Revoked members get an explicit Access Denied
state on every route, not just hidden links.

## Deploy + install on your phone

1. Push to GitHub and deploy on any Node host (Vercel is the simplest: import the
   repo, set the environment variables above). Set `NEXT_PUBLIC_SITE_URL` to the
   production URL. HTTPS is required for installation.
2. Sign in on your phone:
   - **Android (Chrome):** menu ⋮ → *Install app*.
   - **iPhone (Safari):** Share → *Add to Home Screen*.
3. Sophira gets its own icon and full-screen window, and keeps you signed in.
   This is a PWA, not an App Store download — no store is needed.

For **App Store / Google Play** distribution you'd additionally need a wrapper
(Capacitor, Bubblewrap/PWABuilder) plus developer accounts and review processes —
optional and not required to use Sophira.

## Testing

- `npm test` — 285 unit/integration assertions: isolation, conditionality,
  conflicts, injection defense, subject + math-topic routing, all six verifier
  kinds, method-compliance honesty guards, offline round-trip parsing of a
  real XLSX and PPTX, the learning-pattern lifecycle (confirm → corrected →
  recurring, temporary caps), scope leakage (subject/course/teacher/global),
  honest applied-context metadata, and the §12 preserved-writing-habit
  guard (explicit opt-in, writing tasks only, requirements always win).
  Runs fully offline.
- **Native targets** (web app stays canonical): `android/` + `ios/` (Capacitor,
  real Gradle/Xcode projects) and `src-tauri/` (Tauri desktop app for
  Windows/macOS/Linux). See `docs/NATIVE_BUILDS.md` for builds, signing and
  the release pipeline (`.github/workflows/`). `/downloads` lists only
  artifacts the current release actually contains.
- `docs/MASTER_ACCEPTANCE_WORKFLOW.md` — the definitive end-to-end
  acceptance test (open → auth → access → course → teacher → assignment →
  upload → classify → solve → verify → correct → learn → persist → reuse →
  writing → override → save → logout/login → install → continue), with an
  honest per-area sign-off table.
- Live workflow verification (real auth, real Supabase, two accounts) is
  documented in `docs/ACCEPTANCE_TESTS.md` — see `TEST_REPORT.md` for which
  scenarios are unit-verified vs. what needs a live backend.
- `npm run build` — must pass with zero type errors (verified before every push).

See `TEST_REPORT.md` for the full scenario-based acceptance results, including
what is honestly still blocked on a live backend.

## Honesty guarantees

- If the AI is not configured, every AI feature returns a clear 503 and the UI
  preserves your input.
- Extraction failures say exactly what couldn't be read and why.
- The verification panel never claims a check that wasn't performed.
- Profile changes require explicit approval; every proposal can be rejected.


---

## Proprietary Software — All Rights Reserved

Sophira is **proprietary software**. All rights are reserved by the copyright
holder under the [LICENSE](LICENSE) file. This is not open-source software:
copying, redistribution, modification, and commercial exploitation are
prohibited without express written authorization. See
[docs/legal/TERMS_OF_SERVICE.md](docs/legal/TERMS_OF_SERVICE.md) and
[docs/legal/PRIVACY_POLICY.md](docs/legal/PRIVACY_POLICY.md) (templates with
placeholders — see docs/legal/LEGAL_REVIEW_NOTICE.md).

## Feature status (honest, 2026-09-27)

| Feature | Status |
| --- | --- |
| Core assignment/AI/learning/verification workflow | Implemented + automated tests |
| RLS isolation, invite-only auth, injection defenses | Implemented + automated tests |
| PWA, /install, /downloads, native projects | Implemented; live at https://sophira.vercel.app |
| Typing calibration (WPM/accuracy/baseline) | **Implemented and user-accessible** — onboarding step + Settings test (`TypingTest`), server-recomputed metrics (`/api/typing`), per-user `typing_attempts`/`typing_baseline` (RLS), user-chosen baseline, retake any time (migrations 0009; live-verify against your deployment) |
| Paced output | **Implemented and user-accessible** — `PacingController` on top of the existing pacing engine reveals the verified response at the calibrated pace with pause/resume, progress bar and instant mode; no calibration → honest message + link, no invented speed (`PacedOutput` in the writing workspace; no per-character DB writes) |
| Deadline-aware scheduling | **Implemented and user-accessible** — real `due_at` on assignments, workload estimation (user estimate wins), deterministic plans via the existing scheduler (`/api/schedule`, `SchedulePanel`, 10s–6h bounded breaks, feasibility warnings, start/pause/resume, persisted `work_schedules` with RLS; migration 0010) |
| Rubric compliance | **Implemented and user-accessible** — structured checklist parsed from instructions/teacher rubrics, deterministic post-generation audit (word count, sections, citations, bibliography, prohibited elements), AI-assessed semantic criteria clearly labeled, one-click revision loop, audits persisted (`rubric_audits`, migration 0011) |
| Verified web research | **Implemented backend + UI; requires external configuration to run** — real server-side search via a configurable provider (`SEARCH_PROVIDER`/`SEARCH_API_KEY`/`SEARCH_BASE_URL`; Brave, Tavily, or Brave-compatible custom), every candidate URL fetched and verified (redirects, dead links, paywalls, thin content), source approval, deterministic MLA/APA/Chicago/generic citations from source records, citation/quote audit with live re-verification (`/api/research`, `/api/research/audit`, `ResearchPanel`; migrations 0012). Without a provider key the research workflow reports honestly and fabricates nothing. Live end-to-end verification pending a configured provider. |
| Claim→evidence traceability (research integrity) | **Implemented and unit-tested (offline)** — every factual claim in a researched essay traces CLAIM → SOURCE → EXACT SUPPORTING PASSAGE → SOURCE URL → STATUS (`src/lib/research/claims.ts`, migration 0013). A claim is VERIFIED only when the stored retrieved content actually supports it: verbatim passage, matching figures, substantive overlap — never merely a live URL or matching title. Unsupported claims are explicitly listed (claim / reason / required action) in a final Research Integrity report appended to the essay; the essay generator is blocked from declaring research complete while required claims are unsupported; a source that disappears after initial verification demotes its claims to UNVERIFIED at audit time. 41 automated assertions (suite: 326). |
| Submission readiness + stale-pattern detection | **Implemented and unit-tested (offline)** — one mechanical per-assignment verdict (`src/lib/readiness.ts`, `/api/readiness`, `ReadinessPanel`): draft present, verification passed (failed machine checks block), teacher method compliance, rubric criteria satisfied, research claims fully supported; n/a checks never block and undeterminable states are reported, never guessed. Learning patterns unobserved for 180 days stop shaping AI context (never deleted; re-observation self-heals; UI shows the staleness reason). Suite: 350. |
Assignment-aware source authority | **Implemented and unit-tested (offline)** — the research ranker (unchanged, still the generic fallback) is extended with `src/lib/research/authority.ts`: the assignment is classified (history / science / current events / literature / social science / general), a configurable authority-profile tier hierarchy is applied, teacher requirements OVERRIDE generic preferences absolutely, .gov/.edu are never blindly prioritized, and each source's acceptance decision (tier, flags, reasons) is stored (migration 0014) so the citation audit explains why every source was accepted. Suite: 393. |