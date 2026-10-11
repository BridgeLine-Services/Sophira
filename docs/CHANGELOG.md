# Sophira — Changelog (dated upgrade rounds)

Moved verbatim from README.md on 2026-10-07 so the README stays a short
introduction. These are the dated historical upgrade rounds; the numbers
(47 / 91 / 1193 assertions, migration ranges) are the counts AT THE TIME of
each round, not today's. Current facts live in README.md,
docs/FEATURE_STATUS.md and docs/RELEASE_PROCESS.md.

---

### Upgrade round: revision-guarded, section-scoped Google Docs write-back (2026-10-12)

- Objective 5 round 1: a member can write their draft into their
  SELECTED Google Doc, bounded to their stated section heading or
  appended at the end — never a whole-document replacement.
- Every write carries writeControl.requiredRevisionId: if a
  collaborator changed the document since Sophira read it, Google
  refuses the write (409). The conflict is reported honestly, nothing
  is written, and the draft is returned so no work is lost.
- An unfound section heading produces NO write at a guessed location.
- access_state becomes "write" only after Google confirms the write.
- Word remains draft-download-only (documented, never hidden) until a
  bounded, eTag-guarded Word path exists.
- 11 new assertions. Battery: 3343/3343 green; tsc clean.

### Upgrade round: document access, workload selections, honest shared-file states (2026-10-12)

- Migration 0034: workload_selections — the personal-AI-workload
  boundary record (owner-bound rows, RLS owner-only policies, one per
  user+provider+document; included in the account export).
- Microsoft: browse own + explicitly-shared files (tenant restrictions
  surface as honest notes); read .docx text through the user's own
  connection (real mammoth extraction, round-trip tested); tenant-wide
  scopes are never requested to work around sharing limits.
- Google: browse defaults to drive.file (app-created only); an
  explicit "Enable Drive browsing" consent (drive.readonly) is offered
  via incremental consent — never silently broadened. Google Docs read
  as text for read-only assistance; unsupported types are honest.
- Workload selections API: create/list/revise/remove, user id taken
  from the session only, RLS as defense in depth; scope is always
  user-stated and revisable.
- New DocumentBrowser UI in Settings -> Integrations: browse, select,
  state scope, manage selections.
- 53 new assertions (tests/document-selection.ts). Battery: 3332/3332
  green; tsc clean; build clean; scan clean.

### Upgrade round: live runtime environment detection in System Health (2026-10-11)

- New owner capability: when System Health shows the GitHub Actions
  result (its normal production mode), it NOW ALSO lists what the
  RUNNING deployed server itself sees — per-variable statuses
  (CONFIGURED / MISSING / OPTIONAL) with plain-English detail, never
  values. This is deliberately distinct from the Vercel dashboard
  inventory (unreadable from the app) and from the CI runner env.
- Live database probe: where the server-side Supabase URL + service
  key exist, System Health performs a REAL REST probe of the newest
  migration table (0033 provider_connections) — the owner sees
  deployed-database health without terminal access.
- SUPABASE_URL documented in the manifest + variable guide
  (server-only, optional alternative; hosting integration sets it).
- 10 new assertions incl. planted-value leak checks proving statuses
  never expose real values. Battery: 3289/3289 green.

### Upgrade round: multi-user identity + PowerPoint/Google Slides saves (2026-10-11)

- Migration 0033: provider_connections gains provider_account_id +
  granted_scopes — every operation is now auditable against the exact
  connected account and the scopes the user actually granted. Tokens
  remain service-role-only (unchanged 0032 posture).
- Account identity capture: Microsoft stores the verified drive owner
  identity + stable drive id from a REAL Graph call; Google with the
  least-privilege drive.file scope honestly cannot read the account
  name, and Sophira does NOT request broader scopes just to show one.
- PowerPoint and Google Slides: the Microsoft route now uploads real
  .pptx files to OneDrive (same conflictBehavior=fail); the Google
  route converts Sophira's .pptx into a real Google Slides
  presentation via the Drive API and returns its real URL.
