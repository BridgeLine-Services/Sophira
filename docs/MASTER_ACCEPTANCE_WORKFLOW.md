# SOPHIRA — Master Acceptance Workflow

**The definitive end-to-end acceptance test for the project.**

This is a single continuous scenario. Run it top-to-bottom on a live backend
(Supabase configured, AI provider key set) with the app deployed or running
locally, with one owner account and one student account. Every step lists its
current status so nothing is claimed that was not executed.

## Status legend (P11)

- **IMPLEMENTED** — the code path exists (verified by code inspection)
- **AUTO-VERIFIED** — covered by `npm test` (144 assertions, fully offline)
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

---

# Dedicated Acceptance Sections (2026-10-05)

Twenty-four dedicated acceptance areas added to the master workflow. The
27-step end-to-end scenario above is preserved unchanged; these sections
give each system its own test definition.

## Status legend for these sections

- **PASSED (VERIFIED)** — the behavior has ACTUALLY been verified by an
  executed check (the offline test suite, a real build, or a live run).
  Evidence with date is recorded. Code existing alone NEVER counts as a
  pass.
- **BLOCKED (IMPLEMENTED, NOT VERIFIED)** — the code path exists and is
  code-inspected, but the behavior cannot yet be verified because an
  external prerequisite is missing. The blocker is named.
- **FAILED** — a verification ran and the behavior did not match.
- **NOT RUN** — verifiable now, but not yet executed for a reason other
  than a hard blocker.

IMPLEMENTED means the mechanism exists. VERIFIED means it was observed
behaving correctly. They are different claims and are never conflated
below.

---

## A1. Typing calibration

**Prerequisites:** app running; a student account; calibration passage
service reachable (server-controlled passages, §15d of the suite).
**Steps:** 1. Open typing calibration. 2. Type the served passage.
3. Submit; run the calibration test again with errors and backspaces.
**Expected result:** WPM, accuracy and consistency are computed from actual
keystroke timing; the user's baseline is stored; error-typos lower accuracy;
the served passage comes from the server, not the client.
**Failure condition:** WPM/accuracy computed from client-supplied values;
impossible WPM accepted; baseline silently overwritten without selection;
passage served from the browser.
**Evidence required:** executed calibration assertions (suite §13 + §15d)
and a live calibration session once a backend is deployed.
**Status: PASSED (VERIFIED offline)** — tests/run.ts §13/§15d executed
2026-10-05, suite 633/633. Live UI run remains part of workflow step 26.

## A2. Typing-paced output

**Prerequisites:** student account; a completed solve result; pacing
controller available.
**Steps:** 1. Run a solve with pacing enabled. 2. Observe output delivery.
3. Interact mid-delivery (pause/skip where supported). 4. Reload mid-delivery.
**Expected result:** output is revealed progressively at the calibrated pace,
never dumped all at once; the pacing state machine transitions are legal;
reload resumes rather than duplicating.
**Failure condition:** full answer dumped instantly; pacing slower/faster
than configured baseline without consent; illegal state transitions.
**Evidence required:** executed pacing assertions (suite §14, §15b).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §14/§15b executed
2026-10-05, suite 633/633.

## A3. Adaptive typing profile

**Prerequisites:** a user with an existing baseline; the adaptive profile
feature present but OFF by default.
**Steps:** 1. Confirm the profile is off by default. 2. Run paced output
without enabling it. 3. Enable the adaptive profile. 4. Use the app across
sessions; observe pacing.
**Expected result:** pacing NEVER changes unless the user explicitly enabled
the profile; once enabled, adaptation is bounded and explainable.
**Failure condition:** pacing adapts with the feature off; unbounded drift.
**Evidence required:** executed adaptive-profile assertions (suite §20).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §20 executed 2026-10-05,
suite 633/633.

## A4. Deadline scheduling

**Prerequisites:** assignment with a deadline; workload inputs.
**Steps:** 1. Schedule an assignment with a week-scale deadline.
2. Schedule one with an hour-scale deadline. 3. Provide an unrealistic
deadline (minutes for a week of work). 4. Provide a user workload number
that disagrees with the heuristic.
**Expected result:** plans are deterministic and bounded; session counts,
durations and break lengths scale with available time; an infeasible plan
is flagged honestly, not silently produced; the user's own workload number
wins over the heuristic.
**Failure condition:** nondeterministic plans; unbounded sessions; silent
infeasible plans; heuristic overriding the user's number.
**Evidence required:** executed scheduler assertions (suite §15, §15c).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §15/§15c executed
2026-10-05, suite 633/633.

