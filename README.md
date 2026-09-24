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
      invitations, invitations/accept, account/delete
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
2. In the SQL editor, run the migrations in order:
   `0001_init.sql` → `0002_owner_only_invitations.sql` →
   `0003_profile_versions_and_context.sql` → `0004_sources_and_audit.sql`.
   (This creates all tables with RLS, the signup trigger, the private
   `private-docs` storage bucket, and owner-only invitation policies.)
3. In **Authentication → Providers**, keep Email enabled. For a truly closed
   group, also set **Authentication → Sign In / Up → "Confirm email" on**, and
   consider disabling anonymous access. The app UI is invite-only; note that
   Supabase-level direct signups are a platform setting beyond the app's control —
   the first user to sign up becomes `owner` automatically.
4. From **Project Settings → API**, copy the project URL, anon key, and
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

The first account you sign up with (via an invitation or directly at /signup with a
token) becomes the **owner**. The owner invites everyone else from
**Settings → Invitations**; each invitation link is a one-time `/signup?invite=TOKEN` URL.

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

- `npm test` — 91 unit/integration assertions: isolation, conditionality,
  conflicts, injection defense, subject + math-topic routing, all six verifier
  kinds, method-compliance honesty guards, and offline round-trip parsing of a
  real XLSX and PPTX. Runs fully offline.
- `npm run build` — must pass with zero type errors (verified before every push).

See `TEST_REPORT.md` for the full scenario-based acceptance results, including
what is honestly still blocked on a live backend.

## Honesty guarantees

- If the AI is not configured, every AI feature returns a clear 503 and the UI
  preserves your input.
- Extraction failures say exactly what couldn't be read and why.
- The verification panel never claims a check that wasn't performed.
- Profile changes require explicit approval; every proposal can be rejected.