- Live security suites hardened: both live regressions (RLS +
  invitation-only) now SAFETY-ABORT if SUPABASE_TEST_URL appears to
  point at the production project, and never fall back to production
  credentials (partial config already failed closed; verified by
  --self-test runs).
- Multi-user model reaffirmed: connections are per Sophira user
  (unique user_id+provider), every token operation is user-scoped,
  and there is no owner-proxy path — the release-gate probe now
  verifies migration 0033 (range 0001-0033).

### Upgrade round: Microsoft Word + Google Docs integrations (code complete; live consent pending) (2026-10-11)

- Direct document-provider integration, implemented end to end and tested
  offline; live consent flows remain honestly BLOCKED until the owner
  registers the OAuth apps (docs/WORD_GOOGLE_DOCS_SETUP.md, updated with
  the EXACT redirect URIs).
- Migration 0032 provider_connections: OAuth tokens stored per user with
  RLS enabled and NO client policies — tokens are service-role-only and
  can never be read from the browser. The account export includes
  connection METADATA only; tokens are never exported. The release gate
  now probes 0032 as the newest migration.
- OAuth: authorization-code flow with an httpOnly state cookie (CSRF),
  constant-time state verification, minimal scopes only (Microsoft
  Files.ReadWrite + offline_access; Google drive.file — never the whole
  Drive), server-side token exchange/refresh, honest error states, and
  per-user storage scoped on every query.
- Real operations: status is verified by a LIVE provider call (never by a
  configured variable); Microsoft saves a real DOCX to OneDrive with
  conflict=fail (no silent overwrite; explicit overwrite needs the flag
  AND the item id); Google creates a real Doc via the Docs API with the
  artifact's full content and provenance and returns the real URL.
- New pages: Settings → Integrations (honest per-provider states,
  connect/disconnect); the notebook export row gains "Save to Word" and
  "Save to Google Docs" next to the always-working local DOCX/PDF/PPTX
  downloads.
- ~30 new assertions (tests/provider-integrations.ts), behavioral where
  possible; live provider tests remain BLOCKED by design until
  credentials exist.

### Upgrade round: REAL PowerPoint (.pptx) generation (2026-10-11)

- Sophira can now generate genuine .pptx presentation files from stored
  notebook artifacts, mirroring the deterministic DOCX/PDF export stage.
  pptxgenjs 4.0.1 (MIT, maintained, pure TypeScript-compatible JS) was
  chosen after inspecting the existing architecture: JSZip is already a
  dependency, the export pipeline already builds from stored artifact
  rows under RLS, and the repository already ships an INDEPENDENT PPTX
  reader (lib/extract/documents.ts) used here to validate round-trips.
- Pipeline: title slide -> agenda -> one slide per section (stored
  bullets, per-slide source labels, shrink-to-fit readability) ->
  References & provenance slide (always; an export can never silently
  drop its sources). Oversized artifacts cap at 40 content slides with
  the cap disclosed on the References slide. Unicode is preserved.
- POST /api/notebooks/:id/export now accepts format "pptx" through the
  SAME authenticated, RLS-guarded, SHA-256-digest-verified pipeline;
  invalid artifacts return an honest 400, never a false success.
- Honest limitation: byte-level determinism is NOT claimed (pptxgenjs
  stamps file metadata); STRUCTURAL determinism is asserted instead
  (same artifact -> identical slides, text, order).
- 14 new real-file assertions (tests/pptx-export.ts).

### Upgrade round: System Health shows the REAL Actions result + owner-authorized dispatch (priority 3) (2026-10-11)

- The deployed System Health page no longer dead-ends at the local-gate
  limitation. When the app host cannot run the full suite, GET now
  retrieves the REAL latest health-workflow run (status, conclusion,
  timestamps, run link) and recovers the gate's own TOTAL line from the
  pinned issue. A queued, in-progress, failed, or missing run is never
  a pass; a successful run means the checks RAN, and the verdict stays
  the honest TOTAL line (stale results are flagged).
