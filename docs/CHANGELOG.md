# Sophira — Changelog (dated upgrade rounds)

Moved verbatim from README.md on 2026-10-07 so the README stays a short
introduction. These are the dated historical upgrade rounds; the numbers
(47 / 91 / 1193 assertions, migration ranges) are the counts AT THE TIME of
each round, not today's. Current facts live in README.md,
docs/FEATURE_STATUS.md and docs/RELEASE_PROCESS.md.

---

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

---

### Upgrade round 2026-10-07: consistency, doctor, crash-guard, dependency security

Four rounds, all landed on master:

- **Documentation consistency (e7d230e)** — every guide now agrees with the
  actual code: self-hosted AI is the default (free-first, paid opt-in),
  /create-owner is the real first-owner path, 26 migrations, 2503+ tests.
  README shrunk to a 135-line index; history moved here.
- **`npm run doctor` (9e0254e, 39caf8c)** — one command prints a plain-English
  ✅/❌ checklist of setup state with the exact next step for each gap; 25 new
  tests. Born from the live finding that a misconfigured production deployment
  was indistinguishable from a healthy one.
- **Crash-guard audit (f7579b8)** — a SET-but-MALFORMED Supabase URL made
  supabase-js throw synchronously, 500-crashing the middleware on EVERY page;
  an unreachable database rejected getUser() with the same effect. Now:
  middleware validates the URL and degrades (public pages render, protected
  redirect to /login, always fail-CLOSED); requireUser converts any failure on
  the 37 guarded routes to an honest 503; the server client is a lazy proxy;
  the first-owner bootstrap routes degrade honestly. 11 regression tests.
- **Dependency security round (a2ca7dc, branch merged)** — production audit
  findings 13 → 5: mammoth 1.13.0, fast-glob override, tailwind moved to
  devDependencies (build-time only). The two remaining Next.js criticals are
  mitigated by design (images already unoptimized) but the honest fix is the
  next 16.4.0 major — docs/SECURITY_UPGRADE.md records the exact migration
  scope (async request APIs, middleware→proxy.ts, React 19) for a scheduled
  project, not a squeezed version bump.

Key decisions:

- **Degrade, never crash, always fail-closed.** A broken configuration can
  only deny access (redirect/503 with plain-English cause), never grant it
  and never leak a stack trace.
- **Tailwind is not a production dependency.** It is a build-time PostCSS
  plugin; the hostile-audit test now enforces both its version and its
  dev-only placement.
- **No major upgrades inside dependency rounds.** The Next.js 16 migration
  is documented precisely and scheduled separately.

Production state at close of round (read-only verification,
https://sophira.vercel.app): health 200, Supabase + service role + AI
configured, database reachable but schema absent (state SETUP_REQUIRED,
capability initialization-channel, no owner, 0 stale auth users), crash-guard
behavior live (/dashboard → 307 → /login, /login 200, guessed asset 404).
Initializing the production database (via /setup) is deliberately left to an
explicit owner decision — it creates schema and the owner account on the live
database.

Test count at close: **2541** (`npm test`), build PASS, tsc clean.

### Upgrade round 2026-10-09 (later): master structure spec

Landed on master in one increment (no rebuilds — all over the existing
AI service, math pipeline, and offline engine):

- **Engine registry corrected to the spec** — English exactly 9 tools,
  Math exactly 6 (incl. Type to Solve, Teach Me How to Solve, Test
  Preparation, Practice Problems), every other subject exactly 8 tools
  including Typing Calibration and its subject AI engine.
- **Five new AI engines over the existing service** — Planning (never
  writes the assignment), Grammar & Spelling (accept/reject each
  correction, verbatim-quote server verification, voice preserved),
  Tutor (any subject), Math Test Prep, Math Practice
  (attempt-before-reveal, honest checking).
- **Math modes** — `/math?mode=type` opens typed input; `?mode=teach`
  and the Teach-me toggle explain the concept through the SAME verified
  pipeline (no second solver authority).
- **Courses hierarchy** — Science parent with Biology/Chemistry/Physics
  nested; History / Social Science, Computer Science, Other Subject
  groups.
- **Online status page** (`/online`, nav item) — real connectivity, live
  health probe, real pending-sync queue; unknown states reported
  honestly, never faked.
- **Changes rebuilt** — global chronological change history (profile
  decisions, learning patterns, memory updates) + subject-scoped view
  (`?course_id=`); real schema columns only; no cross-subject leaks.
- Suite grew 2859 → 2943 assertions, all passing; tsc + production build
  clean.