## A5. Persisted work sessions

**Prerequisites:** a scheduled plan; the execution state machine; server
persistence.
**Steps:** 1. Start a session. 2. Refresh mid-session. 3. Check the session
row after reload (started_at, expected_end_at, state).
**Expected result:** refresh mid-session changes NOTHING — the persisted
start and expected end survive; the session continues rather than
restarting.
**Failure condition:** refresh restarts the session, resets started_at, or
duplicates rows.
**Evidence required:** executed persistence assertions (suite §19).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §19 executed 2026-10-05,
suite 633/633.

## A6. Break state persistence

**Prerequisites:** an active session reaching a scheduled break.
**Steps:** 1. Enter the break (BREAKING state, break_end_at set).
2. Refresh during the break. 3. Let the break end.
**Expected result:** the break row and break_end_at persist across reloads;
after the break ends the state machine resumes work without a manual kick;
timestamps drive transitions (no background computing).
**Failure condition:** break cleared on refresh; resume requires a user
action; wall-clock ignored.
**Evidence required:** executed break assertions (suite §19).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §19 executed 2026-10-05,
suite 633/633.

## A7. Rubric auditing

**Prerequisites:** an assignment with a structured rubric (checklist items
with weights/requirements); a submitted draft.
**Steps:** 1. Run the rubric audit on the draft. 2. Change the draft to
violate one item. 3. Re-run the audit.
**Expected result:** the audit deterministically checks each rubric item,
reports per-item pass/fail with reasons, and the changed draft flips exactly
the affected item.
**Failure condition:** nondeterministic audit results; hidden failures;
item outcomes that do not correspond to the draft.
**Evidence required:** executed rubric assertions (suite §15e).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §15e executed 2026-10-05,
suite 633/633.

## A8. Submission readiness

**Prerequisites:** assignment with rubric, teacher requirements, formatting
requirements; a draft with verifiable claims.
**Steps:** 1. Request readiness for a draft that fails a hard requirement
(e.g. word count, unsupported claim, missing section). 2. Fix it. 3. Request
readiness again. 4. Attempt to mark Ready with a failing check.
**Expected result:** readiness is machine-enforced — NOT READY while ANY
hard requirement fails; the failing criteria are named; once all pass the
gate opens; the UI cannot show Ready while the API says not-ready.
**Failure condition:** Ready shown with failed checks; vague failure
reasons; gate bypassable from the client.
**Evidence required:** executed gate assertions (suite §15j, §15k) plus the
research-integrity integration checks (§16b-§16d).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §15j/§15k/§16b-§16d
executed 2026-10-05, suite 633/633.

## A9. Research provider configuration

**Prerequisites:** server-side research provider settings (keys via
environment/secret storage only).
**Steps:** 1. Run research with the provider unconfigured. 2. Configure the
provider. 3. Inspect any client-visible configuration surface.
**Expected result:** unconfigured providers are reported honestly (no fake
results); keys live server-side only; no provider key ever reaches the
client.
**Failure condition:** fabricated results when unconfigured; provider keys
in client code or API responses.
**Evidence required:** executed provider assertions (suite §15f).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §15f executed
2026-10-05, suite 633/633.

## A10. Research retrieval

**A10.1 Retrieval pipeline**
**Prerequisites:** research workflow with query construction, dedupe and
ranking (fixture provider for offline verification).
**Steps:** 1. Run a research query. 2. Run it again with duplicate sources
available. 3. Inspect ranking.
**Expected result:** queries are built deterministically; duplicates are
removed; ranking is objective and explainable, never invented.
**Failure condition:** duplicate records retained; subjective/unexplained
ranking; fabricated records.
**Evidence required:** executed retrieval assertions (suite §15i).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §15i executed
2026-10-05, suite 633/633.

**A10.2 Live provider retrieval**
**Prerequisites:** deployed backend + live research API credentials.
**Steps:** run a real research request end-to-end and inspect the stored
records and their provenance.
**Expected result:** real records with real URLs and retrieval metadata.
**Failure condition:** errors hidden, empty results presented as research.
**Evidence required:** a live run against the deployed instance.
**Status: BLOCKED (IMPLEMENTED, NOT VERIFIED)** — blocker: live research API
credentials and production environment variables are not configured (owner
setup step).