- POST /api/owner/system-health (owner-only) starts the single health
  workflow via the documented dispatch API, using a server-side
  GITHUB_HEALTH_TOKEN. Without the token it reports the exact missing
  prerequisite plus the manual Run-workflow link. Acceptance is always
  reported as acceptance, never as a passed check.
- src/lib/owner/health-actions.ts: pure, behaviorally tested
  classification (never-run / running / completed / failed / stale /
  unknown) and TOTAL-line recovery.
- 17 new assertions (tests/system-health-actions.ts).

### Upgrade round: health workflow notify fix (verified by a REAL dispatch) (2026-10-11)

- First real execution of the scheduled health check (manual dispatch of
  .github/workflows/health.yml, run 38117666331): the full gate ran in
  Actions, the report artifact was saved, and the summarize step parsed
  the real TOTAL line (39 checks: 21 PASS / 0 FAIL / 17 BLOCKED /
  1 NOT RUN), but the owner-notification step crashed with
  "github.rest.issues.listForIssues is not a function" - the
  actions/github-script@v7 Octokit exposes the classic listForRepo
  method name. Fixed the workflow to use listForRepo (and the
  scheduled-health test pin that had matched the wrong name).
- Everything else in the pipeline is verified working from the real run:
  checkout, npm ci, the full gate battery, TOTAL parsing, and artifact
  upload all succeeded.

### Upgrade round: ONE centralized Typing Calibration section (phase 4) (2026-10-11)

- Reported: typing calibration was missing as a user-facing section and
  appeared as a tool card under every course. Both were true: the
  dedicated page existed (/writing/typing) but the side panel had no
  entry, while every subject workspace listed a "Typing and Writing
  Calibration" tool card.
- Fix: the side panel now has exactly ONE dedicated "Typing Calibration"
  section (next to the other user-level navigation items), and the
  per-subject typing tool card was removed from every course workspace
  (English, Math, Foreign Language, Biology, Chemistry, Physics,
  History, Health, CS, Other). The shared page, assessment, baseline
  history, pacing preferences, and user-scoped API are unchanged - no
  second calibration system, no recalibration, no schema change.
- Pinned in course-engine tests: no typingTool in any subject registry
  array; exactly one /writing/typing entry in the shell.

### Upgrade round: dedupe the owner Online entries (2026-10-11)

- Reported: the owner section showed two entries, "Online status" and
  "Online", both opening /online. Root cause: the previous production-fix
  round added an /online entry to OWNER_NAV while the sidebar's real-time
  connectivity indicator (rendered in every layout, sidebar and drawer)
  already links to /online. The redundant OWNER_NAV entry was removed;
  exactly one entry remains (the connectivity indicator, which also shows
  live Online/Offline state and highlights only on /online).
- Regression pinned in tests/prod-fixes.ts: exactly ONE href="/online" in
  the shell, and no "Online status" owner-nav label. Suite: 3187.

### Upgrade round: production fixes - owner nav, IndexedDB keys, System Health honesty (2026-10-11)

- Owner navigation (reported: Invitation requests / Invite someone /
  Members / Overview did nothing from /owner/health): root cause was
  hash-only hrefs, which resolve against the CURRENT route. They now
  carry the /owner route first (/owner#members etc.), with route-aware
  active styling, an Online status entry, and a hash-scroll effect so
  direct URL entry, refresh, and browser back/forward all reach the
  section. Server-side owner authorization untouched.
- Offline storage (reported: "Failed to execute 'put' on
  'IDBObjectStore': The object store uses out-of-line keys and has no
  key generator and the key parameter was not provided"): the kv store
  is intentionally out-of-line keyed, but its write omitted the key.
  Every kv write now supplies the key explicitly - no schema change,
  no store recreation, no data loss; existing encrypted records and
  queued edits preserved.
- System Health in the deployed architecture: the hosting environment
  cannot run the local gate script; the response now says so in plain
  English with the REAL alternatives (the weekly automatic checkup and
  the Run-workflow page) instead of a dead end. Still an honest
  failure, never a cached success; owner-only access preserved.
- 16 new assertions (tests/prod-fixes.ts, source + loop-expanded). Suite: 3186.

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
