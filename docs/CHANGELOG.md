# Sophira — Changelog (dated upgrade rounds)

Moved verbatim from README.md on 2026-10-07 so the README stays a short
introduction. These are the dated historical upgrade rounds; the numbers
(47 / 91 / 1193 assertions, migration ranges) are the counts AT THE TIME of
each round, not today's. Current facts live in README.md,
docs/FEATURE_STATUS.md and docs/RELEASE_PROCESS.md.

---

### Upgrade round: What I Need to Do Next (phase 15 deliverable) (2026-10-11)

- docs/WHAT_I_NEED_TO_DO_NEXT.md: the beginner guide the owner asked for,
  listing ONLY the actions that truly need the owner (database connection,
  app web address, AI key, search key, one-time test environment, phone
  testing, legal facts + attorney review). Real variable names and real
  document paths only; no invented facts; teaches the secret-handling
  golden rule (keys only ever go into the hosting provider's secure
  settings, never into chat or files).
- System Health now opens with "What you can do next": the unresolved
  prerequisite groups with their exact owner actions, derived from the
  REAL gate data (completed work is never re-asked).
- 11 new assertions (tests/owner-next-step.ts). Suite: 3170.

### Upgrade round: ongoing scheduled health (phase 7) (2026-10-11)

- .github/workflows/health.yml: a hands-off weekly verification that reuses
  the SINGLE authoritative release gate in FULL mode (complete suite, type
  check, production build, secret scans, every gate check), plus a manual
  Run-workflow button. Scheduled Mondays 06:00 UTC.
- The pass/fail decision is read only from the gate's own TOTAL line. The
  full report is kept as a workflow artifact (90 days).