## A11. Source verification

**A11.1 Verification logic**
**Prerequisites:** verification engine with fetch-based checks and honest
status outcomes.
**Steps:** 1. Verify a reachable source. 2. Verify an unreachable/404 URL.
3. Verify a page whose quotes do not match. 4. Inspect statuses.
**Expected result:** each source receives an honest status (verified /
unverifiable / failed with reason); a quote that does not appear in the
fetched content fails verification; nothing is silently marked verified.
**Failure condition:** unreachable URLs marked verified; mismatches passed.
**Evidence required:** executed verification assertions (suite §15g).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §15g executed
2026-10-05, suite 633/633.

**A11.2 Live fetch verification**
**Prerequisites:** deployed backend with network access.
**Steps:** verify a set of real public URLs end-to-end.
**Expected result:** statuses reflect the real fetches.
**Evidence required:** a live run against the deployed instance.
**Status: BLOCKED (IMPLEMENTED, NOT VERIFIED)** — blocker: no deployed
backend / production credentials in the current environment.

## A12. Claim-to-source evidence verification

**Prerequisites:** a generated draft containing factual claims; research
records with passages.
**Steps:** 1. Trace each factual claim to its source record, passage and
URL. 2. Introduce a claim with no supporting passage. 3. Introduce a claim
that contradicts its passage.
**Expected result:** every claim resolves through CLAIM → SOURCE → PASSAGE
→ URL → STATUS; unsupported or contradicting claims are marked UNVERIFIED
and never presented as supported.
**Failure condition:** a claim presented as supported without a matching
passage; contradictions silently accepted.
**Evidence required:** executed traceability assertions (suite §16b).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §16b executed
2026-10-05, suite 633/633.

## A13. Citation integrity

**Prerequisites:** verified research records; a draft with citations.
**Steps:** 1. Generate citations from the records. 2. Edit a record's
metadata. 3. Regenerate. 4. Check a citation whose quoted passage fails
verification.
**Expected result:** citations are derived deterministically from the
records; quotes are checked against the recorded passages; a failed quote
blocks or flags the citation; author/URL/title are never invented.
**Failure condition:** invented authors or URLs; citations not tied to
records; failed quotes left in silently.
**Evidence required:** executed citation assertions (suite §15h).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §15h executed
2026-10-05, suite 633/633.

## A14. Source authority requirements

**Prerequisites:** assignment-aware source authority rules; the existing
objective ranking (never replaced).
**Steps:** 1. Rank sources for an assignment with authority requirements
(e.g. primary scholarly sources required). 2. Use an assignment without
requirements. 3. Inspect the stored authority decisions for each accepted
source.
**Expected result:** the ranking remains objective; assignment requirements
constrain acceptance; every accept/reject decision is stored with its
reason.
**Failure condition:** ranking replaced rather than extended; authority
decisions unexplained or absent.
**Evidence required:** executed authority assertions (suite §16c, §16d).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §16c/§16d executed
2026-10-05, suite 633/633.

## A15. PWA installation

**A15.1 PWA conformance (offline)**
**Prerequisites:** build output with manifest, icons, service worker;
middleware matcher.
**Steps:** 1. Inspect the manifest, icons and sw registration surface.
2. Confirm unauthenticated handling of PWA shell files.
**Expected result:** the PWA shell (manifest, sw.js, icons, robots.txt)
serves without auth friction; the app authenticates normally.
**Failure condition:** middleware redirect loops on shell files; missing
manifest/icons.
**Evidence required:** executed PWA assertions (suite deployment section,
middleware matcher + PWA shell checks).
**Status: PASSED (VERIFIED offline)** — executed 2026-10-05, suite 633/633.

**A15.2 PWA install on a real device**
**Prerequisites:** deployed HTTPS URL; a physical iPhone (Safari) and/or
Android (Chrome) device.
**Steps:** install via Add to Home Screen / Install app; launch standalone;
log in; reload.
**Expected result:** standalone launch, persistent login, full workflow
available (workflow steps 26-27).
**Failure condition:** browser-tab launch, lost session, broken layout.
**Evidence required:** device model, OS version, date, result recorded in
docs/DEVICE_ACCEPTANCE.md.
**Status: BLOCKED (IMPLEMENTED, NOT VERIFIED)** — blocker: no deployed
production URL and no physical devices available to the agent
(docs/DEVICE_ACCEPTANCE.md rows are honestly NOT TESTED).

