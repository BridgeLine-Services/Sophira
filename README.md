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
   `supabase/migrations/0001_init.sql` through `0020_student_memory.sql`
   (0001 schema + RLS + private `private-docs` bucket; 0002 owner-only
   invitations; 0003 profile versioning; 0004 sources + audit trail;
   0005 owner membership, invitation requests, learning patterns, aggregate
   owner analytics; 0006 invitation expiry; 0007 intentional habits;
   0008 invitation-only signup; 0009 typing calibration; 0010 deadline
   scheduling; 0011 rubric audits; 0012 research tables; 0013 claim
   evidence; 0014 source authority; 0015 submission gate; 0016 pattern
   evidence; 0017 schedule executions; 0018 adaptive typing profile;
   0019 access revocation audit; 0020 student memory).

   After configuring the deployment you can check readiness at any time
   on the **/setup** page (public operator diagnostic) or via
   **GET /api/setup-status** — they report, in categorical terms only:
   whether the Supabase connection is configured, the migrations are
   applied, `app_config.owner_email` is set, the owner account exists and
   is active, and the AI provider is configured. They never display keys,
   tokens, emails, or passwords.
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
| `GEMINI_API_KEY` | **free tier (recommended)** — Google Gemini API key, server-side only; never shipped to the client |
| `GEMINI_MODEL` | default `gemini-2.5-flash` (currently in the Gemini free tier); change only if Google's current free tier still offers it |
| `AI_PROVIDER` | `auto` (default: Gemini free tier first, then paid only if explicitly allowed) \| `gemini` \| `openai` \| `local` |
| `ALLOW_PAID_AI` | default `false` — zero-billing: a paid key alone is IGNORED (fail closed) |
| `MONTHLY_AI_BUDGET_USD` | default `0` — `0` means only free providers may operate; a value > 0 is an explicit decision to allow paid use |
| `OPENAI_API_KEY` | paid fallback — only used when `ALLOW_PAID_AI=true` or `MONTHLY_AI_BUDGET_USD>0`; leave empty for the free path |
| `OPENAI_BASE_URL` | any OpenAI-compatible endpoint (paid path only) |
| `SOPHIRA_MODEL` | paid-path model, e.g. `gpt-4o-mini` (vision-capable models enable photo reading) |
| `NEXT_PUBLIC_SITE_URL` | deployed URL, used in invite links |

#### AI providers: free-first, zero-billing, fail-closed

Sophira never silently depends on a paid API:

- **OFFLINE** — the local model runs on-device (Offline page; the 135M/0.5B/1.5B tiers download with explicit consent, and every local answer is stamped `LOCAL MODEL`).
- **ONLINE, Gemini free tier** — set `GEMINI_API_KEY`. Default model `gemini-2.5-flash`. The key lives only in server environment variables (the client-bundle secret scan in the release gate proves it).
- **ONLINE, paid** — only when the owner EXPLICITLY sets `ALLOW_PAID_AI=true` or `MONTHLY_AI_BUDGET_USD>0`. With the defaults (`false`/`0`) an `OPENAI_API_KEY` is reported and IGNORED.
- **Provider failure** — falls back to the next allowed candidate; if none, the honest error points to Offline mode. Nothing is ever faked.
- **Owner diagnostics** — the `/owner` page shows active provider, model, cost class, and zero-billing state; `GET /api/provider-status` (owner session) adds usage counts. Costs display **"Cost unknown"** where they cannot be verified — never a fabricated "$0".
- **Usage log** — migration `0021_provider_usage.sql` (service-role only; no client access).
- **Capability registry** — `/owner` shows every provider's capabilities (provider, model, online_required, free_tier, paid_capable, billing_required, multimodal, max_context, research_tools, local) BEFORE activation; `src/lib/ai/capabilities.ts` is the single source.
- **"No Unexpected Charges" security setting** — displayed on `/owner`. The state lives in the SERVER environment (`ALLOW_PAID_AI`, `MONTHLY_AI_BUDGET_USD`) so the frontend can never weaken it; rejection happens server-side before any network call.
- **Model-level fail-closed** — with paid AI off, only models on the verified free-tier list (`VERIFIED_FREE_TIER_GEMINI_MODELS`) may run; an unknown `GEMINI_MODEL` is rejected. This is the "free forever" guard: if Google moves a model off the free tier, removing it from the list blocks it.
- **Startup diagnostic** — `GET /api/provider-diagnostics` (owner session) returns ONLY: `configured_provider`, `configured_model`, `local_model_availability`, `free_tier_mode`, `paid_ai_allowed`. Never API keys.