- Owner notification: ONE pinned GitHub issue ("Sophira health check needs
  your attention"), searched before creation so it can never duplicate;
  commented on regressions, closed automatically when everything genuinely
  passes. Least-privilege permissions (code read, issue write only); no
  credential values are ever written to logs.
- The System Health page now points the owner to the Checks page for the
  scheduled results; RELEASE_GATE.md documents how the checks run, how
  often, and what they can and cannot verify.
- 12 new assertions (tests/scheduled-health.ts). Suite: 3157.

### Upgrade round: owner System Health — the release gate in plain English (2026-10-11)

- Phase 6 of the owner-experience round: the 17 BLOCKED + 1 NOT RUN
  release-gate items are now explained to the nontechnical owner inside
  the app, with zero terminal work.
- New /owner/health (owner-only, on the owner navigation as System
  Health) runs the SINGLE authoritative release gate in fast report
  mode and shows every check with: a plain-English meaning, why it
  matters, its prerequisite GROUP (several blockers share one owner
  action, e.g. the one-time test environment unlocks several security
  checks), the exact owner action, the technical detail behind a
  disclosure, the last verification timestamp, and a Check-again retry
  button.
- src/lib/owner/gate-translate.ts (pure, fully unit-tested): statuses
  are NEVER altered — BLOCKED stays BLOCKED; the verdict is READY FOR
  RELEASE only when every single check genuinely passed, and carries an
  explicit disclaimer that it is not a legal-compliance or security
  guarantee. Zero evidence is never READY.
- scripts/health-json.mjs: thin adapter that runs the real gate and
  converts its self-test-pinned report text to JSON; it cross-checks
  its parse against the report's own TOTAL line and refuses to invent
  a result if they disagree.
- /api/owner/system-health: server-side owner-only (requireUser shared
  guard + role check, satisfying the route access test); if the gate
  cannot run in the deployment environment it returns an honest 503 —
  never a fabricated PASS.
- Suite: +23 assertions incl. a LIVE adapter run inside npm test (the
  gate report is parsed end to end and must yield its real statuses).
  3145/3145 green; tsc clean; build clean; secret scan clean.

### Upgrade round: verified document export + resumable research (2026-10-11, commits a03edf7 + 1773e7c)

- Verified DOCX/PDF export of stored notebook artifacts (stage 6 of the
  document workflow): deterministic builders (valid minimal OOXML DOCX,
  PDF 1.4) so the same stored artifact always yields identical bytes and
  an identical SHA-256 digest; the provenance block is ALWAYS embedded —
  an export can never silently drop its sources. New
  POST /api/notebooks/:id/export builds the file FROM THE STORED
  ARTIFACT ROW (never regenerated at export time), scoped to the user's
  own notebook, and returns the exact-bytes digest in X-Sophira-Digest.
  Notebook Artifacts gained Export DOCX / Export PDF buttons; unknown
  formats are refused, never silently faked. Import -> edit -> export is
  now verified end to end.
- Resumable research runs (stage 8): the search+verify pass extracted
  into lib/research/run.ts as the ONE shared execution core; new
  POST /api/research/resume completes a run that died mid-request
  (stale 'searching' >= 5 min) or retries a 'failed' project once a
  provider is configured. Queries are re-searched for real; sources
  already stored are never duplicated or re-verified (progress = stored
  sources); sufficiency counts prior VERIFIED + newly verified only.
  Guard rails tested: live runs refused (409), unknown statuses refused,
  no provider fails honestly. ResearchPanel gained 'Resume interrupted
  run' / 'Retry research' (only in those states). Honest scope: this is
  server-persisted resumability, not background processing.
- RELEASE_GATE_REPORT.txt regenerated against current master
  (21 PASS / 0 FAIL / 17 BLOCKED / 1 NOT RUN, all blockers owner-side;
  migration text now reads 0001-0031). Suite: 3122.

### Upgrade round: science gap-closure + final navigation audit (2026-10-10, commit bdfa339)

- Science audit vs the master nav spec: Chemistry and Physics now expose
  Scientific Calculations (/math?mode=type) into the EXISTING
  deterministic math solver + AI explainer with a subject hint (units,
  scientific notation, physical meaning) — no duplicate backend, no
  separate-model claim. The Science parent workspace and the nav drawer
  show the deduped union of Biology + Chemistry + Physics tools.
- /api/ai/solve accepts a declared subject slug: a subject workspace
  seeds the real workflow routing (chemistry/physics get their
  mathjs-verified scientific workflows); AI classification still wins
  when more specific. Practice and test-prep honor subject context when
  no course is selected.
- Query-aware nav active states: /math?mode=type vs /math?mode=teach
  highlight only on a true query match (client-side search read, no
  useSearchParams/Suspense trap).
- Calibration audit: ONE shared user-global backend (migrations 0009 +
  0018), every subject's link resolves to the real /writing/typing page.
- Release gate: migration probe 0028 -> 0030 (subject_preferences REST
  probe, 0001-0030 chain). Suite: 3045. Gate at this commit: 21 PASS,
  0 FAIL, 17 BLOCKED (owner-side), 1 NOT RUN (APK).

### Upgrade round: navigation hierarchy + subject workspaces (2026-10-10)

- Exact navigation hierarchy (spec): expandable Courses group with per-user
  persisted expansion state, auto-expand for direct nested routes, separate
  chevron expansion controls (aria-expanded), nested Science
  (Biology/Chemistry/Physics beneath Science only), subjects in spec order:
  English, Math, Science, History / Social Science, Foreign Language,
  Health Education, Other Subject (Computer Science classified under Other).
- Subject workspaces at /courses/<subject> (+ /courses/science/<child>):
  each lists its spec-exact tools and the user's own courses for the subject.
- Tool registry per spec: English 9, Math 10 (Scan/Type/Teach Me to Solve,
  Test Prep, Practice, Library, Memory, Changes, Calibration), Foreign
  Language 8 (Language Selector first), all other subjects exactly 7.
- Foreign Language: functioning selector (target/explanation language,
  proficiency) persisted per user (migration 0030, owner-only RLS) through
  the auth-guarded /api/preferences/foreign-language API.
- Global nav reduced to spec items (Home, Courses, Notebooks,
  Learning / Memory, Offline, Settings); Online is a real connectivity
  status chip linking /online; global Changes merged INTO the
  Learning / Memory page; mobile slide-out drawer (menu button, Escape,
  backdrop, focus management, modal semantics) alongside the rail (lg+),
  tablet row (md), and bottom bar.
- Real ?subject= scoping: /learning, /proposals, and /library honor the
  subject workspace context, narrowed to the user's own courses in the
  subject group plus intentionally global records. RLS unchanged.
- Suite: 3000/3000 green; tsc + production build clean; CI verified.

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