## A16. Native build

**A16.1 Android APK build**
**Prerequisites:** android/ Gradle project; JDK/SDK toolchain.
**Steps:** run the Gradle release build; inspect the produced APK.
**Expected result:** a valid, signed-or-honestly-unsigned APK is produced.
**Evidence required:** build log, checksum (recorded in TEST_REPORT §20).
**Status: PASSED (VERIFIED)** — the Android project genuinely builds and
produces a valid APK in the sandbox (build verification; recorded in
TEST_REPORT §20). Device installation remains device-blocked (A15.2).

**A16.2 iOS build**
**Prerequisites:** Mac with Xcode; Apple Developer certificate and
provisioning profile (owner-side); ios/ Capacitor project.
**Steps:** run the Xcode archive/build for the ios/ shell pointed at the
deployment URL.
**Expected result:** a buildable .ipa with the shell loading the deployment
URL.
**Failure condition:** build fails; shell points at a placeholder URL.
**Evidence required:** build log + the signed .ipa (or ad-hoc/TestFlight
registration record) in docs/DEVICE_ACCEPTANCE.md.
**Status: BLOCKED (IMPLEMENTED, NOT VERIFIED)** — blocker: requires an
Apple Developer certificate + provisioning (owner-side) and a Mac; none
available.

**A16.3 Linux desktop build**
**Prerequisites:** Linux host with Rust + webkit2gtk toolchain; the Tauri
project; a validated deployment URL.
**Steps:** build the Tauri desktop app (AppImage/.deb).
**Expected result:** the desktop binary launches a native window at the
deployment URL.
**Failure condition:** build fails; window opens a placeholder URL.
**Evidence required:** build log + launch screenshot recorded in
docs/DEVICE_ACCEPTANCE.md.
**Status: BLOCKED (IMPLEMENTED, NOT VERIFIED)** — blocker: Rust +
webkit2gtk toolchain is not present in the agent sandbox; CI builds it once
the workflows are activated.

**A16.4 Windows desktop build**
**Prerequisites:** Windows machine; Tauri build toolchain; validated URL.
**Steps:** build the .msi installer.
**Expected result:** the installer runs and the app opens the deployment.
**Failure condition:** build or install failure; placeholder URL.
**Evidence required:** build log + install/launch record.
**Status: BLOCKED (IMPLEMENTED, NOT VERIFIED)** — blocker: no Windows
machine available to the agent.

**A16.5 macOS desktop build**
**Prerequisites:** Mac; Tauri toolchain; validated URL.
**Steps:** build the .dmg installer.
**Expected result:** the installer runs and the app opens the deployment.
**Failure condition:** build or install failure; placeholder URL.
**Evidence required:** build log + install/launch record.
**Status: BLOCKED (IMPLEMENTED, NOT VERIFIED)** — blocker: no Mac
available to the agent.

## A17. Native deployment URL validation

**Prerequisites:** native shells (Capacitor config, tauri.conf.json) and
the URL validation script; a candidate deployment URL.
**Steps:** 1. Run the validator against an invalid/placeholder URL.
2. Run it against a valid HTTPS deployment URL. 3. Run the --write-tauri
path.
**Expected result:** invalid or placeholder URLs are REFUSED — no silent
production fallback; valid URLs pass and are written into the shells.
**Failure condition:** a native shell silently loading a placeholder or
localhost URL as if it were production.
**Evidence required:** executed URL-validation assertions (suite §21) and
the script self-test.
**Status: PASSED (VERIFIED offline)** — tests/run.ts §21 + native-url.mjs
self-test executed 2026-10-05, suite 633/633.

## A18. Invitation security

**A18.1 Invitation workflow security (offline conformance)**
**Prerequisites:** the four legal... (see the 18-item matrix) — actual
migration SQL, routes, guard and signup page sources.
**Steps:** for each of the 18 matrix items, verify the enforcement mechanism
against the actual sources (trigger-refused signup, atomic single-use
claims, expiry, revocation, email binding, exact-equality 192-bit tokens,
owner-only approval, requests-never-create-access, removal, token-leak
checks). Then run the five tamper scenarios.
**Expected result:** every item is enforced server-side (DB trigger/RLS,
not UI hiding); tampering with any boundary fails the suite loudly.
**Failure condition:** any item enforced only in the UI; a tampered
boundary passing.
**Evidence required:** executed assertions (suite §23) + the T1-T5 tamper
record.
**Status: PASSED (VERIFIED offline)** — tests/run.ts §23 executed 2026-10-05,
tamper T1-T5 each caught, suite 633/633.