#### Offline models (tiers)

The Offline page offers tiered on-device models, all verified on the HF hub
and pinned to immutable revisions: TIER 1 phone/lightweight (SmolLM2 135M/360M,
Qwen2.5 0.5B), TIER 2 phone-performance/laptop (Qwen2.5 1.5B, Qwen3 1.7B),
TIER 3 laptop/desktop (Qwen3 4B q4). Device capability detection recommends
a tier (LOW/MEDIUM/HIGH) you can always override; nothing downloads without
explicit confirmation, and a model is only "ready" after a real local
inference probe. While offline, no remote AI/search/verification call is
ever attempted. See `docs/OFFLINE_MODELS.md`.

#### Notebooks

Private, source-grounded research notebooks: sources (PDF/DOCX/TXT/web/image/instructions/notes), notes, questions with LABELED grounded answers (SOURCE-SUPPORTED / INFERENCE / NOT VERIFIED), evidence with exact locators, "Research this topic" with a user approval gate, and provenance-retaining artifacts (study guide, quiz, flashcards, outline, briefing, evidence table, research plan, essay plan, bibliography). Source content is owner-only under RLS — no other user, admin included, can read it. See `docs/NOTEBOOKS.md`.

#### Research citation invariant

NO VERIFIED CITATION WITHOUT VERIFIED SOURCE: every citation must pass a 12-step check (search result → valid URL → actually requested → redirects followed → final URL → HTTP success → content extracted → title extracted → passage exists → claim overlaps passage → authority met → citation from stored metadata). Any failure → UNVERIFIED with an explanation; failed sources are never replaced by guesses. "Verify all sources again" re-fetches every source before submission (vanished → UNAVAILABLE, changed → STALE; claims demoted, final gate re-run informed). The UI shows VERIFIED / UNVERIFIED / UNAVAILABLE / STALE and never claims "Research complete" while evidence is missing.

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

- `npm test` — 1193 unit/integration assertions: isolation, conditionality,
  conflicts, injection defense, subject + math-topic routing, all six verifier
  kinds, method-compliance honesty guards, offline round-trip parsing of a
  real XLSX and PPTX, the learning-pattern lifecycle (confirm → corrected →
  recurring, temporary caps), scope leakage (subject/course/teacher/global),
  honest applied-context metadata, and the §12 preserved-writing-habit
  guard (explicit opt-in, writing tasks only, requirements always win),
  and the complete offline subsystem (encrypted local store, durable sync
  queue, deterministic conflict resolution, revocation sealing, and the
  full 17-step offline lifecycle — two-device races included). Runs fully
  offline.
- `RUN_LIVE_MODEL=1 npm test` — additionally downloads a real SmolLM2 135M
  model (~120 MB) and verifies genuine on-device inference through
  transformers.js/WASM.
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
- Offline answers are always stamped with their origin (LOCAL MODEL vs
  REMOTE MODEL); online-only features are listed, never faked as offline.


---

## Offline mode (implemented)