**A18.2 Live invitation matrix**
**Prerequisites:** disposable Supabase test project + the three
SUPABASE_TEST_* secrets in CI.
**Steps:** `node tests/security/invitation-regression.mjs` (runs the full
18-item matrix against real signUp, triggers and RLS).
**Expected result:** all matrix checks pass against the real backend.
**Evidence required:** CI run output of the live suite.
**Status: BLOCKED (IMPLEMENTED, NOT VERIFIED)** — blocker: SUPABASE_TEST_*
secrets / disposable test project not yet configured by the owner.

## A19. Owner privacy

**A19.1 Owner sees aggregates only (offline conformance)**
**Prerequisites:** network analytics surface; RLS policies.
**Steps:** 1. Inspect what the owner analytics API can return. 2. Attempt to
read a member's private content through owner-visible surfaces.
**Expected result:** the owner sees ONLY aggregate counts/statuses — never
essays, teacher notes, writing samples, patterns, research or uploads; the
readable-table boundary is enforced at the DB level.
**Failure condition:** any owner-readable private content path.
**Evidence required:** executed assertions (suite §22, analytics
aggregate-only checks).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §22 executed
2026-10-05, suite 633/633.

**A19.2 Live privacy matrix**
**Prerequisites:** SUPABASE_TEST_* secrets in CI.
**Steps:** `node tests/security/rls-regression.mjs` (real cross-account
privacy probes).
**Expected result:** all live probes pass.
**Evidence required:** CI run output of the live suite.
**Status: BLOCKED (IMPLEMENTED, NOT VERIFIED)** — blocker: same missing
SUPABASE_TEST_* configuration.

## A20. RLS isolation

**A20.1 RLS conformance (offline)**
**Prerequisites:** migration SQL; entity access surfaces.
**Steps:** verify per-entity policies: cross-account reads/writes denied,
owner aggregates permitted, service-role paths never exposed to clients.
**Expected result:** every private entity is isolated at the database
level; no client can bypass.
**Failure condition:** any permissive policy or client-exposed service role.
**Evidence required:** executed assertions (suite §22).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §22 executed 2026-10-05,
suite 633/633.

**A20.2 Live RLS matrix**
**Status: BLOCKED (IMPLEMENTED, NOT VERIFIED)** — blocker: SUPABASE_TEST_*
secrets not configured; `node tests/security/rls-regression.mjs` runs in CI
once they exist.

## A21. Learning confidence decay

**Prerequisites:** learned patterns with evidence counters; decay engine.
**Steps:** 1. Record positive evidence (confirm, repeated use, teacher
support, approved work) and check confidence/status. 2. Record negative
evidence (correction, rejection, teacher contradiction, alternative
method, instruction conflict). 3. Age a pattern past decay windows.
4. Reactivate a demoted pattern with later confirming evidence.
**Expected result:** confidence changes ONLY from recorded evidence;
decay is deterministic and bounded (the documented ladder, e.g.
94 → 87 → 73 → 51 → INACTIVE); time decay applies after the grace window;
demoted/inactive patterns revive via later evidence and are never deleted;
every decision is explainable.
**Failure condition:** confidence changing without evidence; unbounded or
nondeterministic decay; abrupt deletion; stale patterns overriding teacher
instructions.
**Evidence required:** executed decay assertions (suite §18: the full
required scenario list — old-but-relevant stays active, explicit
correction, teacher override, repeated contradiction, inactivation,
reactivation, assignment override, determinism, bounds).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §18 (40 assertions)
executed 2026-10-05, suite 633/633.

## A22. Teacher-rule precedence

**Prerequisites:** teacher A and teacher B with conflicting required
methods; learned patterns; assignment instructions.
**Steps:** 1. Run a task where a learned pattern conflicts with the
teacher's required method. 2. Run the same against current assignment
instructions. 3. Check the applied-patterns explanation.
**Expected result:** teacher and current assignment instructions ALWAYS
override learned patterns; the composer declares the order of authority up
front; conflicts are recorded as evidence and surfaced, never silently
resolved.
**Failure condition:** a stale or learned pattern overriding teacher
instructions; a conflict silently resolved.
**Evidence required:** executed precedence assertions (suite §1, §12a, §8
and the solve-route conflict loop in §18).
**Status: PASSED (VERIFIED offline)** — executed 2026-10-05, suite 633/633.

## A23. Correction learning

**Prerequisites:** active learning profile; feedback surface; scoping
rules.
**Steps:** 1. Submit user feedback ("my professor requires completing the
square"). 2. Inspect the created proposal (scope, status, source).
3. Reject one proposal, approve another. 4. Run a future relevant task and
a task in a different scope.
**Expected result:** feedback creates a scoped PROPOSAL — never a silent
profile change; nothing persists without approval; the approved pattern
applies only in its scope; the rejected one never applies; corrected
patterns never re-enter context.
**Failure condition:** silent profile mutation; scope leakage; rejected
patterns applied.
**Evidence required:** executed lifecycle/scope assertions (suite §9-§12).
**Status: PASSED (VERIFIED offline)** — tests/run.ts §9-§12 executed
2026-10-05, suite 633/633.

## A24. Legal production-readiness checks

**A24.1 Machine-visible legal status (offline)**
**Prerequisites:** LICENSE, ToS, Privacy Policy, review notice,
LEGAL_CONFIGURATION.md.
**Steps:** 1. Search all four documents for unresolved placeholders.
2. Check that the machine checks enforce: every placeholder inventoried,
no invented values, cautious enforcement language, no "legally guaranteed"
/ "attorney approved" claims, review notice preserved.
**Expected result:** all placeholders are inventoried and flagged INCOMPLETE;
the release workflow refuses to claim legal readiness while placeholders
remain.
**Failure condition:** a placeholder missing from the configuration; any
false approval claim.
**Evidence required:** executed legal assertions (suite §16, §17, §17b).
**Status: PASSED (VERIFIED offline)** — executed 2026-10-05, suite 633/633.

**A24.2 Legal production publication**
**Prerequisites:** the 12 owner-supplied legal fields in
docs/legal/LEGAL_CONFIGURATION.md (entity name, address, contact email,
legal contact, effective dates, copyright year, jurisdiction, liability
cap, dispute method, dispute rules, retention period) + attorney review.
**Steps:** supply every field; replace every placeholder; attorney review;
re-run the release workflow.
**Expected result:** zero unresolved placeholders; attorney sign-off
recorded.
**Failure condition:** any placeholder remaining at publication.
**Evidence required:** placeholder-free documents + attorney review record.
**Status: BLOCKED (IMPLEMENTED, NOT VERIFIED)** — blocker: the owner must
supply the legal fields and engage an attorney (agent must not invent
them).

---

## Totals (2026-10-05)

| Result | Count |
| --- | --- |
| **TOTAL TESTS** | 35 |
| **PASSED** (behavior actually verified) | 24 |
| **FAILED** | 0 |
| **BLOCKED** (implemented, verification blocked — blocker listed) | 11 |
| **NOT RUN** | 0 |

**Blocked items and their blockers:**
- A10.2 live research retrieval — live research API credentials + production
  env not configured
- A11.2 live fetch verification — no deployed backend in the current
  environment
- A15.2 PWA install on device — no deployed production URL, no physical
  iOS/Android devices available
- A16.2 iOS build — Apple Developer certificate + provisioning (owner-side),
  no Mac
- A16.3 Linux desktop build — Rust + webkit2gtk toolchain absent in the
  sandbox (CI builds once activated)
- A16.4 Windows desktop build — no Windows machine
- A16.5 macOS desktop build — no Mac
- A18.2 live invitation matrix — SUPABASE_TEST_* secrets / disposable test
  project not configured
- A19.2 live privacy matrix — same missing secrets
- A20.2 live RLS matrix — same missing secrets
- A24.2 legal production publication — owner must supply the 12 legal
  fields and complete attorney review

Every BLOCKED row is IMPLEMENTED and code-inspected; its verification
becomes possible the moment the named blocker is removed. No test above is
marked PASSED on the basis of code existing — each PASSED row cites the
executed verification that observed the behavior.