`src/lib/offline/` is a full offline subsystem: an AES-256-GCM encrypted
local store (per-record IV + AAD binding, KEK-wrapped DEK), a durable
encrypted sync queue, deterministic conflict resolution (explicit
conflict records — both sides preserved; never silent overwrites), sync
orchestration with optimistic concurrency, account-revocation sealing
(a revoked account's queued work is never uploaded), and consent-gated
local AI models (SmolLM2-135M ~120 MB, Qwen2.5-0.5B ~400 MB) running
real on-device inference via transformers.js.

Works offline: reading/editing your synced academic data, writing
assistance, rewriting, generation, deterministic math solving, machine
verification, teacher-rule application, academic memory recall.
Online-only (never faked): live web research, new-document extraction,
fresh-source cross-checking. Architecture, interfaces, and honest
limitations: `docs/OFFLINE_ARCHITECTURE.md`.

## Proprietary Software — All Rights Reserved

Sophira is **proprietary software**. All rights are reserved by the copyright
holder under the [LICENSE](LICENSE) file. This is not open-source software:
copying, redistribution, modification, and commercial exploitation are
prohibited without express written authorization. See
[docs/legal/TERMS_OF_SERVICE.md](docs/legal/TERMS_OF_SERVICE.md) and
[docs/legal/PRIVACY_POLICY.md](docs/legal/PRIVACY_POLICY.md) (templates with
placeholders — see docs/legal/LEGAL_REVIEW_NOTICE.md).

The app itself serves these documents at **/terms**, **/privacy**, and
**/license** (public routes, viewable signed-out, linked from the login
page). The pages render the REAL repository documents — never a duplicated
copy — with an honest `TEMPLATE — PLACEHOLDER NOTICE` banner while owner-fact
placeholders remain, per docs/legal/LEGAL_CONFIGURATION.md. The release gate
(`node scripts/release-gate.mjs`) BLOCKS production-readiness while legal
placeholders remain unresolved.

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
| Verified web research | **Implemented backend + UI; requires external configuration to run** — real server-side search via a configurable provider (`SEARCH_PROVIDER`/`SEARCH_API_KEY`/`SEARCH_BASE_URL`; Brave, Tavily, or Brave-compatible custom), every candidate URL fetched and verified (redirects, dead links, paywalls, thin content), source approval, deterministic MLA/APA/Chicago/generic citations from source records, citation/quote audit with live re-verification (`/api/research`, `/api/research/audit`, `ResearchPanel`; migrations 0012). Without a provider key the research workflow reports honestly and fabricates nothing. Downstream stages (fetch, redirect, dead-link, access-refusal, text extraction, claim-evidence, citation) LIVE-verified against the real web (`RESEARCH_LIVE=1 npm test`, TEST_REPORT §49); only the search-provider stage itself awaits a live `SEARCH_API_KEY`. |
| Claim→evidence traceability (research integrity) | **Implemented and unit-tested (offline)** — every factual claim in a researched essay traces CLAIM → SOURCE → EXACT SUPPORTING PASSAGE → SOURCE URL → STATUS (`src/lib/research/claims.ts`, migration 0013). A claim is VERIFIED only when the stored retrieved content actually supports it: verbatim passage, matching figures, substantive overlap — never merely a live URL or matching title. Unsupported claims are explicitly listed (claim / reason / required action) in a final Research Integrity report appended to the essay; the essay generator is blocked from declaring research complete while required claims are unsupported; a source that disappears after initial verification demotes its claims to UNVERIFIED at audit time. 41 automated assertions (suite: 326). |
| Submission readiness + stale-pattern detection | **Implemented and unit-tested (offline)** — one mechanical per-assignment verdict (`src/lib/readiness.ts`, `/api/readiness`, `ReadinessPanel`): draft present, verification passed (failed machine checks block), teacher method compliance, rubric criteria satisfied, research claims fully supported; n/a checks never block and undeterminable states are reported, never guessed. Learning patterns unobserved for 180 days stop shaping AI context (never deleted; re-observation self-heals; UI shows the staleness reason). Suite: 350. |
| Assignment-aware source authority | **Implemented and unit-tested (offline)** — the research ranker (unchanged, still the generic fallback) is extended with `src/lib/research/authority.ts`: the assignment is classified (history / science / current events / literature / social science / general), a configurable authority-profile tier hierarchy is applied, teacher requirements OVERRIDE generic preferences absolutely, .gov/.edu are never blindly prioritized, and each source's acceptance decision (tier, flags, reasons) is stored (migration 0014) so the citation audit explains why every source was accepted. Suite: 393. |
| FINAL SUBMISSION READINESS GATE (machine-enforced) | **Implemented and unit-tested (offline)** — `src/lib/readiness/finalGate.ts` + `/api/readiness/final` + migration 0015: `submission_ready` is false whenever ANY hard teacher/rubric/formatting/research/assignment requirement fails (a single failed machine check, missing Works Cited, unsupported claim, authority failure, placeholder or unverifiable semantic requirement blocks); the UI renders a PASS/✓-✗/STATUS: NOT READY block that cannot display a misleading ready state. Suite: 426. |
| SECURITY REGRESSION SUITE — PERMANENT PRIVACY GATE | **Implemented and verified** — two layers in the standard acceptance workflow: (1) `tests/security/rls-regression.mjs` runs the FULL privacy matrix against the actual database/RLS (real OWNER/USER_A/USER_B/unauthorized users; owner NO ACCESS to all nine private categories — assignment, essay, teacher profile, writing samples, feedback, learning patterns, research, typing results, uploaded files; A↔B/anon/revoked/deleted NO ACCESS; owner membership management works; analytics aggregate-only with zero content markers; fail-closed env config); (2) `tests/run.ts` §22 runs 26 offline RLS-conformance assertions on EVERY `npm test` — all tables RLS-enabled, every policy auth.uid()-scoped, no permissive policies, network_stats aggregate-only. Tamper-verified: removed RLS, `using(true)` policies, and analytics content leaks each fail the suite. No existing RLS weakened; 564/564 tests. |
| INVITATION-ONLY ACCESS — FULL SECURITY VERIFICATION | **Implemented and verified** — the existing invitation workflow (not rebuilt) verified against all 18 matrix items, frontend AND backend, with the DB trigger + RLS as the real gate. LIVE suite (`tests/security/invitation-regression.mjs`): real signUp/trigger/RLS matrix — stranger signup refused (no account created), valid links work, atomic single-use claims, expiry + revocation enforced at lookup AND signup, email binding, missing/fake/modified tokens fail, owner-only approval, requests never create access, removal kills the account, zero token leaks (all observed errors checked against live tokens). OFFLINE suite (`tests/run.ts` §23, 57 assertions on every `npm test`) verifies the 18 items against actual migration SQL + routes + guard. Tamper-verified: five weakening scenarios each fail the suite. 621/621 tests. |
| LEGAL-DOCUMENT INSPECTION & CONFIGURATION GATE | **Implemented and verified** — all four existing legal documents inspected and preserved (nothing deleted); every placeholder inventoried (entity name, copyright holder, address, contact email, jurisdiction, effective dates, liability cap, dispute method/rules, retention period); new `docs/legal/LEGAL_CONFIGURATION.md` lists every owner-supplied field in structured tables with an INCOMPLETE status and a publication gate (fields supplied + placeholders replaced + attorney review before production); ToS §18 strengthened with cautious enforcement language (unauthorized use *may* constitute infringement or breach; all rights and remedies reserved — zero "legal trouble" phrasing, machine-checked); LEGAL_REVIEW_NOTICE preserved and extended (templates, NOT legal advice, attorney review recommended, neither the AI nor Base44 is the owner's lawyer, no attorney approval or guarantee exists); all 21 required topics verified addressed; NO legal values invented anywhere. 633/633 tests. |
| MASTER ACCEPTANCE — DEDICATED SECTIONS | **Implemented and verified** — the 27-step end-to-end workflow preserved; 24 dedicated acceptance sections added (A1–A24: typing, scheduling, sessions/breaks, rubric, readiness, research integrity chain, PWA, native, security, learning decay, teacher precedence, correction learning, legal). Every row: prerequisites / steps / expected / failure condition / evidence / status. IMPLEMENTED vs VERIFIED explicitly distinguished — PASSED cites executed evidence only. Totals: 35 rows — 24 PASSED (executed offline, dated), 0 FAILED, 11 BLOCKED (blocker named per row), 0 NOT RUN. Doc structure machine-checked by suite §24. 838/838 tests. |
| SINGLE AUTHORITATIVE RELEASE GATE | **Implemented, executed, machine-checked** — `docs/RELEASE_GATE.md` + `node scripts/release-gate.mjs` evaluate all 38 critical checks (live URL/DB/providers, live security matrices, offline core behaviors, devices, native config, legal, env vars, secrets scan, test/build/typecheck/security) with evidence per check and exactly two final states: `RELEASE STATUS: GO` (all 38 PASS) or `RELEASE STATUS: BLOCKED` with every blocker numbered. NOT RUN and BLOCKED are never treated as PASS. Repeatable before every deployment (`--report`, `--fast`, `--self-test`). Current honest status (2026-10-05, unconfigured environment): 20 PASS / 0 FAIL / 17 BLOCKED / 1 NOT RUN → BLOCKED on owner-side prerequisites (report saved). CI runs the gate in a dedicated job and publishes the status. 889/889 tests. |
| PWA DIRECT-BROWSER READINESS | **Implemented and verified** — no App Store / Google Play needed: manifest valid with all required fields; icons verified at exact dimensions (192/512/180/32); service worker caches ONLY the static shell (never HTML, APIs, or any user/academic data — shared-device cache leakage impossible by construction); NO offline AI/research functionality exists or is claimed (grep-verified); install path on `/install` with platform detection, one-tap prompt, and exact Safari/Chrome steps; auth/invitation/session-retention/reconnect-state verified against sources (suite §26, 42 machine checks). Owner's exact testing steps: docs/PWA_TESTING_GUIDE.md. 931/931 tests. |
| OWNER-CONTROLLED ACCESS | **Implemented, machine-checked** — permanent owner role (`profiles.role`, fail-closed operator-configured bootstrap via `owner_email`, no hardcoded password); owner views all users (name, email, role, status, dates granted/revoked) and can grant (invitations), revoke, reinstate, or permanently remove — all enforced server-side via `requireOwner`. Revocation is IMMEDIATE and total: status stored in the database, recorded with a timestamp, all the user's refresh tokens deleted server-side (old sessions/installed apps/tokens cannot refresh), middleware redirects revoked users on every protected page, and every API route verifies authenticated → ACTIVE access → role → resource (4 previously under-guarded routes fixed). Frontend hiding is cosmetic only. Zero plaintext credentials in the codebase; owner credentials live with the auth provider (recovery documented in docs/OWNER_ACCESS.md). Suite §27 enforces all of this permanently (58 assertions, 989/989). |
| NATIVE BUILD CONFIG — NO SILENT FALLBACK + CAPACITOR 8 | **Implemented and verified** — the `sophira.example.com` silent fallback is REMOVED from capacitor.config.ts and tauri.conf.json; release builds (`SOPHIRA_NATIVE_RELEASE=1`, used by `android:build`, `desktop:build` and the release workflow) FAIL on missing/placeholder/malformed/non-https/localhost/credentialed `SOPHIRA_APP_URL`; dev builds use the explicit dev configuration (localhost:3000), and a provided URL is strictly validated even in dev; Capacitor aligned to a single major: android/core/ios/cli all **8.5.2** (cli was 7.6.9), plugins app 8.1.1 + camera 8.2.4; install/tsc/tests 538/538/web build/cap sync android+ios all verified. |
| OPTIONAL ADAPTIVE TYPING PROFILE | **Implemented and unit-tested (offline)** — migration 0018 + `src/lib/typing-profile.ts`: per-user profile (baseline/recent-average/recommended WPM, confidence, sample count, last calibration, auto_adjust_enabled, preferred pace) with strict RLS; rolling estimate from the last 5 valid+unflagged attempts only — suspicious timing data can never corrupt it; recommended pace = conservative midpoint of baseline & recent, clamped to [0.75, 1.25]× baseline (62+67 → 64, HIGH confidence); pacing NEVER changes automatically: manual preference → adaptive (only when enabled) → fixed baseline; the typing test itself is untouched; 15 new tests. Suite: 520. |
| PERSISTENT SCHEDULE EXECUTION STATE MACHINE | **Implemented and unit-tested (offline)** — migration 0017 + `src/lib/schedule-execution.ts`: server-side persisted states WORKING/BREAK_PENDING/BREAKING/NEXT_WORK_SESSION/PAUSED/COMPLETED/FAILED with full timestamps, accumulated work/break, remaining work, deadline, urgency and schedule version; timestamp-driven reconciliation restores state on refresh/close/reconnect (idempotent, only planned minutes consumed — never wall-clock gaps); duplicate work sessions structurally impossible (partial unique index + validated transitions); deadline changes re-base the live execution — history preserved, never a restart; PAUSED freezes, resume shifts the window; breaks stay bounded 10s–6h by the unchanged scheduler; NO background computing is claimed — the machine resumes from persisted timestamps on reconnect. Suite: 505. |
| LEARNING-PATTERN EVIDENCE & CONFIDENCE DECAY (machine-enforced) | **Implemented and unit-tested (offline)** — migration 0016 + `src/lib/learning/evidence.ts`: every pattern tracks confirmations/contradictions/corrections + last-confirmed/last-used; confidence changes ONLY from recorded evidence (positive: user confirms, repeated use, teacher support, approved work; negative: corrections, rejection, teacher contradiction, alternative method, instruction conflicts); deterministic bounded decay (contradiction ladder ×0.92→×0.83→×0.74→×0.55: 94→87→73→51→INACTIVE; time decay ×0.8 per 90-day window after a 90-day grace, floor 0.05/cap 0.95); ladder candidate→active→lower_confidence→inactive with revival via later evidence — patterns are never abruptly deleted; teacher + current assignment instructions ALWAYS override patterns (conflict-evidence loop, prompt precedence, demotion of teacher_required); `explainPatternDecisions` exposes why every pattern was selected or ignored, persisted per response and rendered in the Corrections panel. Suite: 480. |
| Release-gate hardening + legal status + gate workload wiring | **Implemented and unit-tested (offline)** — the release workflow runs `scripts/verify-deployment.mjs` against the target's live `/api/health` and refuses to ship when any required capability is unconfigured (search optional); `npm run legal:status` machine-reports the 17 remaining bracketed legal owner facts (owner action + attorney review); `/api/readiness/final` wires the workload estimator into the gate's deadline feasibility (applied only while blockers exist). Suite: 440. |
| LONG-TERM STUDENT MEMORY (workflow §28) | **Implemented and unit-tested (offline + live-wired)** — migration 0020 (`student_memories` + `student_memory_evidence`, strict own-row RLS on both, owner NOT exempt) + `src/lib/memory/engine.ts` (pure): 13 structured categories (goals, strengths, weaknesses, learning/explanation preferences, study habits, recurring mistakes, conceptual misunderstandings, academic history, subject preferences, motivation patterns, effective/ineffective strategies); every AI-inferred memory is an EVIDENCE-BACKED HYPOTHESIS, never an asserted fact — structured evidence rows (type, polarity, summary, source refs, observed date), confidence recomputed from the full evidence history with RECENCY WEIGHTING (120-day half-life: fresh evidence dominates, outdated behavior never permanently defines the student; diminishing returns, symmetric supports/contradictions, floor 0.05/cap 0.95); AI-inferred memories stay `monitoring` until confidence clears 0.5; improvement trends computed from the evidence sequence (3 consecutive clean machine-verified solutions on a weakness → trend `improving`); full lifecycle: create/update/confirm/contradict/improve/archive/disable/forget(hard delete, evidence cascades)/restore with student-controlled transitions (forgotten stays forgotten). AI retrieval (`selectRelevantMemories`): ONLY memories relevant to the current academic context (subject-tag matching, relevance-ranked, hard cap 8, archived/disabled/forgotten never injected) — never a dump of the student's history; decisions persisted per response for auditability. Solve-route evidence loop: observed mistakes → `incorrect_problem` evidence; machine-verified clean answers → `correct_solution` CONTRADICTING evidence on matching weaknesses. Student Memory Management UI (`/memories`): view/search/filter, inspect every evidence row, edit, disable, re-enable, archive, permanently forget (with confirm), add manual memories clearly badged `student-stated fact` vs `AI-inferred`. Privacy: requireUser + explicit user_id scoping + RLS (defense in depth), NO service-role client anywhere in the memory layer, owner network-stats never touch memories; live RLS regression matrix extended to TEN private categories (owner NO ACCESS to student memories). Structured relational data — deliberately NO vector/embedding store (transparent matching, every selection explainable). Suite §28: 1051/1051. |
