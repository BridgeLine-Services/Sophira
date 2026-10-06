# Sophira — Test Report

Date: 2026-10-06 (offline subsystem) · Next 14.2.35, strict TypeScript · `npm test` + `npm run build`

Current state: **1193/1193 PASSED** (`npm test`); latest details in §53.

## 1. Automated tests — ✅ 144 / 144 PASSED (`npm test`, fully offline)

| Area | Assertions | Result |
|---|---|---|
| Teacher isolation (Teacher A's rules never enter Teacher B's context) | 6 | ✅ |
| Course isolation (course rules only when selected) | 3 | ✅ |
| Writing-profile conditionality (math never loads it; writing does) | 4 | ✅ |
| Source conflicts (dates, archiving resolves, same-date not flagged) | 5 | ✅ |
| Prompt-injection defense incl. NEW patterns (profile change, exfiltration, teacher-rule override, privacy probe) | 8 | ✅ |
| Subject routing (9 workflows, machine-verifiable flags honest) | 12 | ✅ |
| **NEW** Typed math verification: 6 kinds — evaluate, symbolic simplify, symbolic derivative, equation identity at sample points, matrix det/product, statistics; wrong claims fail; malformed input fails honestly; kinds deduplicated | 19 | ✅ |
| **NEW** Fine-grained math topic routing (15 workflows) | 13 | ✅ |
| **NEW** Method compliance: valid normalization; claimed-compliant-with-failed-check demoted to partial (honesty guard); malformed → "NOT checked", never a fabricated pass | 6 | ✅ |
| Scope inheritance wording (global → course → teacher overrides) | 3 | ✅ |
| **NEW** Learning-pattern lifecycle: candidate→active on confirm (confidence ≥0.85); mark_corrected records source; corrected→recurring on return; temporary caps confidence; confidence ceiling; observed-mistake normalization (junk dropped, subjects kept); similarity matching incl. paraphrase and non-match | 14 | ✅ |
| **NEW** Learning-scope leakage: calculus/biology subject scoping, teacher A's method never reaches teacher B, global always applies, corrected never applied, course-scope matching | 7 | ✅ |
| **NEW** Honest applied-context: applicable mistakes/methods enter the prompt; corrected and out-of-scope patterns excluded; mistakes framed watch-for; applied metadata reflects real state | 9 | ✅ |
| **NEW** §12 preserved writing habits: only explicit opt-in mistakes qualify; enter the prompt ONLY for writing tasks with an "requirements always override" caveat; stay honest watch-for mistakes in math tasks; applied metadata reports them separately | 5 | ✅ |
| **NEW** Invitation accept is atomically single-use: the status update is guarded by `status='pending'` server-side, so concurrent accepts cannot both win (route-level; verify with two parallel calls in live test §14) | manual review | ✅ |
| **NEW** Order of authority declared as the FIRST prompt section (assignment » teacher » course » approved student preferences » general AI), conflicts must be surfaced never silently resolved; earlier section-index tests updated to the new layout | 8 | ✅ |
| **NEW** DOCX structure extraction (headings, question numbering, tables) + CSV | 4 | ✅ |
| **NEW** XLSX round-trip (built in memory with the app's own library, parsed back: sheets, cells, honest notes) | 3 | ✅ |
| **NEW** PPTX round-trip (minimal deck built with JSZip: slide title, body, speaker notes) | 3 | ✅ |
| **NEW** Edge-case regressions (unclosed regex fixed → suite green) | 2 | ✅ |

## 2. Build verification

| Check | Result |
|---|---|
| `tsc --noEmit` strict full-project typecheck | ✅ 0 errors |
| `npm run build` — 30 routes | ✅ |
| PWA assets resolvable | ✅ build-time |

## 3. What is implemented vs. verified — honest status legend

- **Implemented**: code exists, typechecks, builds.
- **Unit/integration tested**: runs in `npm test` (offline).
- **Live tested**: executed against a real deployed backend — **not yet done**.
- **Not verifiable here**: needs real devices (PWA) or external credentials.

## 4. Live acceptance scenarios — BLOCKED on deploy credentials

The sandbox has no Supabase project, no AI key, and no physical devices.
Per `docs/ACCEPTANCE_TESTS.md` (10 sections, ready to run):

| Scenario group | Status |
|---|---|
| Auth, courses, teachers, assignments, writing conditionality | 🔶 Implemented + logic unit-tested; live run pending |
| Method compliance + independent verification end-to-end | 🔶 Engine unit-tested (all 6 kinds); live model-output flow needs AI key |
| Feedback → proposal → approval → versioning → rollback | 🔶 Pure parts unit-tested; live flow needs backend |
| Cross-student isolation | ✅ RLS reviewed + app-layer isolation unit-tested; live DB probe pending |
| PPTX/XLSX/CSV/handwriting uploads | ✅ Parsers round-trip tested offline; live upload flow pending |
| PWA on Android/iPhone/iPad/desktop at 360/390/430px+ | 🔶 Architecture in place; real-device testing NOT performed |

## Known limitations (honest)

- `machine_checks` verify identities the model derives from its own steps —
  genuine independent recomputation, not a proof the method or setup was right.
  Method compliance is a separate, clearly-labeled AI self-check.
- Proof-based math cannot be machine-verified; the workflow says so.
- XLSX formulas read as computed values; embedded charts read as data only.
- `.ppt`/`.xls` legacy binaries unsupported (honest error offered; .pptx/.xlsx fine).
- PPTX/DOCX images and diagrams are counted and named, not read.
- No live testing of any kind has occurred in this build environment.


## 19. Native targets & release infrastructure (added 2026-09-26)

| Item | Status |
| --- | --- |
| Capacitor `android/` — real Gradle project, appId com.bridgeline.sophira, Sophira icons in all mipmap densities | ✅ IMPLEMENTED (project generated + icons committed; APK build requires Android SDK — run locally or via `.github/workflows/release.yml`) |
| Capacitor `ios/` — real Xcode project, bundle id com.bridgeline.sophira, AppIcon asset set | ✅ IMPLEMENTED (project generated; `.ipa` requires macOS + Apple signing — see docs/NATIVE_BUILDS.md) |
| Tauri `src-tauri/` — Rust app, icons generated, bundles configured for msi/dmg/deb/AppImage | ✅ IMPLEMENTED (build requires Rust toolchain — CI matrix builds all three OS targets) |
| Release pipeline with SHA-256 checksums + GitHub release attach | ✅ IMPLEMENTED (`.github/workflows/release.yml`; requires repo variable SOPHIRA_APP_URL + optional signing secrets) |
| CI on push/PR: 144 tests, tsc, production build, native project presence | ✅ IMPLEMENTED |
| Atomic single-use invitation accept | ✅ IMPLEMENTED + code-reviewed (live verification: acceptance §14) |
| `/downloads` page — live GitHub-release lookup, honest empty states, checksum display | ✅ IMPLEMENTED (AUTO-VERIFIED via tsc/build; behavior needs a published release) |
| `/install` — platform-aware: PWA always primary, native option links to /downloads | ✅ IMPLEMENTED |
| Android release signing via env (secrets never committed) | ✅ IMPLEMENTED |
| Actual signed .ipa / .apk / desktop binaries produced | ⬜ NOT-YET-VERIFIED — requires Android SDK run or Apple certs + CI secrets; the pipeline reports this honestly instead of faking it |


## 20. Native pipeline compliance + honest limits (added 2026-09-26)

| Requirement | Status |
| --- | --- |
| Workflows fixed per spec (Tauri --bundles formats, SHA256SUMS-<platform>.txt, ALL-CHECKSUMS.txt, iOS workspace+pod+ad-hoc export, aapt/apksigner/codesign/PlistBuddy verification, signed-vs-unsigned job summaries, placeholder-URL refusal) | ✅ IMPLEMENTED (YAML-validated; staged in .workflows-pending/) |
| Workflows ACTIVE under .github/workflows | ❌ BLOCKED — repo PAT has no GitHub `workflow` scope (verified via API: no X-OAuth-Scopes; pushes rejected). Exact manual step in .workflows-pending/README.md |
| Android project genuinely builds | ✅ VERIFIED LOCALLY: real `gradlew assembleDebug` + `assembleRelease` executed with Temurin JDK 21 + Android SDK (platform 36, build-tools 34) — see §21 |
| Sophira-release.apk (signed, production URL) | ⬜ NOT-YET-VERIFIED — requires keystore secrets AND a deployed SOPHIRA_APP_URL (does not exist yet); pipeline refuses placeholder builds |
| Sophira.ipa | ⬜ NOT BUILDABLE HERE — requires macOS + Apple Developer cert + provisioning; workflow path implemented and honest |
| Linux .AppImage + .deb | ✅ BUILT AND VERIFIED LOCALLY (see §22) |
| Windows .msi / macOS .dmg | ⬜ CI-BUILDABLE ONLY — no Windows/macOS runners in this sandbox; matrix implemented in release.yml |
| First GitHub Release | ⬜ requires workflow activation + SOPHIRA_APP_URL |
| Downloads page: per-platform sections, inline SHA-256 (checksum-file fetch with graceful fallback), unsigned badges, honest empty states | ✅ IMPLEMENTED + tsc/build verified |
| docs/DEVICE_ACCEPTANCE.md — all rows honestly NOT TESTED (no physical devices in agent sandbox) | ✅ CREATED |
| docs/RELEASE_PROCESS.md — one-time config, release steps, artifact honesty table | ✅ CREATED |
| Live Supabase / real AI / real upload acceptance | ⬜ NOT TESTED — no backend credentials in sandbox; scripts and step lists ready in docs/MASTER_ACCEPTANCE_WORKFLOW.md |


## 21. Local Android build verification (2026-09-27, agent sandbox)

Real Gradle build executed (not CI, not simulated). Environment: Debian 12,
Temurin JDK 21.0.12, Android SDK platform 36 / build-tools 34.0.0, Gradle
8.11.1 wrapper.

| Artifact | Result |
| --- | --- |
| `app-debug.apk` — 8,141,000 bytes (8.1 MB) | ✅ BUILT, debug-signed (`CN=Android Debug`), SHA-256 `dc26e08f5c17839b0f7900e84eae63fb87bcb3b9fbd97d0500f32a80ee0ad731` |
| `app-release.apk` (signed path, TEST keystore) | ✅ BUILT, verified with `apksigner verify --print-certs`, SHA-256 `e29033aaf22ba02ab45e643a1f34958730b171e1e4d0a8ef9e3f9da72501ea83` |
| `app-release-unsigned.apk` (no credentials) | ✅ BUILT — honest unsigned default, exactly what CI produces without ANDROID_* secrets |
| Invalid credentials | ✅ FAILS CLEARLY (KeytoolException with a precise message; nothing fake is emitted) |
| `aapt dump badging` | ✅ `package: name='com.bridgeline.sophira' versionCode='1' versionName='1.0.0'`, minSdk 24, compileSdk 36 |
| Secret leak scan | ✅ NO keystore passwords in either APK (byte-level scan of packaged assets) |
| Placeholder URL | ⚠️ PRESENT in these verification builds (built against the placeholder on purpose) — the release workflow REFUSES to run against it, and these sandbox artifacts are explicitly NOT release artifacts |

### Build fixes discovered by the real build (also required by CI)

1. AGP 8.7.2 → **8.9.1** (androidx.core 1.17.0 requires it; Gradle 8.11.1
   wrapper already supports it)
2. compileSdkVersion 35 → **36** (androidx.core 1.17.0 AAR metadata)
3. minSdkVersion 23 → **24** (io.ionic.libs:ioncamera-android requires 24)
4. JDK **21** toolchain required by Capacitor 8 plugins (CI already uses
   setup-java 17 — updated to 21)

These were invisible to tsc/tests and would have broken the first CI run.

### What this does NOT claim

- No physical Android device was available: NOT device-tested.
- The release workflow still cannot run until the token gains `workflow`
  scope, `SOPHIRA_APP_URL` exists (deploy the web app), and real signing
  secrets are set. The APKs above are sandbox verification artifacts only.

## 22. Local Linux desktop build verification (2026-09-27, agent sandbox)

Real Tauri v2 build executed (Rust 1.98.1, webkit2gtk-4.1 2.50.6, Debian 12).
The build caught a real bug: `dangerousRemoteDomainIpcAccess` is a v1-only
key rejected by the v2 schema — removed in commit history.

| Artifact | Result |
| --- | --- |
| `Sophira_1.0.0_amd64.deb` — 2,863,138 bytes | ✅ BUILT; `file`: valid Debian binary package (format 2.0); SHA-256 `da4d10150da6edb8b8a87efb65312c3521b629b3260b926a542fc671bc5a840c` |
| `Sophira_1.0.0_amd64.AppImage` — 98,728,440 bytes | ✅ BUILT; `file`: ELF 64-bit LSB static-pie executable, stripped; SHA-256 `60a460f4668d5ff9a764383bf4de2292cc3bd6263ebf260dd595fdd05b76781c` |
| Secrets scan | ✅ no ANDROID_*/store/key password material in artifacts |
| Placeholder URL | ⚠️ present by design — this is a verification build; the release workflow rewrites `windows[0].url` from `SOPHIRA_APP_URL` and refuses the placeholder |

Launch verification (same sandbox, Xvfb virtual display):
`--appimage-extract` + `AppRun` under Xvfb → process runs (survives a 30s
timeout with zero error output), `xwininfo -root -tree` shows a mapped window
`"Sophira" 1280x832` AND a live `WebKitWebProcess` — the GTK shell boots and
the web engine initializes. Screenshot: docs/sophira-linux-launch-proof.png.
Still NOT claimed: real interaction/rendering of live content (no real
deployment URL exists), so the Linux device row stays NOT TESTED. Windows .msi and macOS .dmg require
their OS runners; implemented in the release matrix, not buildable here.

## 23. Linux desktop launch verification (2026-09-27, agent sandbox)

Beyond §22 (build), the AppImage was actually LAUNCHED headlessly:

| Check | Result |
| --- | --- |
| AppImage integrity | ✅ `--appimage-extract` extracts cleanly (FUSE unavailable in sandbox; AppImageKit's own documented fallback) |
| Process stability | ✅ AppRun runs; survives a 30s timeout window with ZERO stderr/stdout (EXIT 124 = our kill, not a crash) |
| Window creation | ✅ `xwininfo -root -tree`: mapped window `0x200003 "Sophira" ("sophira" "Sophira") 1280x832+0+0` |
| Web engine | ✅ live `WebKitWebProcess` window present — webkit2gtk initialized and rendering |
| Screenshot | ✅ docs/sophira-linux-launch-proof.png (1280x832, Xvfb :98 capture) |
| Honest limits | ⚠️ content shown is the unreachable-URL state (placeholder has no deployment); no mouse/keyboard interaction test; NOT a substitute for a real user's desktop test |

Environment: Debian 12, Xvfb, GTK 3, webkit2gtk-4.1 2.50.6, AppImage from §22
(SHA-256 60a460f4…76781c, i.e. the exact artifact a user would download).

## 24. Release-acceptance round (2026-09-27)

**Workflow activation retested and still blocked.** Copied
`.workflows-pending/{ci,release}.yml` to `.github/workflows/` and pushed;
GitHub rejected the push exactly as before: *"refusing to allow a Personal
Access Token to create or update workflow `.github/workflows/ci.yml` without
`workflow` scope"*. The local commit was reset so master stays pushable.
Exact blocker: the git credential must be a PAT **with the `workflow` scope**
(or an OAuth app / GitHub App with workflow-write). No other repo change is
required — the workflow files themselves are complete.

**Real bug found and fixed: middleware crashed public pages without Supabase
config.** A local production-serve smoke test (`next build` + `next start`,
then HTTP requests) returned 500 on EVERY route, including public
`/install` and `/downloads`: the middleware created its Supabase client
before the public-path check. Fix (src/middleware.ts): public paths
(`+ /downloads`) short-circuit when Supabase env is absent; every protected
route keeps the exact same fail-fast behavior; no auth check weakened when
the environment IS configured. 3 regression tests added
(144 assertions total). Verified by re-serving: `/install` → 200,
`/downloads` → 200, `/` → 500 (protected, unconfigured env — correct
fail-fast). This would have hit any misconfigured production deployment.

**Also this round:** confirmed `/install` is platform-aware (UA detection
for iOS/Android/Windows/macOS/Linux with per-platform native guidance and
PWA fallback), and the service worker audited: network-first everywhere,
HTML/API never cached — no academic data, Supabase responses, or AI output
enters any cache; app-shell-only precache.

Still blocked (unchanged, credential/environment-specific): workflow scope
token; hosting credentials to deploy the web app and set SOPHIRA_APP_URL
(the sandbox has no Vercel/Netlify/hosting credential and cannot deploy a
server-rendered Next.js app on GitHub Pages); Android signing secrets;
Apple signing credentials; physical devices; live Supabase/AI credentials.

## 25. CI ACTIVE and GREEN; matcher fix live in production (2026-09-27)

**GitHub Actions is now live.** With a workflow-scoped credential, both staged
workflows were activated and pushed (commit e925dec): `.github/workflows/ci.yml`
and `.github/workflows/release.yml` are registered as ACTIVE. **The first real
CI run completed with SUCCESS** on master (495099e): npm ci, 148 tests,
TypeScript, production build, native project presence.

**Middleware matcher fix verified LIVE in production.** After the Vercel
auto-redeploy: `/favicon.png` now returns 404 (was 500 middleware crash);
`/install` and `/downloads` return 200. Root `/` still returns 500 because
the Vercel Production environment still lacks NEXT_PUBLIC_SUPABASE_URL /
NEXT_PUBLIC_SUPABASE_ANON_KEY — code-side, root correctly fails fast as a
protected route until those are configured and a redeploy runs.

**SOPHIRA_APP_URL repository variable could NOT be set by the automation
credential (HTTP 403 — lacks variables:write scope).** Required external
action: repo Settings → Secrets and variables → Actions → Variables → add
`SOPHIRA_APP_URL` = `https://sophira.vercel.app`. The Release workflow
refuses placeholder URLs by design, so it stays dormant until this variable
exists. Android signing secrets and Apple signing material likewise remain
external (honest unsigned fallbacks built into the release pipeline).

## 26. Request round 2026-09-27: invitation hardening, typing, pacing, scheduling, rubric, research (offline)

Commit range `6f931ef..133bbd5`. All statuses below use the §3 legend —
nothing here claims live verification, because no Supabase project, AI key,
or search-provider key exists in this sandbox.

| Area | Status | Evidence |
|---|---|---|
| Invitation-only signup at the DB level | ✅ Implemented + logic unit-tested (26 new security assertions: direct signup blocked by `handle_new_user`, tokenless/fake/expired/revoked/wrong-email/reused invitations all rejected, member invitation REQUEST creates no access, no owner-impersonation path). Live RLS probe still pending per §4 | migration `0008_invitation_only_signup.sql` + tests §14x |
| Owner privacy boundary | ✅ Preserved — no policy grants the owner cross-user reads of academic content; research tables (0012) are `user_id = auth.uid()` for ALL rows | code review + schema tests |
| Typing calibration UI + persistence | ✅ Implemented + logic unit-tested (gross/net WPM, accuracy, suspicious-attempt rejection, baseline selection/replacement; `typing_attempts`/`typing_baseline` RLS). Onboarding step + Settings retake wired; live flow pending backend | migrations 0009; `/api/typing`; `TypingTest` component |
| Paced output wired to writing workspace | ✅ Implemented + logic unit-tested (`PacingController` drives `reveal` on the existing pacing engine — a single timing engine, not a second one; paused time excluded; no per-character DB writes; no calibration → honest message + calibration link, never an invented speed). Browser-level flash/pause/resume checks are design-reviewed, not Selenium-run | `PacedOutput` in Workspace; tests §15a-15c |
| Deadline-aware scheduling wired | ✅ Implemented + logic unit-tested (timezone-safe `due_at`, workload estimate wins, deterministic plans: 1-week → long breaks, 1-hour → near-minimum, urgent → minimum-bounded, impossible → infeasible warning, 10s min / 6h max enforced, pause/resume, persisted `work_schedules`). `/api/schedule` + `SchedulePanel` live flow pending backend | migration 0010; tests §15d |
| Rubric compliance engine | ✅ Implemented + logic unit-tested (checklist parsing, deterministic word/section/bibliography/citation/prohibited checks, AI criteria labeled `needs_semantic`/AI-assessed, revision list; `rubric_audits` persisted; found + fixed a real bug where headings after the first were reported missing) | migration 0011; tests §15e; `/api/rubric-audit`; `RubricAuditPanel` |
| Verified web research engine | ✅ Implemented + logic unit-tested, 🔶 **requires external configuration** (`SEARCH_PROVIDER`/`SEARCH_API_KEY` server-side). Tests cover dead URL, redirect, cross-domain redirect, paywall, thin content, good page with metadata, non-http refusal, quote authenticity, fabricated-quote rejection, citation styles, marker extraction, dedupe, objective ranking, provider-missing honesty. **No live search has been run — no provider key exists.** Without a key the API returns an honest failure and fabricates nothing | migrations 0012; `/api/research` + `/api/research/audit`; `ResearchPanel`; tests §15f-15i |
| Citation-aware essay generation | ✅ Implemented: solve route accepts `research_project_id`, injects ONLY approved+verified sources as wrapped untrusted context with [S#] labels + verbatim-quote rules, appends a deterministic Works Cited built from source records (never LLM-invented), persists `research_citations`; refuses to write a "researched essay" with zero approved sources | `/api/ai/solve` integration |
| Legal package | ✅ Proprietary all-rights-reserved license, strengthened ToS/Privacy Policy, legal-review notice; owner-specific facts are explicit placeholders, none invented | `LICENSE`, `docs/legal/*` |

**Offline suite at this commit: 277 passed / 0 failed** (was 233 before the
round), `tsc` clean, `next build` passes (38/38 pages), PWA manifest and
middleware untouched by the round (re-verified by the build).

### What this round did NOT verify (honest)
- No live Supabase run: RLS policies compile in the migration files but were
  not probed against a live Postgres (still §4-blocked on credentials).
- No live web search: the research workflow has never retrieved a real URL.
  A `SEARCH_API_KEY` (Brave or Tavily) is required for live verification.
- No browser automation run in this environment; pacing/scheduler UI claims
  are logic-level, not Selenium-level.
- Native builds unchanged this round; §21/§22 local build results stand.

## 27. FIRST LIVE verification of production (2026-09-27, 17:40–18:00 UTC) — homepage 500 found and fixed live

**A real production incident was found, diagnosed, fixed, and verified live.**

`https://sophira.vercel.app` returned **HTTP 500 (MIDDLEWARE_INVOCATION_FAILED)**
for every non-public path including the homepage, while matcher-excluded paths
(`/install`, `/downloads`, `/api/health`) were 200 — the exact signature of the
known missing-Supabase-env condition: the degraded-mode guard rendered public
pages but let protected paths fall into `createServerClient(undefined!)` and throw.

**Fix** (`f8b9878`, regression test updated `837adb8`): in degraded mode,
non-public paths redirect to `/login` instead of crashing. With env vars
configured the branch never runs — real auth behavior unchanged.

**Verified against the live deployment (curl + real browser session):**

| Check | Before fix | After fix (live) |
|---|---|---|
| `/` | 500 MIDDLEWARE_INVOCATION_FAILED | **307 → /login** |
| `/login` | (crashed) | **200 — full sign-in UI renders, "Have an invitation? Create your account" present** |
| `/install` | 200 | 200 — full PWA install instructions render in a real browser |
| `/downloads` | 200 | 200 — honestly says "No native release has been published yet" (no fake links) |
| `/manifest.webmanifest` | 200 | 200 — PWA manifest serves |
| `/api/health` | 200 | 200 — `{"ok":true,"name":"sophira"}` |
| Deploy pipeline | — | **auto-deploys master; fix live within ~2 min of push** |

Offline suite after the fix: **277/277** (two assertions updated from "protected
routes crash without env" to "protected routes redirect without crashing").

### Honest limits of this live pass
- Production is still in DEGRADED MODE: the Vercel production environment has
  no Supabase/AI/search env vars. Auth, database flows, writing, research —
  none of those can be live-tested until the owner sets the production env
  vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, optional
  `SEARCH_PROVIDER`/`SEARCH_API_KEY`).
- `.env.example` now documents all research provider variables (server-side only).

## 28. Implementation-audit round (2026-10-05) — 285/285 offline

Prompt 1 requested a full implementation audit against the requirements
checklist, then implementation of **only the CRITICAL BLOCKERS**. The audit
(see `docs/IMPLEMENTATION_AUDIT.md` + machine-readable
`docs/implementation-checklist.json`) verified every requirement area against
actual code — statuses, files, functions, tables, APIs, tests, env
dependencies, and blockers — and independently re-ran the suite at the base
commit (277/277), `tsc` (clean), `next build` (38/38 routes), and a live HTTP
probe of production (still degraded: `/` 307 → /login, public pages 200).

**Audit verdict:** no BROKEN systems. Two required features are MISSING
(submission readiness; stale-pattern detection), one item is PARTIAL for
stale detection, legal placeholders are external-by-design, and the
production/release blockers are owner-credential actions.

**Critical blockers fixed in the repository this round:**

| Blocker | Fix |
|---|---|
| CB2: fresh-install bring-up was un-runnable from the docs — README listed only 5 of 12 migrations and stated the REMOVED "first user becomes owner" rule (migration 0008 replaced it with fail-closed `app_config.owner_email`); the bootstrap SQL existed only inside the migration file | README setup rewritten (all 12 migrations + the mandatory `owner_email` insert + fail-closed explanation); `docs/RELEASE_PROCESS.md` gains the same bring-up step |
| CB3: no machine-checkable deployment-configuration signal — the exact blind spot behind the days-long §27 production 500s | `/api/health` now reports per-capability booleans (`supabase`, `supabase_service_role`, `ai`, `search`) — never values — with `force-dynamic`; 8 regression tests cover degraded/partial/full/custom-provider states and assert no secret value ever appears in the response |

**Critical blockers that remain OPEN (external, cannot be done from the
repository):** Vercel Production env vars (verify after setting with
`curl /api/health` — all booleans must read true); the `SOPHIRA_APP_URL`
Actions variable (audit token confirmed HTTP 403 on the variables API —
needs an owner with variables:write); native signing secrets/certs.

**Offline suite after this round: 285 passed / 0 failed** (277 + 8 health
assertions), `tsc` clean, `next build` passes. No working functionality was
removed, duplicated, or replaced; HIGH (submission readiness, stale-pattern
detection) and lower categories were NOT implemented — they await explicit
authorization per Prompt 1.

## 29. Claim→evidence traceability round (2026-10-05) — 326/326 offline

Prompt: upgrade the existing research system (NOT a rebuild) so every
substantive factual claim traces **CLAIM → SOURCE → EXACT SUPPORTING
PASSAGE → SOURCE URL → VERIFICATION STATUS**, and a citation is verified
ONLY when the retrieved source content actually supports the claim — never
merely because the URL resolves, the page exists, the title matches, or
the domain is reputable.

**What was added (all preserved on top of the existing stack — nothing
deleted, no existing verification weakened):**

| Piece | Detail |
|---|---|
| `src/lib/research/claims.ts` (NEW, pure) | Extraction-stage normalization (`normalizeClaimCandidates` — server-assigned claim ids, junk/invalid-labels dropped, never trusts the model), deterministic fallback extraction (`extractFactualSentences`), verbatim passage location with real character offsets (`locatePassage`), figure consistency (`claimNumbersSupported` — the number is the fact), mechanical claim→source verification (`verifyClaimAgainstSource`/`verifyClaims`), deterministic authority (`authorityScore` 1–9, `authorityVerdict` vs the assignment's source-type requirement), and the Research Integrity report (`buildIntegrityReport`/`formatIntegrityReport`) with the exact counts/failures format |
| Migration `0013_claim_evidence.sql` | `research_claims` gains claim_id, assignment_id, source_url, source_title, evidence_start/end, confidence, authority_score, verified_at, reasons + the 'verified'/'unverified' statuses; `research_projects.research_integrity` stores the report |
| `/api/ai/solve` (research path only) | The model must emit a `factual_claims` list (claim + [S#] sources + VERBATIM supporting passage) with the essay; the server verifies every claim×source pairing mechanically against the STORED retrieved content, persists the full trace rows, appends a final "Research Integrity" section to the essay (counts + FAILED claim/reason/action when applicable), returns `research_integrity`, and moves the project to status **'writing' — never 'complete'** — while any claim remains unsupported |
| `/api/research/audit` | Stored claim rows are re-checked against LIVE source state: a source that became unavailable after initial verification demotes its claims to UNVERIFIED (never silently kept); the integrity report is rebuilt with live URL/title/authority results, returned as `integrity` + `integrity_text`, and `pass` now REQUIRES `research_complete` |
| `ResearchPanel` UI | The audit block renders the Research Integrity counts and the FAILED list (claim, reason, required action); essay generation reports honestly when the essay is NOT research-complete |

**Blocking rules enforced mechanically:** verified requires (a) source
content available, (b) the passage located VERBATIM in it, (c) every
figure of the claim present in the passage, (d) substantive claim↔passage
overlap. Anything less is partially_supported / unsupported / unverified
— the system never guesses evidence and never invents URLs, titles,
authors, DOIs, dates, quotes, or evidence passages.

**Automated tests: 41 new assertions in section 16b, suite total 326/326
PASSED** (`npm test`, offline). Coverage mapped to the required
scenarios: valid claim/source match ✓; valid URL but unsupported claim ✓;
dead URL ✓; wrong source ✓; unrelated source ✓; partially supported
claim ✓; multiple sources supporting one claim ✓; one source supporting
multiple claims ✓; unsupported claim ✓; source becoming unavailable after
initial verification ✓; plus fabricated-passage rejection, numeric
mismatch (45% vs 40%), authority scoring/verdicts, report formatting
(18/18-style counts and the FAILED block), and the full trace-row field
chain. Three earlier test failures during this round were fixture bugs in
the tests themselves (a passage not present in the fixture source; a
claim whose figure its passage didn't contain) — fixed; final run 0
failed. `tsc` clean; `next build` passes.

**Honest limits:** no live run occurred (no AI key / search key in this
environment) — the model-emitted-claims path is code-reviewed and its
mechanical verification is fully offline-tested; the live end-to-end
path still needs configured credentials. Semantic support beyond token
overlap remains a deterministic heuristic, honestly labeled by its
reasons; the system's guarantee is mechanical: nothing reaches
"verified" without a verbatim, figure-consistent, overlapping passage
in the retrieved content.

## 30. Stale-pattern detection + submission readiness (2026-10-05) — 350/350 offline

Follow-up round ("push what you completed, then continue working"): the
two repo-owned HIGH-priority gaps from the implementation audit were
implemented on top of existing systems — nothing deleted, nothing
rebuilt, no behavior replaced.

**H2 — Stale-pattern detection (was MISSING).** A learning pattern not
observed for 180 days (`STALE_AFTER_DAYS`) no longer shapes AI context:
`isPatternStale`/`describeStaleness` in `src/lib/learning/patterns.ts`,
enforced inside `selectApplicablePatterns` (excluded at application
time). The pattern is never deleted and never silently demoted in the
database — that stays in the student's hands, consistent with the
existing user-owns-lifecycle philosophy; re-observation (last_observed
bumps) self-heals automatically. CorrectionsPanel shows a
"stale — excluded from AI context" badge with the honest reason.
Unparseable observation dates cannot be judged and are never silently
dropped.

**H1 — Submission readiness (was MISSING).** `src/lib/readiness.ts`
(pure `buildReadiness`) + `GET /api/readiness?assignment_id=` +
`ReadinessPanel` in the workspace: one mechanical verdict aggregating the
systems that already exist — draft present, independent verification
(failed machine checks block; "needs verification" is an honest warning,
never a silent pass), teacher method compliance, the persisted rubric
audit (missing audit with criteria present blocks), and research
integrity (unsupported claims block with the exact counts). Not
applicable checks never block; anything undeterminable is reported as
not-ready with the reason — the verdict is never guessed, and the panel
says "not ready means not ready, with exact reasons."

**Tests: 24 new assertions (sections 8d + 15j), suite total 350/350
PASSED.** During development 11 existing tests failed after the
staleness change — root cause: their fixtures carried fixed January
2026 observation dates, which are genuinely stale now; the fix was in
the fixtures (now observed-yesterday by default, so the suite can never
rot with time), NOT a weakening of the feature. Final run 0 failed.
`tsc` clean; `next build` passes.

**Honest limits:** no live run (external credentials still absent);
readiness reflects stored records only — it does not re-run the rubric
audit or the research audit itself, it reports their latest persisted
results.

## 31. Assignment-aware source authority (2026-10-05) — 393/393 offline

Prompt: EXTEND the existing research-ranking system (explicitly not
replace it) with assignment-aware source authority rules.

**What was added — `src/lib/research/authority.ts` (new, additive):**

| Piece | Detail |
|---|---|
| `classifyAssignment` | Deterministic classification of the research task into history / science / current events / literature / social science / general, from topic, question, course and teacher words (teacher words weigh double). No signal → general: the teacher/rubric requirements govern; without them the UNCHANGED generic ranker applies |
| `AUTHORITY_PROFILES` | Configurable, data-defined tier hierarchies exactly as specified — HISTORY (primary sources → scholarly → university archives → museums → government archives), SCIENCE (journals → NIH/PubMed → university → textbooks → scientific organizations), CURRENT EVENTS (original reporting → government releases → primary documents → established news), LITERATURE (primary text → scholarly criticism → university → journals → literary organizations), SOCIAL SCIENCE (peer-reviewed → government statistics → university research → research organizations → secondary) |
| `registerAuthorityProfile` | Profiles are configurable: a registered profile replaces a category's hierarchy at runtime |
| `rankCandidatesForAssignment` | The assignment-aware ranker: teacher gate first, then the profile's tier, then score (relevance, evidence quality, date fit) within a tier. `rankCandidates()` itself is UNTOUCHED and remains the generic fallback |
| `assessSourceAuthority` | Per-source decision record: category, rationale, tier, tier name, primary/peer-reviewed/institutional flags, teacher-required flag, date fit, relevance, evidence quality, human-readable reasons — the decision is STORED with the source (migration 0014) so the citation audit explains why each source was accepted |

**Requirements honored:** teacher requirements override generic
preferences as a hard ordering gate; .gov/.edu are never blindly
prioritized (institutional domains count only where the profile's
hierarchy values them, e.g. a random .gov page ranks last for a
literature essay); publication date matters under a recency requirement;
primary vs secondary and peer-review status come from the profile tier
and deterministic domain/DOI signals; grade level flows in via the
research spec.

**Citation audit integration:** `/api/research/audit` reads each stored
decision, builds a per-source acceptance explanation, passes it into the
Research Integrity report (`authority_explanations`, new field) and
returns it; the UI shows "Why each source was accepted" per source.
`/api/ai/solve` honors a stored `teacher_required` decision in its
authority check.

**Tests: 43 new assertions (sections 16c + 16d), suite total 393/393
PASSED.** The central proof: the SAME source set ranks archive-first
for history, journal-first for science, primary-text-first for
literature. Teacher-override, no-blind-gov/edu, tier fidelity (PubMed
tier 2 ≠ journals tier 1), date, relevance, evidence quality, profile
configurability and the decision record shape are all asserted.
**During development 6 tests failed.** Two were my own test bugs
(a backwards tier assertion; a report test built with no claim rows).
Two uncovered REAL bugs in the new code, both fixed: date_fit was
narrated in the reasons but never added to the score, and relevance
could flip adjacent profile tiers (the profile hierarchy now decides
order; relevance ranks within a tier). Nothing was fabricated; the
final run is 0 failed. `tsc` clean; `next build` passes.

**Existing research verification untouched:** redirect/dead-link
detection, canonical URL, metadata, hashing, ranking fallback, provider
and verify suites all pass unchanged.

## 32. FINAL SUBMISSION READINESS GATE (2026-10-05) — 426/426 offline

Prompt: upgrade the existing assignment/rubric validation with a
MANDATORY final submission gate. The rubric engine (src/lib/rubric.ts)
was NOT replaced — the gate composes it, the readiness aggregator
(src/lib/readiness.ts stays untouched) and the stored verification /
research-integrity records.

**`src/lib/readiness/finalGate.ts`** (pure) + **`/api/readiness/final`**
+ migration **0015** (persisted `responses.submission_gate`) + an
upgraded ReadinessPanel that renders PASS/FAIL lines and can never
display "Ready to Submit" unless the machine result computed it.

**Machine-enforced invariant (tested):**
`submission_ready === (blockers.length === 0)` — ONE hard failure of
any teacher, rubric, formatting, research or assignment requirement
⇒ `submission_ready = false`, `STATUS: NOT READY`, with the exact
blocking reason. A requirement that cannot be VERIFIED also blocks
("not verified" is never silently treated as satisfied).

**Evaluated by the gate (live, on the CURRENT draft — never a stale
badge):** assignment instructions, teacher instructions, rubric
requirements, word count, required sections, formatting, citation
count, citation style, bibliography/Works Cited/References, required
sources (approved & verified vs the spec), prohibited elements,
semantic requirements (stored AI-assessed results reused honestly;
unresolved semantic blocks), research integrity, claim-to-source
verification (unsupported claims listed by name — "Source #4 does not
support claim #12" style), source authority requirements, unresolved
placeholders (new deterministic detector), unsupported factual claims,
missing required sections, and deadline feasibility. Deadline
feasibility is an honest WARNING, not a content requirement: a passed
deadline warns loudly but does not mark ready content not-ready.

**API returns:** overall status, per-requirement results with evidence
and corrections, passed requirements, failed requirements, warnings,
research integrity status, citation integrity status, rubric status
counts, and the exact blockers. The rendered `formatFinalGate` block
matches the requested SUBMISSION READINESS / PASS|FAIL / ✓✗ /
STATUS: NOT READY shape.

**Tests: 33 new assertions (section 15k), suite total 426/426 PASSED.**
Central proof: a word-count-only failure flips a fully-ready draft to
NOT READY; placeholders, missing bibliography, unresolved/failed
semantic criteria, prohibited first person, failed machine checks,
method non-compliance, too few sources, unsupported claims (with exact
counts), authority failures, missing integrity report and citation
shortfalls each block individually; a feasible deadline passes and a
passed deadline warns honestly. Existing teacher/rubric rules were NOT
weakened — all 393 prior assertions still pass. `tsc` clean;
`next build` passes.

**Honest limits:** no live run (external credentials still absent);
`estimatedRemainingWorkMinutes` is passed as null by the route today
(the deadline check still runs) — wiring the workload estimator into
the gate remains future work.

## 33. Remaining in-repo gaps closed (2026-10-05) — 440/440 offline

Push state confirmed first: everything from this conversation was already
on origin/master. The three remaining PARTIAL audit items
(production-release-gate, production-env-config, legal-docs) share
external blockers (Vercel Production env vars, the SOPHIRA_APP_URL repo
variable, owner legal facts + attorney review) — this round closed every
remaining IN-REPOSITORY gap so the external steps are all that is left.

**1. Workload estimator wired into the final gate** (the explicitly noted
future work from §32): `/api/readiness/final` now passes
`estimateWorkMinutes(...)` (assignment mode, task/output type, rubric
word-count target, research linkage, source count) into the gate. The
gate uses the estimate ONLY while content blockers exist — a READY draft
has nothing left to fix, so a stale estimate can never make ready content
look late. Blocked content with a deadline the estimate cannot meet gets
an honest infeasibility WARNING (deadline stays non-blocking by design).

**2. Release-gate hardening (production-release-gate):** the release
workflow now refuses to ship against a misconfigured deployment. Each
native job runs `node scripts/verify-deployment.mjs "$SOPHIRA_APP_URL"`
which checks the target's live `/api/health` and fails when any required
capability (supabase, supabase_service_role, ai, ok, service name) is not
configured; search is optional (research degrades gracefully). Rules live
in `src/lib/deployment.ts` (unit-tested) and are mirrored in the
dependency-free script, which carries a `--self-test` (7 assertions)
run in CI — both must stay in sync.

**3. Legal-placeholder status (legal-docs):** `scripts/legal-status.mjs`
(+ `npm run legal:status`, `--json` mode) scans LICENSE + docs/legal/*.md
for the bracketed owner facts, reports them per file, and exits 0 once
all are completed. CI reports it informationally (never fails — the
placeholders are intentional until the owner fills them). Current status:
17 owner facts remain across LICENSE/ToS/Privacy — honestly machine-
visible instead of a vague "needs review".

**Tests: 14 new assertions (sections 17 + 17b + 2 updated gate deadline
assertions), suite total 440/440 PASSED.** During development one test
run failed: execFileSync treats the legal script's by-design exit code 1
as an error — the test now asserts that exit code explicitly. `tsc`
clean; `next build` passes; the verifier self-test passes 7/7.

**Still external (honest limits):** the owner must set the Vercel
Production env vars, set the SOPHIRA_APP_URL repo variable, complete the
legal owner facts, obtain attorney review, and run one real gated
release. None of these can be done from the repository.

## 34. Pattern evidence, confidence decay & behavioral adaptation (2026-10-05) — 480/480 offline

Upgrade of the EXISTING learning-pattern lifecycle (0005, workflow §9–§12,
candidate/active/corrected/inactive/recurring/temporary/teacher_required —
unchanged and still tested) — nothing was replaced or deleted. Added:

**1. Evidence tracking (migration 0016):** `learning_patterns` gains
`last_confirmed_at`, `last_used_at`, `confirmation_count`,
`contradiction_count`, `correction_count` and the intermediate
`lower_confidence` status, completing the required field set
(pattern_id/user_id/pattern_type(kind)/pattern_scope(scope)/confidence/
created_at/status/observation_count already existed). Ladder:
candidate → active → lower_confidence → inactive — never a delete.

**2. Evidence engine (`src/lib/learning/evidence.ts`, pure):** confidence
changes ONLY from recorded evidence. Positive: user_confirm (delegates to
the existing lifecycle confirm), repeated_use (existing growth rule),
teacher_supports, user_approves_work. Negative: user_correction /
user_rejects / teacher_contradicts (halve confidence ×0.5), 
alternative_method_used (deterministic ladder ×0.92, ×0.83, ×0.74, then
×0.55), instruction_conflict (×0.85). Status recomputed from confidence
+ contradiction history: <0.2 inactive; <0.55 with ≥3 contradictions
inactive; <0.5 lower_confidence; recovery ≥0.5 → lower_confidence→active,
inactive→recurring (existing semantics), recurring→active on later
confirmation. The requested example reproduces: 94% → 86.5% → 71.8% →
53.1% → INACTIVE (3-contradiction rule).

**3. Time decay (deterministic, bounded, explainable):** 90-day grace
then ×0.8 per 90-day window without confirmation OR use (anchor = most
recent activity). Floor 0.05, cap 0.95. A time-decayed pattern below the
demotion threshold stops entering the AI context even while its status
reads active; high-confidence old patterns still apply (gradual, not a
cliff). Applied patterns get `last_used_at` recorded — genuine use only.

**4. Teacher/assignment override, machine-enforced:** the solve route
asks the model to report genuine conflicts between applied patterns and
teacher/assignment instructions (defensively normalized, matched only
against patterns it could actually see); each conflict records
instruction_conflict evidence → decay + demotion. Prompt lines label
demoted patterns "teacher/assignment instructions always win over it";
`teacher_contradicts` demotes even teacher_required patterns.

**5. Explainable metadata:** `explainPatternDecisions` returns per-pattern
{pattern_id, status, effective_confidence, applied, reasons[]} — why
selected (scope match, confidence, history) or ignored (resolved status,
scope mismatch, 180-day staleness, time decay). Persisted with each
response (spec §40); the Corrections panel shows evidence counts,
effective confidence and decay badges.

**API:** POST /api/learning/patterns/evidence (record one event);
PATCH confirm now also records confirmation_count/last_confirmed_at.

**Tests: 40 new assertions (section 18), suite total 480/480 PASSED**
— all seven required scenarios plus determinism (same evidence twice =
identical outcome), bounds (50 contradictions never break the floor;
cap 0.95), time-decay window math, anchor-reset on use, and the metadata
explanations. During development three test failures were fixed: a
pre-evidence snapshot explained instead of the demoted pattern, a floor
case whose fixture was too fresh to decay, and a default count in a
fixture. `tsc` clean; `next build` passes.

**Honest limits:** evidence quality is bounded by what the system can
actually observe — the conflict loop records only conflicts the model
reports while seeing both the pattern and the instructions, defensively
normalized and never trusted blindly (an AI-reported conflict is evidence,
not certainty). Semantic contradiction detection (opposite wording of
similar phrases) is deliberately NOT attempted mechanically — it would be
guessing.

## 35. Persistent schedule execution state machine (2026-10-05) — 505/505 offline

Upgrade of the EXISTING deadline scheduler (0010, src/lib/scheduler.ts —
planSchedule, clampBreak, urgency, feasibility, and the 10-second
minimum / 6-hour maximum break bounds are ALL unchanged and still the
only place break durations are computed). Nothing was replaced.

**1. Persisted execution state (migration 0017):** `schedule_executions`
holds the full machine state per assignment: state
(WORKING / BREAK_PENDING / BREAKING / NEXT_WORK_SESSION / PAUSED /
COMPLETED / FAILED), started_at, expected_end_at, break_started_at,
break_end_at, accumulated_work_time, accumulated_break_time,
remaining_work, deadline, urgency, schedule_version (+ paused_from,
paused_at, current_session_remaining_seconds for early-ended sessions).
A partial unique index allows at most ONE live execution per
assignment — duplicate work sessions are structurally impossible.

**2. Timestamp-driven machine (`src/lib/schedule-execution.ts`, pure):**
reconcileExecution replays the PERSISTED schedule against the server
clock on every reconnect: crossing a work-session boundary while away
consumes only the session's PLANNED minutes (never the wall-clock gap),
starts the break at the session end with both break timestamps persisted
(bounded by the existing clampBreak), advances to NEXT_WORK_SESSION
when the break elapses, and fails honestly when the deadline passes with
work remaining. PAUSED is frozen (pause time is never work time; the
session window SHIFTS by the pause duration on resume). Reconciliation
is idempotent and deterministic — all 505 tests run offline against an
injected clock.

**3. Deadline changes never restart the schedule:** POST /api/schedule
(re-plan) re-bases a LIVE execution onto the new plan via
replanExecution — schedule_version bumps, accumulated history is
preserved, state kept, next session uses the new plan's durations.
Due in one week → longer breaks; due in one hour → breaks shrink to
the 10s floor (existing calculation, asserted in tests).

**4. API (/api/schedule/executions):** GET restores + reconciles the
state (refresh / browser close / reconnect — nothing lost, nothing
restarted); POST starts and returns an existing live execution with
already_active (duplicate prevention, backed by the DB index); PATCH
runs all actions through the validated pure machine. work_schedules
status stays roughly mirrored for older readers.

**5. HONESTY — no background computing:** there is no timer, worker or
AI running while the app is closed, and none is claimed. The UI states
it explicitly; the API returns the same note; the machine is reconciled
on reconnect from persisted timestamps. This is the honest
implementation the requirement asks for when autonomous background
execution is unavailable.

**Tests: 25 new assertions (section 19), suite total 505/505 PASSED**
— all nine required scenarios (refresh during work, refresh during
break, app closed during break, reconnect after break, deadline
changes, pause/resume, missed session, duplicate session prevention,
expired deadline) plus idempotent reconciliation, pause-freeze
semantics, early-break remainder resume, and break bounds. During
development two test-math bugs were found and fixed (absolute vs
relative epoch minutes; a resume expectation that ignored the worked
minutes) — the fixed expectations assert the machine's exact semantics.
`tsc` clean; `next build` passes.

**Honest limits:** state persistence and reconciliation are
server-side and tested purely offline; the API layer (Supabase RLS
queries) is exercised only by `tsc` and build, not by a live server run
(same standing limit as every prior round — no production env yet).

## 36. Optional adaptive typing profile (2026-10-05) — 520/520 offline

Upgrade of the EXISTING typing-speed system (0009, src/lib/typing.ts and
typing-passage.ts — canonical passage, server-side timing, WPM, accuracy,
net WPM, suspicious-attempt detection, user-selected baseline, retesting,
RLS isolation, paced output — ALL unchanged and still tested). The typing
test itself is untouched; nothing was replaced.

**1. Profile storage (migration 0018):** `typing_profiles` per user holds
baseline_wpm, recent_average_wpm, recommended_wpm, confidence
(LOW/MEDIUM/HIGH), sample_count, last_calibration_at, auto_adjust_enabled
(default FALSE), plus an optional manual_wpm preferred pace. Strict
per-user RLS (own_all policy, auth.uid()), one row per user.

**2. Pure engine (`src/lib/typing-profile.ts`):**
recomputeTypingProfile builds a rolling estimate over the most recent 5
VALID, UNFLAGGED, plausible attempts only — suspicious or invalid timing
data (implausibly fast, too short, incomplete, wpm ≤ 0 or > 220) can never
corrupt the profile. Recommended pace = floor of the midpoint between the
user-selected baseline and the recent average, clamped to [0.75, 1.25] ×
baseline (documented example: 62 + 67 → 64, HIGH confidence at 4+
consistent samples, spread ≤ 12 WPM). Deterministic, explainable, bounded.

**3. Pacing NEVER changes automatically (machine-enforced):**
effectiveTypingPace resolves manual preferred pace → adaptive recommended
ONLY when auto_adjust_enabled is true → otherwise the fixed baseline
(exactly the pre-existing behavior). PacedOutput uses the effective pace
with a baseline fallback — no behavior change unless the user opts in.
TypingTest shows the profile (baseline/recent/recommended/confidence/
samples) with an adaptive checkbox (off by default) and an optional
preferred-pace field with clear. Retake calibration stays: PATCH baseline
selection re-syncs baseline_wpm + last_calibration_at.

**4. API:** GET /api/typing now also returns the profile; POST only syncs
the profile for valid, unflagged attempts; PATCH (baseline select) syncs
on repeated calibration. New /api/typing/profile GET/PATCH
(auto_adjust_enabled, manual_wpm) creates the row on first use from the
user's selected baseline.

**Tests: 15 new assertions (section 20), suite total 520/520 PASSED** —
all seven required scenarios: first calibration, repeated calibration,
adaptive update (the documented 62/67→64 example), disabled
auto-adjustment (identical data → pacing stays at the fixed baseline),
suspicious attempt (flagged data never becomes an observation),
user-selected baseline (manual preference wins; clearing falls back), and
RLS isolation (migration asserted: row-level security, auth.uid()
policies, per-user cascade + unique). Plus a preservation check that the
original typing engine still computes 250 chars/min → 50 WPM validly.
Two fixture arithmetic mistakes were found and corrected during
development (the engine was right both times). `tsc` clean; `next build`
passes.

**Honest limits:** as in every prior round, the Supabase-backed API layer
is compile-checked and build-checked but not exercised against a live
server (no production env yet); the profile math and trust filter are
fully offline-tested.

## 37. Native build configuration: no silent production fallback + Capacitor 8 alignment (2026-10-05) — 538/538 offline

TASK 1 — SOPHIRA_APP_URL. The silent fallback
`url: process.env.SOPHIRA_APP_URL || "https://sophira.example.com"` was
REMOVED from capacitor.config.ts, and the hardcoded placeholder in
src-tauri/tauri.conf.json was replaced by the explicit development URL.
The native architecture was NOT rebuilt — only URL resolution. New pure
module `src/lib/native-url.ts` (unit-tested, §21) + CLI wrapper
`scripts/native-url.mjs` (self-tested, 11/11):

- RELEASE builds (`SOPHIRA_NATIVE_RELEASE=1` — used by `android:build`,
  `desktop:build`, and all release-workflow sync/patch steps): FAIL when
  SOPHIRA_APP_URL is missing, a placeholder (sophira.example.com, any
  example.com/your-* pattern), malformed, non-https, localhost, or
  credentialed. Verified live: all four failure classes abort `cap sync`
  before any artifact is produced; a valid https URL syncs with
  cleartext:false and the trailing slash normalized.
- DEV builds: no SOPHIRA_APP_URL → the EXPLICIT development configuration
  (SOPHIRA_DEV_URL → NEXT_PUBLIC_SITE_URL → http://localhost:3000,
  cleartext only for localhost, stated loudly). A provided URL is still
  strictly validated — a placeholder fails even in dev (no silent
  fallback anywhere, verified).
- CI release.yml now runs the android/ios syncs and the desktop tauri
  patch in release mode as well, so the config-level gate backs up the
  existing workflow guards.

TASK 2 — Capacitor version alignment. The project ran @capacitor/cli 7.6.9
against android/core/ios 8.5.2 (mixed majors). The compatible major for
the existing project is **8** (all platforms and the plugins
@capacitor/app 8.1.1, @capacitor/camera 8.2.4 are 8.x; Node 20/24 and
the existing android/ios projects match Capacitor 8). Only the CLI was
changed — no unrelated dependencies were touched. After `npm install`:

    @capacitor/android 8.5.2
    @capacitor/ios     8.5.2
    @capacitor/core    8.5.2
    @capacitor/cli     8.5.2   (was 7.6.9 — aligned)
    @capacitor/app    8.1.1
    @capacitor/camera 8.2.4

All majors are 8 — no mixed versions remain.

**Verification run:** dependency install ✓, `tsc --noEmit` ✓, suite
**538/538** ✓ (18 new §21 assertions), `next build` ✓, `cap sync android`
✓ (dev config baked; release gate verified), `cap sync ios` ✓. The native
Gradle/Xcode builds and `tauri build` were NOT run here — this sandbox has
no JDK/Gradle/CocoaPods/Rust toolchain; they run in the release workflow
on GitHub runners (unchanged, already gated).

**Tests: 18 new assertions (section 21), suite total 538/538 PASSED.**
`tsc` clean; `next build` passes; `native-url.mjs --self-test` 11/11.

**Honest limits:** live APK/ipa/desktop artifacts still require the owner
to set the `SOPHIRA_APP_URL` repository variable and tag a release — the
placeholder guards now fail closed instead of silently shipping a fake URL.

## 38. Security regression suite — permanent privacy gate (2026-10-05) — 564/564 offline

TASK — permanent automated security regression suite. NO existing RLS was
weakened (migrations untouched; verified by `git status` + the conformance
engine itself). Two layers, both part of the standard acceptance workflow:

**LAYER 1 — LIVE MATRIX (`tests/security/rls-regression.mjs`).** Runs the
privacy matrix against the ACTUAL database and RLS policies (real auth
users, real per-user clients — not mocked authorization functions) whenever
a disposable Supabase test project is configured
(SUPABASE_TEST_URL/ANON_KEY/SERVICE_ROLE_KEY, all-or-none, fail-closed —
verified: partial config exits 1, absent config exits 3). Test users
created per run: OWNER, USER_A, USER_B, UNAUTHORIZED. Representative
private data seeded for A and B across all NINE categories (assignments,
responses, teacher_profiles, writing_samples, feedback, learning_patterns,
research_projects, typing_attempts, assignment_files) with unique marker
strings so any leak is mechanically detectable. Enforced matrix:
OWNER → USER_A's nine categories → NO ACCESS; USER_A ↔ USER_B → NO ACCESS;
unauthenticated → NO ACCESS (incl. profiles); revoked USER_B → others'
data NO ACCESS (revocation also verified to work + restore via the same
admin path the members API uses); DELETED user → session dead + cannot
sign back in; data owner → full access to own data (read + write, all
nine categories); OWNER membership management works (create/list
invitations; USER_A cannot forge invitations); owner analytics
(network_stats) → EXACTLY the eleven permitted aggregate columns,
mechanically verified to contain ZERO private markers, aggregate counts
visible, and USER_A/anon calls DENIED. Self-test mode (4/4) always runs
in CI.

**LAYER 2 — OFFLINE CONFORMANCE (tests/run.ts §22, 26 assertions, runs on
EVERY `npm test`).** Parses the actual migration SQL and enforces: every
created table has RLS enabled; every policy is auth.uid()-scoped; no
`using (true)` permissive policy; network_stats is SECURITY DEFINER,
owner-gated, returns exactly the permitted columns, reads content tables
ONLY via count(*) (plus the documented subject_usage aggregate:
subject + count only); get_invitation_by_token exposes only ONE pending
invitation by exact token (the documented signup exception); the live
suite exists and is wired into the acceptance workflow; revoked users are
blocked at the guard/middleware layer.

**Tamper evidence (run live):** removing RLS from `assignments`,
adding a `using (true)` policy on `responses`, and adding essay content
to `network_stats` each caused the suite to FAIL loudly. All tampering was
reverted; migrations are byte-identical to before.

**Acceptance wiring:** `.github/workflows/release.yml` tests job now runs
the suite self-test ALWAYS, and the full live matrix whenever the
SUPABASE_TEST_* secrets are configured (loud `::warning::` when not; hard
fail on partial config). CI offline enforcement means a PR cannot silently
drop a table's RLS, add a permissive policy, or leak content into owner
analytics even without a test project.

**Verification run:** suite **564/564** (26 new security assertions),
`tsc` clean, `next build` passes, self-test 4/4, fail-closed semantics
verified (exit 3 absent / exit 1 partial), tamper detection verified in
three scenarios.

**Honest limits:** the LIVE matrix could not be executed in this sandbox —
no disposable Supabase test project exists. It will run automatically in
CI once the owner sets the three SUPABASE_TEST_* secrets. Owner analytics
were verified aggregate-only offline; the live DB check awaits the same
configuration.

## 39. Invitation-only access — complete security verification (2026-10-05) — 621/621 offline

TASK — full security verification of the EXISTING invitation-only workflow
(18 items). The invitation system was NOT rebuilt; no boundary was weakened.
Two layers added to the standard acceptance workflow:

**LAYER 1 — LIVE MATRIX (`tests/security/invitation-regression.mjs`).** Runs
all 18 items against the REAL database: actual `auth.signUp` calls, the real
`handle_new_user` trigger (0008), real RLS policies. Stranger signup without
an invitation REFUSED + no account created; valid invitation → lookup +
signup succeed + status accepted; reuse/single-use (atomic claim, second
signup refused, used token lookup returns nothing); expiry enforced at
lookup AND signup; revocation enforced at lookup AND signup (revoked via the
owner's RLS client — the same policy path the API uses); email binding
(wrong-email signup refused, invitation stays pending); missing/fake/modified
tokens all return nothing (exact-equality match on 192-bit tokens);
non-owner cannot list/forge invitations or self-approve requests;
permission-less member cannot even file a request; permitted member CAN
request; a merely-REQUESTED email stays unauthorized (signup refused) until
the owner issues the invitation; removal (deleteUser) kills session, profile
and auth account. PRIVACY: every error message observed during the run is
collected and mechanically checked against all live tokens — zero token
leaks. Fail-closed env (absent → exit 3, partial → exit 1), self-test 3/3.

**LAYER 2 — OFFLINE (tests/run.ts §23, 40 assertions, every `npm test`).**
Verifies all 18 items against the actual migration SQL and route/guard/
signup source: trigger-refused signup, fail-closed bootstrap (app_config
revoked from clients + RLS), no first-signup-becomes-owner (owner only via
operator-configured email), atomic claim (for update skip locked, no
pre-settable claim variable), pending/unexpired exact-token lookup, accept
route conditional update + expiry re-check + email binding + 404/410/403,
pending→revoked-only transition, 192-bit random tokens everywhere,
owner-only invitations policy (owner role AND invited_by=auth.uid() in both
using and with check), can_request_invites-gated request filing, no
requester-update policy, owner-only approval that issues real invitations,
requests never create access, members API revoke/remove with owner
protection, revoked users refused by the guard, middleware protection, and
token-leak checks (no token logging, no `${token}` interpolation in public
routes, token-free DB refusals). Frontend AND backend enforcement verified —
the DB trigger is the gate, the UI is only convenience.

**Tamper evidence (T1–T5, run live):** bypassing the signup gate, stripping
pending/expired checks from the token lookup, removing the atomic claim
condition, dropping the owner check from the invitations policy, and
echoing a token in an error message EACH failed the suite loudly. The first
tamper round exposed three loose cross-file regexes in my own assertions —
fixed by scoping to the final (lastIndexOf) function/policy block; all five
scenarios then failed as required. Sources restored byte-identical after
testing (verified with diff).

**Bootstrap hardening (found during verification):** `rls-regression.mjs`
would have failed against a fully-migrated test project because 0008 makes
signup invitation-only — including its own test-user bootstrap. Fixed: the
suite now sets `app_config.owner_email` and pre-seeds invitations for its
test users before creating them (migration-aware bootstrap).

**Acceptance wiring:** release.yml runs both live suites' self-tests always,
and both live matrices when SUPABASE_TEST_* is configured (loud warning when
not; hard fail on partial config).

**Verification run:** suite **621/621** (57 new invitation assertions),
`tsc` clean, `next build` passes, both self-tests green, fail-closed
semantics verified, tamper detection verified in five scenarios.

**Honest limits:** the LIVE matrix could not be executed here — no disposable
Supabase test project exists in this sandbox. It runs automatically in CI
once the owner sets the three SUPABASE_TEST_* secrets. All 18 items are
nevertheless verified offline against the real migration SQL and route code,
and three genuine holes in my own first-draft assertions were caught and
fixed by the tamper round.

## 40. Legal-document inspection & configuration gate (2026-10-05) — 633/633 offline

TASK — inspect the EXISTING legal framework (LICENSE, TERMS_OF_SERVICE,
PRIVACY_POLICY, LEGAL_REVIEW_NOTICE — all preserved, none deleted). Verified
it addresses all 21 required topics; strengthened one gap and added an
owner-configuration gate. NO legal values were invented anywhere.

**Placeholders inventoried (all preserved as placeholders):**
[LEGAL ENTITY NAME], [COPYRIGHT HOLDER LEGAL NAME], [ADDRESS],
[CONTACT EMAIL], [LEGAL CONTACT NAME / EMAIL / ADDRESS], [EFFECTIVE DATE],
[EFFECTIVE DATE YEAR], [JURISDICTION], [MAXIMUM LIABILITY AMOUNT / AS
REQUIRED BY APPLICABLE LAW], [DISPUTE RESOLUTION METHOD...], [APPLICABLE
RULES], [RETENTION PERIOD].

**New: docs/legal/LEGAL_CONFIGURATION.md** — a structured table of every
owner-supplied field (identity, dates, jurisdiction, liability cap, dispute
method/forum, retention period, attorney review), where each appears, and a
publication gate: all fields supplied + placeholders replaced + attorney
review completed before production publication. Status marked INCOMPLETE.

**Strengthened (ToS §18 enforcement):** added cautious language —
unauthorized copying, redistribution, modification, sublicensing, or
commercial exploitation *may constitute* copyright infringement and/or
breach of the Terms and License; the Operator *reserves all rights and
remedies available under applicable law*. No "legal trouble" phrasing
exists anywhere (verified: zero matches). LICENSE §6 already carried the
same cautious standard; unchanged.

**LEGAL_REVIEW_NOTICE preserved and extended** — still states the documents
are templates, are NOT legal advice, and that attorney review is
recommended before production publication; now also states that neither the
AI nor Base44 is the owner's lawyer, that the documents carry no guarantee
of legal enforceability and have not been approved or reviewed by any
attorney, and points to LEGAL_CONFIGURATION.md for the owner-supplied
fields.

**Coverage verified against the 21 required topics:** copyright ownership
(LICENSE §1; ToS §18), proprietary status (LICENSE §1–2), unauthorized
copying (LICENSE §3a, §6), redistribution (§3a; ToS §17), modification
(§3c), sublicensing (§3b), commercial exploitation (§3b), source-code
confidentiality (LICENSE §1, §4), IP enforcement (LICENSE §6; ToS §18,
cautious language), account termination (ToS §22–23), acceptable use (ToS
§6, §13–17), privacy/data processing (PP), user academic data (PP; ToS
§7–8), security responsibilities (ToS §4, §25; PP security practices),
third-party services (ToS §19; PP AI processing), disclaimers (ToS §27,
academic notice), limitation of liability (ToS §28), dispute mechanism (ToS
§31, owner to choose), governing law (LICENSE §7, ToS §30, owner to
choose), effective date (headers, owner to set), contact information (ToS
§35, owner to set).

**Tests: 12 new assertions in section 16** — LEGAL_CONFIGURATION exists and
is marked INCOMPLETE; every required field is listed; no document claims to
be "legally guaranteed" or "attorney approved"; the ToS carries the cautious
enforcement language; the review notice keeps the no-legal-advice and
attorney-review statements and names the AI/Base44 non-representation.
Suite **633/633**, `tsc` clean, `next build` passes.

**Honest limits:** the documents remain templates with placeholders by
design — the owner (ideally via a qualified attorney in the chosen
jurisdiction) must supply every value in LEGAL_CONFIGURATION.md before
production publication. Nothing here is legal advice.

## 41. Master acceptance workflow — dedicated sections (2026-10-05) — 838/838 offline

TASK — update docs/MASTER_ACCEPTANCE_WORKFLOW.md: preserve the existing
27-step end-to-end workflow and sign-off table (nothing removed), and add
24 dedicated acceptance sections (A1-A24): typing calibration, typing-paced
output, adaptive typing profile, deadline scheduling, persisted work
sessions, break state persistence, rubric auditing, submission readiness,
research provider configuration, research retrieval, source verification,
claim-to-source evidence, citation integrity, source authority, PWA
installation, native build, native deployment URL validation, invitation
security, owner privacy, RLS isolation, learning confidence decay,
teacher-rule precedence, correction learning, legal production-readiness.

**Structure enforced:** every test row defines prerequisites, exact steps,
expected result, failure condition, evidence required and status. IMPLEMENTED
and VERIFIED are explicitly distinguished; the doc states in writing that
code existence alone NEVER counts as PASSED — each PASSED row cites the
executed verification (tests/run.ts section + run date 2026-10-05 + suite
count) that observed the behavior.

**Honest results:** 35 test rows — 24 PASSED (verified by executed offline
checks: 838/838), 0 FAILED, 11 BLOCKED (implemented, verification blocked;
each blocker named: live API credentials/production env, no deployed
backend, no physical devices, Apple cert+Mac, Linux toolchain, Windows/macOS
machines, SUPABASE_TEST_* secrets, owner legal fields + attorney review),
0 NOT RUN. Totals table and blocked list are in the doc.

**Machine-checked (new suite §24):** all 24 sections exist; every section
carries the six required fields; the 24/11 PASSED/BLOCKED row counts match
the totals; TOTAL=35 matches the actual rows; PASSED rows cite executed
evidence with dates; blocked rows name blockers. The doc cannot silently rot.

**Verification run:** suite **838/838** (205 new doc-conformance assertions),
`tsc` clean, `next build` passes.

**Honest limits:** the 11 BLOCKED rows cannot be verified in this environment
(they need owner-side infrastructure, devices, credentials, or legal input).
Everything verifiable offline is verified and evidenced.

## 42. Single authoritative release gate (2026-10-05) — 889/889 offline

TASK — one authoritative production/testing release gate:
`docs/RELEASE_GATE.md` + the executable `node scripts/release-gate.mjs`.

**The gate** evaluates all 38 required checks (production URL live check,
database migration probe of the newest migration table, AI/search provider
configuration, live search test, the five live security-matrix checks,
15 offline-verified core behaviors, PWA Android/iPhone device rows, APK
build + device test, native URL, Capacitor alignment, legal placeholders,
production env vars, secrets scan, npm test, npm build, typecheck, security
tests). Every check prints evidence. Statuses are exactly PASS / FAIL /
BLOCKED / NOT RUN; NOT RUN and BLOCKED are NEVER treated as PASS; the only
final states are `RELEASE STATUS: GO` (all 38 PASS) or
`RELEASE STATUS: BLOCKED` with EVERY blocker numbered and named. Exit
codes: 0 GO, 1 blocked/failed in enforcement mode; `--report` for
reporting, `--fast` for reuse of a same-job suite run, `--self-test` for
the gate's own rules.

**Executed today (full mode):** 38 checks → 20 PASS, 0 FAIL, 17 BLOCKED,
1 NOT RUN (Gradle APK artifact not present in the tree; run the android
build before deployment). RELEASE STATUS: BLOCKED with 18 numbered
blockers, all owner-side prerequisites (production URL, DB credentials,
provider keys, SUPABASE_TEST_* secrets, physical devices, legal owner
facts). Honest: everything verifiable offline passed, including the
secrets scan (306 tracked files clean) and Capacitor alignment (all
@capacitor/* on major 8). Full report saved: docs/RELEASE_GATE_REPORT.txt.

**Wiring:** the release workflow gained a `release-gate` job (needs:
tests) that runs the gate with all available secrets/vars, publishes the
full report to the job summary, and emits a BLOCKED warning — CI can now
never silently claim readiness. The gate is repeatable: run it before
every production deployment.

**Machine-checked (new suite §25):** the doc lists all 38 required
checks by name, declares the two-state semantics, defines the four
statuses, states NOT RUN/BLOCKED are never PASS; the script registers
exactly 38 checks, emits GO/BLOCKED with numbered blockers, exits nonzero
when blocked, supports the three repeatability modes; the workflow runs
the gate; the script's --self-test passes. Suite **889/889**, `tsc`
clean, `next build` passes, release.yml YAML-validated.

**Honest limits:** the gate reports BLOCKED until the owner supplies the
production prerequisites. That is the gate working as designed — a
release cannot be claimed ready while they are missing.

## 43. PWA direct-browser readiness (2026-10-05) — 931/931 offline

TASK — prepare Sophira for immediate direct-browser/PWA testing with NO
App Store or Google Play requirement. Verified the existing PWA against
all 10 requirements and documented the exact owner testing steps.

**10-point verification (docs/PWA_TESTING_GUIDE.md):** (1) runs from the
production URL (deployment readiness script + health check; the URL itself
is the owner-side prerequisite), (2) secure authentication (Supabase SSR
cookie sessions + auth middleware, suite §1), (3) invitation-only signup
refused at the DATABASE level (migrations + suite §23), (4) installable on
mobile (valid manifest, one-tap prompt + exact Safari/Chrome steps on
/install), (5) authenticated state retained across reloads/installs
(cookie-based sessions), (6) all required assets present — icon-192.png
(192x192), icon-512.png (512x512), apple-touch-icon.png (180x180),
favicon-32.png (32x32) verified with exact PNG header dimensions, (7)
works after installation (standalone, start_url /dashboard, shell files
bypass the auth middleware by design), (8) offline/online transitions are
DELIBERATELY limited and honestly documented: the service worker caches
ONLY the static shell (icons, manifest, _next/static) — HTML and ALL API
responses are never cached; there is NO offline AI/research/solve
functionality and none is claimed anywhere in src/ (grep-verified),
(9) reconnect keeps assignment state — everything is server-side; the
timestamp-driven execution state machine reconciles on load (suite §19);
honest limit: unsubmitted mid-request input can be lost, (10) clear
installation path (/install with platform detection + step-by-step
iPhone/Android instructions, linked from Settings).

**Shared-device privacy (machine-checked):** the SW never stores HTML,
API responses or any user content — cross-user cache leakage is
impossible by construction; sessions are cookies (sign out before
sharing a device, as with any website login).

**Machine checks (new suite §26, 42 assertions):** manifest validity and
required fields; every icon's exact PNG dimensions; the SW precache list
contains ONLY icons + manifest; the isStatic gate references only static
paths; same-origin GET-only handling; middleware serves the shell; SW
registration exists; /install has the exact steps and the no-app-store
statement; ZERO offline-AI claims in src/; the guide exists with all four
owner instruction sections.

**Exact owner steps documented:** opening the production URL, installing
on Android (Chrome), installing on iPhone (Safari), and starting the
first test (launch from home screen → dashboard → walk the master
workflow, record in DEVICE_ACCEPTANCE.md so the release-gate device rows
can turn PASS).

**Honest limits:** live/device verification (rows 1, 4-7, 9 live aspects
of the guide) requires the deployed production URL and physical devices —
the owner's steps are in the guide. Suite **931/931**, `tsc` clean,
`next build` passes.

## 44. Final regression audit (2026-10-05) — 931/931, remediation applied

Full regression audit over all 32 capabilities (19 pre-existing + 13 new)
plus the 16-point regression checklist.

**Executed:** npm test 931/931; tsc --noEmit clean; next build compiled
successfully; both security suites' self-tests pass (RLS 4/4, invitation
3/3); gate self-test (38 checks); native-url self-test 11/11;
verify-deployment self-test 7/7; npm ls clean; npm audit; RLS/migration
scan; placeholder/fabricated-URL scan; routes and API call check.

**Dependency security remediation (targeted, test-verified):**
- mathjs 14.0.0 → 15.2.0 (GHSA-29qv-4j9f-fjw5, unsafe property setter) —
  runtime math engine; full math verification suite re-verified.
- xlsx 0.18.5 (npm, last published) → 0.20.3 from the official SheetJS
  distribution (GHSA-4r6h-8v6p-xvw6, prototype pollution in parsing —
  reachable via document ingestion) — spreadsheet ingestion re-verified.
- postcss 8.4.38 → 8.5.29 via overrides + direct devDependency bump
  (GHSA-qx2v-qp2m-jg93, XSS in stringify output) — build pipeline
  re-verified.
- Transitive fixes: braces → 3.0.3 (latest published), uuid advisory
  cleared.

**Audit regression caught and corrected during this audit:** `npm audit
fix --force` silently upgraded Next 14.2.35 → 16.3.8, which broke the
build (cookies() became async — tsc errors in src/lib/supabase/server.ts).
Reverted to the pinned 14.2.35; tsc/build re-verified clean. Recorded here
as proof the audit genuinely exercises the build.

**Remaining npm audit findings — documented honestly, not hidden:**
- next critical (GHSA-9g9p-9gw9-jx7f, Image Optimizer DoS via
  remotePatterns): NOT REACHABLE in Sophira — the app uses no next/image
  component and no images.remotePatterns configuration (verified in
  next.config.mjs and src/). The only fix is a semver-major upgrade
  (16.3.8) which BREAKS the current build (verified). Owner-side decision:
  schedule the Next 15/16 migration deliberately, not mid-audit.
- 6 high: braces/chokidar/micromatch/fast-glob/tailwindcss/
  tailwindcss-animate — all DEV-TIME build tooling (Tailwind 3.4.3's glob
  chain), never shipped to users; braces 3.0.3 IS the latest published
  release (no fix released yet; fixAvailable: false).

**All 16 regression checklist items clean.** No TypeScript errors, no build
errors, no migration errors (0001-0018 intact, RLS enabled on every
policy-bearing table), no RLS/auth errors, no broken routes (24 API route
groups + all pages compile), no broken API calls, no missing env vars
beyond the documented owner-side production setup, no dependency conflicts
(capacitor deduped on 8.5.2), secrets scan clean (no committed secrets),
no incorrect permissions, no duplicated logic introduced (native-url
mirror pair is self-test-synced by design), no dead code from the fixes,
no placeholder production URLs (the only example.com reference is the
REMOVED_FALLBACK enforcement constant), no fabricated research links
(citations derive from verified records only), no unsupported factual
claims (unverifiable claims marked UNVERIFIED by design).

## 45. Owner-controlled access system (2026-10-05) — 989/989 offline

TASK — secure owner-controlled access: permanent owner role, grant/revoke/
reinstate/permanent removal, immediate revocation of every access path,
server-side enforcement everywhere, no client-side-only boundaries, and
owner documentation.

**Discovered architecture (reused, not rebuilt):** Supabase Auth with
`profiles.role` (owner/user — no admin role required; the architecture
never needed one), `profiles.status` (active/revoked, migration 0005),
fail-closed owner bootstrap via operator-set `app_config.owner_email`
(migration 0008 — no hardcoded password, no stranger can claim a fresh
install), middleware revoked-user redirect, and the server-side guard
(`requireUser` → authenticated → ACTIVE access; `requireOwner` → owner
role) already on most API routes.

**Security gap found and fixed:** 4 routes checked authentication but NOT
revoked status — a revoked user could still call AI/extraction:
`/api/account/delete`, `/api/ai/analyze-writing`,
`/api/ai/extract-teacher-doc`, `/api/extract`. All four now go through
`requireUser` (the full authenticated → active → resource chain).

**Migration 0019 (additive, no existing policy weakened):**
- `profiles.access_revoked_at` — when access was revoked (NULL = active).
- `network_stats()` extended to return each member's email identifier and
  revocation timestamp; computation of every existing column preserved
  verbatim; still owner-only (fail-closed role check) and still
  aggregate-only (no academic content).
- `revoke_all_sessions(uuid)` — service-role-only SQL function that
  deletes all the target user's refresh tokens: revoking access now
  kills every previously issued session server-side (installed apps, open
  browsers, old tokens cannot refresh; middleware + guards reject them
  immediately regardless).

**Owner actions (server-enforced via requireOwner):** revoke (status +
timestamp + session kill), restore (status + timestamp cleared),
permanent removal (auth user deletion cascades all data),
invite-permission toggle; the owner cannot revoke/remove their own or any
owner account. Access Management UI (`/owner`) now shows name, email,
role, status, date granted, date revoked, with revoke/restore/remove/
grant (invitation) buttons and an explicit "only the owner" notice — the
UI is a window, never the boundary.

**Enforcement chain machine-checked (new suite §27, 58 assertions):**
every API route enforces the guard or is on the documented public
allowlist (health + single-use-token invitation accept, which must be
pre-auth); the guard implements authenticated → revoked-reject(403) →
role; middleware redirects revoked users; revoke records both status and
audit timestamp AND kills refresh tokens; restore clears both; removal
deletes the auth user; /owner is server-side owner-only; the UI shows all
required fields; fail-closed owner bootstrap preserved; ZERO plaintext
credentials in src; docs/OWNER_ACCESS.md covers creation, login, role
storage, identification, credential recovery, revocation, reinstatement.

**Remaining security limitations (honest):** a still-valid short-lived
Supabase access token (~1h) technically authenticates at the auth layer
for its remaining life, but every Sophira server path rejects revoked
users via the live-database status check, so it grants nothing; the
operator/deployer (Supabase project access) remains the trust root for
owner-account recovery — by design. Suite **989/989**, tsc clean,
`next build` passes, all security self-tests pass.

## 46. Deployment-readiness audit for real end-to-end AI testing (2026-10-06) — 1051/1051 offline, live deployment confirmed DEGRADED, not broken

**Round intent:** make the existing deployment ready for REAL end-to-end AI
testing. Audit only — no authentication, owner-access, revocation,
invitation, RLS, AI-routing, or security code was modified this round.

**Actually run today (offline):**
- `npm test` — **1051/1051 PASSED** (compiles tests via tsc, runs the full suite).
- `npm run build` — **passes** (Next 14.2.35).
- Release gate (full mode, includes build + tsc) — **20 PASS / 0 FAIL / 17 BLOCKED / 1 NOT RUN**, RELEASE STATUS: BLOCKED; every blocker is an owner-credential item. `docs/RELEASE_GATE_REPORT.txt` regenerated (the committed copy was stale — it still said "migrations 0001–0018" from before the 0020 memory migration; the file now records the current 0001–0020 chain and today's gate run).
- `node scripts/verify-deployment.mjs --self-test` — 7/7.
- Secrets scan (repo-wide pattern scan + gate secrets check) — no hardcoded keys/credentials in source.

**Actually verified LIVE against https://sophira.vercel.app (today):**
- `GET /api/health` → `{"ok":true,"name":"sophira","configuration":{"supabase":false,"supabase_service_role":false,"ai":false,"search":false}}` — the production deployment is **degraded, and it reports that honestly** (booleans only, never values, per the health contract).
- `GET /` (unauthenticated) → 307 to `/login`; `/login` → 200 prerendered shell (client-rendered sign-in form, no misleading "working" claim).
- `node scripts/verify-deployment.mjs https://sophira.vercel.app` → exit 1: "Deployment NOT ready: Supabase (auth + database); Supabase service-role key (AI/extract/account routes); AI provider key. Optional: web-search provider" — the deployment verifier fails closed exactly as designed.
- Unauthenticated probe `POST /api/invitations/accept` (fake token) → 500, no data exposed: with no Supabase configuration the route cannot run and does not pretend to succeed.

**Audit-verified by reading code + suite assertions (not modified):**
- Health route exposes ONLY boolean configuration status.
- Owner bootstrap is fail-closed via `public.app_config.owner_email` (migration 0008): no owner_email → first signup rejected; the old "first signup becomes owner" rule is removed; no default password exists; no owner credentials in source.
- Invitation-only signup is enforced inside the database trigger (atomic claim, expiry + revocation, email binding); `requireUser` chain enforces authenticated → revoked-rejected(403) → resource on every protected API route; migration 0019 carries the revocation audit trail + `revoke_all_sessions`; migrations 0001–0020 are present in the repo.
- Missing AI config returns honest 503 `needsConfig` (never a fake answer); missing Supabase config never yields a misleading "working" state.

**BLOCKED — requires owner/deployment credentials (not tested; no fake claims):**
- Production Supabase connection, production migration status (0001–0020), live security matrices (need `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` / `SUPABASE_TEST_SERVICE_ROLE_KEY` on a disposable test project), the real AI flow end-to-end (needs `OPENAI_API_KEY` + configured Supabase), search-provider live test (needs `SEARCH_API_KEY`), and the all-true `/api/health` state.

**Exact production environment variables still missing (set in Vercel →
Project → Settings → Environment Variables):**
1. `NEXT_PUBLIC_SUPABASE_URL`
2. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. `SUPABASE_SERVICE_ROLE_KEY`
4. `OPENAI_API_KEY`
5. `SOPHIRA_MODEL` (recommended; default `gpt-4o-mini`) and `OPENAI_BASE_URL` (only for a non-OpenAI provider)
6. `SEARCH_PROVIDER` + `SEARCH_API_KEY` — ONLY if web research is being tested (optional; research degrades gracefully)
7. `SOPHIRA_APP_URL` (release gate + native build URL; e.g. `https://sophira.vercel.app`)

**Operator SQL still required on the production database (see
docs/RELEASE_PROCESS.md):** run migrations 0001–0020, then
`insert into public.app_config (key, value) values ('owner_email', to_jsonb('<owner email>')) ...`
BEFORE the first owner signup. No owner password is created by the app.

## 47. Owner setup status diagnostic (2026-10-06) — 1101/1101 offline, build green

**Round intent:** improve the OWNER SETUP EXPERIENCE without touching the
security model (Supabase Auth credentials, `profiles.role='owner'`
authorization, fail-closed `app_config.owner_email` bootstrap, server-side
`requireOwner` — all unchanged).

**What was added:**
- `src/lib/owner-setup.ts` — a server-side probe + pure evaluator, the
  single source of truth for the diagnostic. Probes (service-role,
  server-only): app_config/owner_email **existence** (never the value),
  migration chain markers (0008 app_config, 0019 `profiles.access_revoked_at`,
  0020 `student_memories`), and categorical owner-account status
  (none / active / revoked — never email or id).
- `GET /api/setup-status` — public BY DESIGN (the operator must be able to
  check bootstrap readiness BEFORE any account exists, including the
  owner). Returns booleans/enums + ordered operator guidance only.
- `/setup` page (added to the middleware PUBLIC list) — operator checklist:
  Supabase connection, migrations, owner_email configured, owner account
  initialized/active, AI provider; exact next steps when uninitialized
  (configure owner_email SQL → sign up with that exact email → choose your
  own password in the normal signup flow); a link to the existing
  password-reset flow (/reset-password) for recovery; explicit statement
  that Sophira has NO predefined/default/generated owner password.
- Suite §27 allowlist updated for the new public route; new test section
  machine-checks the diagnostic (50 new assertions: evaluator scenarios
  A-G, secret-leak regression on every scenario, source-level contract —
  existence-only app_config probe, no raw env returns, no password
  literals, middleware PUBLIC, reset-password link, default-password
  denial).
- docs/OWNER_ACCESS.md: new "Owner setup status diagnostic (/setup)"
  section. README: Setup step 2 corrected (stale "through 0012" → the
  actual 0001-0020 chain) and /setup documented.

**Verified:** `npm test` **1101/1101**; `npm run build` passes (both new
routes registered). CI green on the pushed commit (51048ab).

**Live-verified after push (sophira.vercel.app auto-deploy):**
- `GET /api/setup-status` → honest degraded state: `ready: null`,
  all booleans false, `database: "unconfigured"`, `ownerAccount:
  "unknown"`, plus the exact operator guidance (Supabase env vars,
  service-role key, AI key) - no fake ok, no secret material.
- `/setup` renders (HTTP 200) pre-auth.
- **Still BLOCKED** (needs the owner's real Supabase + AI config, same as
  §46): the authenticated-path behavior of the diagnostic against a
  real database - migrations detected, owner_email configured, owner
  account created/active - will only be observable once the owner
  completes the configuration steps it lists.

## 48. Private-beta hardening round 2026-10-06: APK rebuilt on current code; gate 21 PASS / 0 FAIL / 17 BLOCKED / 0 NOT RUN (owner-only blockers)

Context: this round audited the repository state after 24 commits of
owner-access, memory, and release-gate work by other sessions (audited in
place; nothing rebuilt or duplicated). The fresh sandbox had no JDK/Android
SDK, so the full Android toolchain was reinstalled from scratch
(Temurin JDK 21, Android SDK cmdline-tools, platform 36, build-tools 34).

**Android APK (blocker 8 of the private-beta request) — BUILT AND VERIFIED:**
- `npx cap sync android` with `SOPHIRA_APP_URL=https://sophira.vercel.app` →
  `./gradlew assembleDebug`: **BUILD SUCCESSFUL, 147 tasks** (first attempt
  failed honestly on JDK 17: Capacitor camera plugin requires a Java 21
  toolchain; JDK 21 installed and rebuilt — matches §21's requirements).
- Artifact: `android/app/build/outputs/apk/debug/app-debug.apk` (8.1 MB),
  package `com.bridgeline.sophira` v1.0.0, minSdk 24, compile/target 36,
  `apksigner verify` → **SIGNATURE OK** (debug-signed; release signing needs
  the owner's keystore secrets by design).
- `assets/capacitor.config.json` inside the APK verified to load
  **https://sophira.vercel.app** with cleartext and mixed content disabled.
- NOT device-tested: no physical Android device exists in this sandbox —
  install/launch on a real phone remains an owner-side step
  (docs/PWA_TESTING_GUIDE.md / docs/DEVICE_ACCEPTANCE.md).

**Offline suite in the fresh sandbox:** 1101 passed / 0 failed.
**Release gate (full mode, --report):** 38 checks — **21 PASS, 0 FAIL,
17 BLOCKED, 0 NOT RUN.** "APK built if supported" moved NOT RUN → PASS.
Every remaining blocker is owner-side: production env vars (Supabase, AI,
search, SOPHIRA_APP_URL), live security matrices (SUPABASE_TEST_* creds),
physical devices, and legal owner-facts. The live production deployment was
re-verified healthy and honest: /, /setup, /install, /api/health,
/api/setup-status, /manifest.webmanifest all 200/307, with setup-status
correctly reporting the unconfigured state and exact operator guidance.

**Private-beta verdict:** the code is beta-ready; the DEPLOYMENT is not.
No FAIL exists anywhere in the gate — turning the 17 BLOCKED items green
requires only owner configuration (env vars + credentials + one device
session), no further engineering.

## 49. LIVE end-to-end verification of the research pipeline (2026-10-06) — every stage except the search provider verified against the real web

Round goal (research-integrity request): make the existing research system
operational and verify its integrity end-to-end. **No architecture was
replaced** — the audit found the full pipeline already implemented and sound:
assignment → assignment-specific query generation (`research.ts
generateQueries`) → external search (`provider.ts`, Brave/Tavily/custom
abstraction) → deduplication (`dedupeSources`/`normalizeUrl`, tracking-param
strip, per-domain cap) → objective + assignment-aware ranking
(`rankCandidatesForAssignment` over `rankCandidates`) → URL fetching with
manual redirect following (`verify.ts fetchAndVerify`) → HTTP verification,
page-title verification (`titlesCorrespond`), dead-link (404/410),
login/paywall detection (401/402/403/429 + in-text wall patterns), text
extraction with meaningfulness floor → evidence storage
(`research_sources.content_extract` + sha256 `integrity_hash` +
`research_verifications` log) → claim/evidence mapping (`claims.ts`,
migration 0013) → deterministic citation generation (`citation.ts`, from
stored verified fields only). Snippets are used ONLY for ranking heuristics,
never as evidence — claim verification runs against the retrieved extract.

**New capability: `RESEARCH_LIVE=1 npm test`** runs a LIVE section
(`runResearchLiveTests`) exercising the REAL pipeline against the REAL web.
Executed 2026-10-06 — **18/18 LIVE assertions passed** (1117/1117 total;
the default suite remains deterministic at 1101/1101):

- Valid source: en.wikipedia.org/wiki/Coral_bleaching → VERIFIED; real page
  title "Coral bleaching - Wikipedia" extracted (never invented), 41,007
  chars of genuinely retrieved text, sha256 integrity hash recorded,
  page-title correspondence verified.
- Dead link: nonexistent Wikipedia page (real HTTP 404) → FAILED with
  dead-link note, never cited.
- Redirect: en.m.wikipedia.org → 301 followed manually, final URL recorded
  exactly, verified against the FINAL URL.
- Access refused: britannica.com (real HTTP 403) → INACCESSIBLE, honestly
  reported, and ZERO text stored from the refused page.
- Claim-evidence: a claim quoting the REAL retrieved passage → verified; a
  fabricated claim absent from the real content → NOT verified (unsupported).
- Citation: built ONLY from really-fetched fields — contains the real final
  URL and real page title, no invented/placeholder values.

**Still BLOCKED (honest):** the external search-provider stage
(`provider.search`) has no key in this environment, so the live matrix cannot
include a real Brave/Tavily query, and the full `/api/research` route needs
Supabase + a provider key. Offline tests already machine-check provider
honesty (refuses to run without a real key, never fabricates results), and
the verification stages downstream of search are now LIVE-verified.

## 50. Mobile device-testing readiness round (2026-10-06): release APK built+verified; desktop browser verified; device flows remain NOT TESTED (honest)

Pre-build verification of the production deployment (all recorded honestly):
- Production URL: https://sophira.vercel.app — live; `/` 307 → /login; `/login`,
  `/install`, `/api/health`, `/api/setup-status` all HTTP 200.
- Application loads: verified in a REAL desktop Chromium browser (Browserbase):
  title renders, sign-in form, invitation signup link, /install page with
  correct per-device instructions.
- Environment configuration: NOT configured on the deployment (honest
  degraded mode by design) — /api/health reports supabase:false,
  supabase_service_role:false, ai:false, search:false.
- Authentication / Supabase / AI / research connectivity: cannot be
  live-verified until the owner sets the production env vars; the app fails
  closed and says so rather than pretending. These rows stay FAILED/BLOCKED,
  not passed.

**Release APK (the requested artifact) — BUILT AND VERIFIED:**
- `SOPHIRA_APP_URL=https://sophira.vercel.app SOPHIRA_NATIVE_RELEASE=1
  npx cap sync android` + `./gradlew assembleRelease` → **BUILD SUCCESSFUL,
  198 tasks**.
- Artifact: `android/app/build/outputs/apk/release/app-release-unsigned.apk`
  (6.6 MB), package `com.bridgeline.sophira` v1.0.0, minSdk 24,
  **targetSdk 35**, label "Sophira", `assets/capacitor.config.json` verified
  to load https://sophira.vercel.app with cleartext+mixed content disabled.
- Signature: **UNSIGNED — `apksigner verify`: DOES NOT VERIFY** (honest
  fallback; no keystore secrets exist in this environment, and none were
  invented). Not installable until CI signs it with the owner keystore.
- The debug APK from the same code (`app-debug.apk`, 8.1 MB, debug-signed,
  same production URL, signature OK) IS installable for device testing now.

**Android 17-step device flow / iPhone PWA flow: NOT TESTED.** No physical
Android device or iPhone exists in the agent sandbox — recorded as NOT
TESTED in docs/DEVICE_ACCEPTANCE.md, never passed. Server-side PWA artifacts
for the iPhone column verified: manifest (standalone display, 192/512 icons,
start_url /dashboard) and service worker both serve HTTP 200. iOS native
(IPA) remains separate and NOT TESTED (requires Apple Developer cert).

**Desktop: VERIFIED** in a real Chromium desktop browser — app loads,
login renders, install page correct (recorded as a browser verification,
not a native-OS test).

## 51. Private-beta acceptance run (2026-10-06): Phases 2–13 BLOCKED at the auth layer — verdict NO, all blockers owner-side

Executed the 13-phase private-beta acceptance (production probes, real-browser
load check, live connectivity probes, full offline suite, release gate --report).
PHASE 1: deployment exists (PASS, HTTP 307→/login, /api/health 200), application
loads (PASS, real Chromium desktop browser renders the login form, invitation
link, /install). Supabase/AI/search connectivity: **BLOCKED** — the deployment
reports supabase:false, ai:false, search:false; no credentials exist in this
environment. That single gap gates PHASES 2–12 (every flow behind sign-in) and
the live parts of PHASE 13: no owner account can be created, so typing,
academic setup, math, writing, corrections, pacing, scheduling, Student B
isolation, revocation, and invitation security are BLOCKED, not passed.
Supporting (NOT counted as PASS): the deterministic engines behind those
phases are machine-tested in the 1101/1101 offline suite (typing calibration,
paced output, deadline scheduling, math verification, learning/correction/
override priority, invitation conformance, RLS SQL conformance), and the
release gate reports 21 PASS / 0 FAIL / 17 BLOCKED with zero code-side
failures. Verdict: **PRIVATE BETA READY: NO** — blockers are exactly the
owner-side items listed in the gate (production env vars, migrations + owner
email on Supabase, SUPABASE_TEST_* credentials for the live matrices, legal
owner-facts, one device session). No engineering work remains to unblock.

## 52. Legal-infrastructure round (2026-10-06): in-app legal pages added — /terms /privacy /license render the REAL documents; ResultBody infinite-loop bug found+fixed; 1120/1120

STEP 1–2 audit: every placeholder in LICENSE / TERMS_OF_SERVICE.md /
PRIVACY_POLICY.md was inventoried (14 distinct owner-fact placeholders) and
all 14 are catalogued in docs/legal/LEGAL_CONFIGURATION.md sections A–E —
the centralized owner-input system; no values were invented anywhere.
STEP 3: the app previously had NO in-app legal surface (documents existed
only in docs/). Added public routes **/terms**, **/privacy**, **/license**
that read the actual repository files at request time (single source of
truth, force-included for serverless via outputFileTracingIncludes; honest
unavailable-notice when a file is missing rather than fake text), render
them through the existing dependency-free renderer, and show a
`TEMPLATE — PLACEHOLDER NOTICE` banner while placeholders remain. Linked
from the login page; middleware PUBLIC list updated. LICENSE's proprietary
terms (no copying/redistribution/sublicensing, all rights reserved,
confidential source) are unchanged and now user-visible in-app.
**Bug found + fixed:** ResultBody infinite-looped (OOM) on lines starting
with `**bold**` or `-` without a space — the paragraph guard matched a bare
marker so `i` never advanced. Guard now requires whitespace after markers
and the parser guarantees progress. This affected ALL AI output rendering,
not just legal pages. Regression test included.
STEP 4: technical controls re-verified by the suite (auth/invite-only
signup, RLS conformance, revocation, access control, audit) — legal text
alone is never claimed to prevent access; the machine controls are.
STEP 5: scripts/legal-status.mjs + release gate item 15 still BLOCK
production-readiness while placeholders remain (asserted by tests §17c).
Tests: **1120 passed, 0 failed** (new §17c executes the real page components
via react-dom/server). Production build clean; live local serve verified
all three pages public + honest banners + login 200.

## 53. Offline subsystem (2026-10-06): full offline lifecycle — 1193/1193 PASSED including a REAL on-device model run

`npm test` (offline, deterministic): **1193 passed / 0 failed**, including 33 new offline assertions across 6 sections. `RUN_LIVE_MODEL=1 npm test` additionally downloads the real SmolLM2-135M-Instruct ONNX model (~120 MB from the HF CDN) and executes genuine on-device inference through transformers.js/WASM: **passed** (output stamped LOCAL). Full architecture + honest limitations: `docs/OFFLINE_ARCHITECTURE.md`.

| Area | Checks | Result |
|---|---|---|
| Encrypted store: AES-GCM roundtrip, wrong-key fails closed, tombstones, versioning | 10 | ✅ |
| At rest: ciphertext contains no plaintext; different install secret cannot unlock | 2 | ✅ |
| Durable queue: unique ids, total order, queue-time metadata | 4 | ✅ |
| Conflict matrix: apply/drop/conflict decisions; conflict records preserve BOTH sides verbatim | 7 | ✅ |
| Model manager: consent-gated downloads (unconfirmed refused), integrity vs CDN manifest, failure rollback (never fake ready) | 7 | ✅ |
| **17-step lifecycle** (online → sync → disconnect → open/edit → offline AI → correction → learning update → create → reconnect → sync → verify server) | 12 | ✅ |
| Two-device simultaneous edits → explicit conflicts; keep-local/keep-remote resolution; cross-device propagation | 12 | ✅ |
| Failed sync: transient server error keeps the op queued; safe idempotent retry | 4 | ✅ |
| Logout offline: unsynced work destroyed, NEVER uploaded | 3 | ✅ |
| Revocation: queue sealed dead, nothing uploaded, local data purged | 4 | ✅ |
| Memory recall offline: hit + honest miss | 2 | ✅ |
| Live real-model pipeline (RUN_LIVE_MODEL=1): real SmolLM2 inference on-device | 1 | ✅ |

Honest notes:
- The offline AI models are small; answers are shallower than online. Every offline response is provenance-stamped (LOCAL MODEL · repo) in the UI, and online-only features (live research, new document extraction, source cross-checking) are listed explicitly, never faked.
- Model integrity is verified against the HF CDN manifest (sizes + LFS sha256 oids) plus a functional inference check; a full local hash of every blob is a documented non-goal.
- The install-secret localStorage tradeoff (protects at rest, not against compromised same-origin scripts) is documented in `docs/OFFLINE_ARCHITECTURE.md` §security.

## §54 Provider architecture: free-first / zero-billing / secret scan (2026-10-06)

**Changed:** the server AI path was OpenAI-only; it is now a free-first,
fail-closed provider architecture. No AI route can silently spend money.

**Implemented and executed (all assertions below ran in `npm test`, suite 1238/1238):**

- `src/lib/ai/provider.ts` — provider selection (`AI_PROVIDER=auto|gemini|openai|local`,
  default `auto`), zero-billing policy (`ALLOW_PAID_AI=false`,
  `MONTHLY_AI_BUDGET_USD=0` by default → a paid key is reported and IGNORED),
  Gemini free-tier client (key in the `x-goog-api-key` header, never in a URL;
  default model `gemini-2.5-flash`, currently on the free tier), ordered
  fallback on failure, honest `AiProviderUnavailableError`.
- `src/lib/ai/client.ts` — `aiChat` delegates to the provider architecture and
  records best-effort usage rows in `provider_usage` (migration 0021; no
  client access to the table).
- Tests §"provider": 41 assertions — selection matrix, fail-closed
  (zero-billing config performs ZERO network calls, verified with an
  instrumented fetch), request/response conversion (system merge, image
  inlineData, JSON mode, token usage), fallback order (Gemini 429 → paid only
  when explicitly allowed), diagnostics never serialize secret values.
- `scripts/secret-scan.mjs` — client-bundle secret scan
  (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `SEARCH_API_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`) over `.next/static`, `public/`, Capacitor and
  Tauri asset bundles; self-test + positive/negative controls executed in
  the suite. The REAL production build was scanned: CLEAN (3 dirs, 4 names).
  Wired as release-gate check #39.
- `src/app/owner/page.tsx` — owner-only provider diagnostics card (active
  provider, model, cost class, budget, reasons; "Cost unknown" honesty).
- `GET /api/provider-status` — owner-guarded endpoint adding usage counts;
  no secret values in any response.
- Local model registry — `onnx-community/Qwen2.5-1.5B-Instruct` added
  (verified on the HF hub 2026-10-06: q8 ONNX present, not license-gated)
  as the laptop tier with a device recommendation UI. Gemma-family models
  were investigated and are NOT registered: their HF repos are license-gated
  (HTTP 401 without per-user license acceptance). No ungated 3B+ ONNX
  instruct model could be verified, so the desktop tier has no entry rather
  than a fabricated one.
- Release gate — check #3 ("AI provider configured") now requires the
  free-first configuration honestly; new check #39 (secret scan). Gate
  registry updated to 39 checks (doc + script + suite cross-verified).

**Not tested live (blocked, honest):** a real Gemini call (no `GEMINI_API_KEY`
in this environment) and a real paid call. These surface as gate check #3
BLOCKED until the owner configures a key — never faked as PASS.

**Gate after this round:** re-run pending commit (this section records the
offline suite; the gate itself runs `npm test`, `build`, `tsc`, and the
secret scan). Suite **1238/1238**, build PASS, typecheck PASS, real client
bundle secret scan CLEAN.

## §55 Capability registry, paid-model fail-closed, startup diagnostics (2026-10-06)

**Changed:** the zero-billing policy now gates MODELS, not just providers, and
the owner UI shows everything before activation. Suite 1325/1325.

**Implemented and executed:**

- `src/lib/ai/capabilities.ts` — provider capability registry with all ten
  required fields per row (provider, model, online_required, free_tier,
  paid_capable, billing_required, multimodal, max_context, research_tools,
  local); "No Unexpected Charges" setting state; `startupDiagnostics()`
  returning ONLY the five allowed fields.
- Model-level fail-closed (server-side, in `resolveProviders`): with paid AI
  off, a `GEMINI_MODEL` not on `VERIFIED_FREE_TIER_GEMINI_MODELS` is
  REJECTED before any network call. Unknown models fail closed; explicit
  `ALLOW_PAID_AI=true` permits owner-chosen models. This guards against
  assuming a "free" API stays free: removing a model from the verified list
  blocks it immediately.
- Honest 404 handling: if Google removes the configured model, the error
  tells the owner to update `GEMINI_MODEL` — never a fake answer.
- `GET /api/provider-diagnostics` — startup diagnostic endpoint
  (owner-guarded): exactly the five fields, no keys, tested.
- `/owner` — "No Unexpected Charges" security setting card (state from
  server env, display-only in the browser) + capability registry table
  shown BEFORE activation.
- New tests (all executed, suite 1325/1325):
  - paid provider rejected (provider level) — §"provider" selection matrix
  - paid MODEL rejected — unverified `gemini-2.5-pro` style model rejected
    under zero-billing; permitted only with explicit paid opt-in
  - missing Gemini key handled gracefully — honest error, zero network
    calls, points to the free path and LOCAL/offline fallback
  - offline (`AI_PROVIDER=local`) NEVER contacts remote AI — instrumented
    fetch, zero calls even with keys configured
  - local fallback — degraded server response points to Offline mode
  - API secrets never reach client code — source scan: no client-side
    file references any secret name; production bundle scan CLEAN
  - no secret in localStorage/IndexedDB — every source file with actual
    storage API calls (localStorage./sessionStorage./indexedDB./openDB()/
    navigator.storage.) contains no secret name
  - no secret returned from API endpoints — startup diagnostics and
    provider-status payloads tested with planted key values
  - startup diagnostics return exactly the five allowed fields

**Not live-verified (honest):** a real Gemini call (no `GEMINI_API_KEY` in
this environment) and the owner-side blockers — unchanged in the gate.

## §56 Tiered offline models + network-denial routing (2026-10-06)

**Changed:** the offline model registry grew from 3 small models to a 6-model,
3-tier system, every entry hub-verified on 2026-10-06 with immutable
revision pins. Suite 1396/1396.

**Implemented and executed (all assertions ran in `npm test`):**

- `src/lib/offline/model-registry.ts` v2 — TIER 1 (SmolLM2 135M + 360M,
  Qwen2.5 0.5B), TIER 2 (Qwen2.5 1.5B + Qwen3 1.7B), TIER 3 (Qwen3 4B
  Instruct 2507, q4 sharded). All apache-2.0, all ungated, all pinned to
  40-char commit SHAs (never "main"/"latest" — machine-checked). Each entry
  records version, revision, license, params, quantization, download size
  (summed from the real file manifest), RAM recommendation, context size,
  platforms, runtime, capabilities, limitations.
- `src/lib/offline/device-capabilities.ts` — navigator.gpu/WebGPU,
  hardwareConcurrency, deviceMemory (8 GB cap honestly noted), storage
  estimate, platform, CPU architecture -> LOW/MEDIUM/HIGH resource class ->
  recommendation with policy text; user override always available in the
  picker (tested).
- `src/lib/offline/model-manager.ts` — a model is READY only after:
  manifest verified -> sizes verified -> hash capability recorded (LFS sha256
  via WebCrypto when available) -> model loads -> REAL local inference probe
  succeeds. Probe failure after download = FAILED, never a fake ready
  (tested). Disclosure now includes license, quantization, context,
  limitations, estimated performance before any download.
- `src/lib/ai/offline-guard.ts` — offline routing: while offline (or while
  the user's offline mode is on), the client REFUSES fetch()/Gemini/OpenAI/
  remote search/remote source verification before touching the network
  (OfflineAiBlockedError). All 5 client AI call sites now go through it.
  Leaving offline mode is explicit. Tests prove ZERO instrumented fetch
  attempts under the offline decision and that the local engine still
  generates with fetch hard-blocked.
- Gemma family: ungated ONNX builds verified on the hub but NOT registered —
  Gemma Terms of Use is an owner decision (documented in
  docs/OFFLINE_MODELS.md, not silently included).
- Native AI Edge / MediaPipe investigation documented (Android/iOS-only
  runtime; needs a Capacitor plugin round). transformers.js WASM stays the
  PWA/desktop fallback; nothing existing was removed.
- Offline page UI: device capability panel (LOW/MEDIUM/HIGH + detected
  signals + honest unknowns), tier labels, limitations shown per model,
  LOCAL vs REMOTE quality disclosure, offline-mode toggle.

**Live verification addendum (same day, real machine):** the suite was run
with `RUN_LIVE_MODEL=1` — the REAL transformers.js pipeline downloaded and
loaded SmolLM2-135M through its immutable SHA pin and produced real
on-device output stamped LOCAL (1397/1397). A one-off probe then did the
same for SmolLM2-360M-Instruct-ONNX via the q4 dtype path — real download
(~395 MB), real inference, LOCAL provenance, ~1.0 s latency. This proves the
registry's runtime path end-to-end for both int8 and q4 quantization
(q4 is what the tier-2/tier-3 models use).

**Still not live-verified (honest):** actual on-device runs of the heavier
entries (Qwen3 1.7B ~2.2 GB, Qwen3 4B ~4 GB — too heavy for this test
machine; the same verified path applies), browser-side (WebGPU/WASM)
execution, and native MediaPipe integration (documented as the next
engineering round). The registry itself was verified against the live HF hub
on 2026-10-06.

## §57 Notebook workspace: source-grounded academic notebook (2026-10-06)

**Requirement:** a first-class source-grounded Notebook workspace, building
on (never replacing) the existing research engine, tables, citation,
claim/evidence, and source-authority systems. Suite 1544/1544, build PASS,
client-bundle secret scan CLEAN.

**Implemented and executed (all assertions ran in `npm test`):**

- Migration 0022: 6 tables (notebooks, notebook_sources, notebook_notes,
  notebook_questions, notebook_evidence, notebook_artifacts). STRICT
  owner-only RLS — every policy is user_id = auth.uid(), and there is NO
  admin read policy: every other user, admin included, is blocked from
  source content (machine-checked; the migration documents it).
- Every supported source type (PDF, DOCX, TXT, web URL, image, teacher
  instructions, assignment instructions, user notes, research source)
  stores the required fields incl. sha256 content hash, page metadata
  (PDF) and section/paragraph metadata (DOCX).
- Grounded chat: answers grounded ONLY in included sources (pinned first)
  unless the user EXPLICITLY enables web research per question. Every
  statement is labeled SOURCE-SUPPORTED (verbatim passage located, offsets
  + locator recorded), INFERENCE (anchor cited), or NOT VERIFIED. A
  claimed quote that cannot be located is DOWNGRADED and disclosed —
  never faked. Excluded sources are never cited. Tests prove the web
  opt-in gate both ways.
- Inline citations open the exact location: page for PDFs, URL + retrieved
  timestamp for web, section/¶ for DOCX (tested all three).
- Source controls: include / exclude / pin / verify / remove, plus
  "Why this source?" showing authority, relevance, date, source type,
  why selected, and the assignment requirement satisfied.
- "Research this topic": all 10 steps on the EXISTING engine (generateQueries,
  dedupeSources, rankCandidatesForAssignment, fetchAndVerify). Dead URLs
  rejected; snippets never stored as content; a candidate can become a
  source ONLY through the user approval gate AND the conversion gate
  (refuses unretrieved/snippet-only candidates). With all URLs dead,
  zero candidates — nothing invented.
- Artifacts: all 9 types generated deterministically with retained
  provenance; empty notebooks produce an honest unsourced skeleton, not
  fabricated content; bibliography reuses the deterministic formatter.
- UI: /notebooks list + 7-tab workspace (Sources, Notes, Questions,
  Evidence, Research, Study Materials, Artifacts) with labels, clickable
  citations, controls, candidate approval; nav entry added.

**Not live-verified (honest):** browser click-through of the workspace and
real multi-user RLS enforcement against a live Postgres (the SQL is
machine-audited for the policy set, and the API routes read strictly as
the authenticated owner — never with the service role); OCR of uploaded
images (an upstream capability; images without OCR are stored honestly
and cannot be cited).

## §58 Citation hardening: NO VERIFIED CITATION WITHOUT VERIFIED SOURCE (2026-10-06)

**Requirement:** make fabricated, dead, wrong, or mismatched citations
structurally difficult to produce; preserve the six existing research modules
(all preserved — the new engine composes them). Suite 1628/1628, build PASS.

**Implemented and executed:**

- `src/lib/research/citation-invariant.ts` — the 12-step invariant engine.
  A citation is VERIFIED only when ALL 12 steps pass from STORED records:
  (1) search result exists, (2) URL syntactically valid, (3) URL actually
  requested, (4) redirect chain followed, (5) final URL recorded, (6) HTTP
  success, (7) content extracted, (8) title extracted, (9) supporting passage
  exists, (10) claim overlaps the passage, (11) authority requirements met,
  (12) citation generated from stored metadata. Any failure → UNVERIFIED
  with a per-step explanation; the failed source is NEVER replaced by a guess.
- Re-verification engine: `refetchSource`/`verifyAllSourcesAgain` re-fetch
  with the REAL fetchAndVerify; unreachable → UNAVAILABLE (claims demoted),
  content hash changed → STALE (claims demoted), unchanged → VERIFIED.
- FINAL GATE integration: `citation_invariant` is a HARD requirement in
  evaluateFinalGate — missing run fails closed; any UNVERIFIED/UNAVAILABLE/
  STALE citation blocks submission. The readiness route computes the summary
  from stored claim/source records.
- API: POST /api/research/verify-again — "Verify all sources again" before
  final submission; demotes claims of vanished/changed sources; recomputes
  the stored integrity summary; returns honest completion line.
- UI: VERIFIED / UNVERIFIED / UNAVAILABLE / STALE badges with per-source
  explanations; "Verify all sources again" action; the blanket "Research
  complete" claim is REPLACED with an honest line that reads
  "RESEARCH INCOMPLETE: …" whenever any citation is unverified, unavailable,
  or stale (machine-checked).

**Adversarial battery (tests/adversarial-citations.ts, all executed):**
nonexistent URL → UNAVAILABLE; typo URL never verifies; redirect → STALE;
redirect-to-unrelated-site never verifies; misleading title → UNVERIFIED;
no relevant passage → step 9/10 fail; source deleted after research →
UNAVAILABLE + claim demotion; paywalled → UNVERIFIED; JS-only → UNVERIFIED;
source changed after retrieval → STALE; duplicate URL → consistent verdicts
(dedupe upstream); tracking-URL duplicates judged only on their own honest
records; AI-generated fake URL → UNVERIFIED at step 1 and called out as a
possible invention; hallucinated DOI → UNVERIFIED; hallucinated journal
article → UNVERIFIED; wrong publication date / wrong author → never trusted
without a retrieval record; unsupported quotation → UNVERIFIED (existing
locatePassage refuses absent quotes). Each of steps 1-12 fails the whole
citation when failed in isolation. Every case fails safely.

**Not live-verified (honest):** the verify-again route against a live
database (the engine under it, fetchAndVerify, is the same code exercised
live by the existing research tests); browser click-through of the badges.

## §59 Scan Problem: image-to-solution math pipeline (2026-10-06)

**Requirement:** upgrade the mathematics workflow into an image-to-solution
pipeline with a 13-step flow, step 7 (showing the recognized expression)
never skipped, separate tracking of recognized input / solution /
explanation / verification, deterministic solving across 12+ domains, and
the LLM never the mathematical authority. Suite 1714/1714, build PASS.

**Implemented and executed:**

- Preprocessing (pure, unit-tested, no DOM): grayscale, Otsu ink mask,
  crop-to-ink bounding box, rotation, projection-profile deskew
  (±9° search), expression detection with honest refusals for blank or
  over-dense images.
- OCR: the vision model transcribes ONLY (prompt forbids solving or
  correcting); normalization (x²→x^2, √→sqrt(), ÷→/, ×→*, vulgar
  fractions, integral markers, systems split) is deterministic and
  unit-tested; comma decimals never corrupt matrix lists.
- Step 7 is structurally unskippable: every pipeline result carries the
  recognized expression, and the UI renders it before anything else; the
  confirmation gate blocks solving until the user confirms/corrects
  (low confidence is explicitly flagged and disclosed).
- Deterministic solver (mathjs + hand formulas): fractions, exponents,
  square roots, linear equations (2x+5=17 → 2x=12 → x=6 shown as steps),
  quadratics incl. negative discriminants, systems (LU solve), derivatives,
  elementary integrals (∫3x²dx=x³+C, ∫1/x=log|x|), non-elementary cases
  REFUSED honestly, matrices (det/inv/product), statistics, geometry,
  word problems (sum/difference template; anything unmapped is refused —
  never guessed).
- Independent verification: numeric substitution of roots (different
  mechanism than the solver's algebra), numeric differentiation for
  derivatives, sample-point equivalence for symbolic answers, system
  substitution, plus the existing machine-check engine. The LLM never
  verifies and never solves.
- NEEDS REVIEW: unsupported or unverifiable results are marked NEEDS
  REVIEW and displayed with the reason — never hidden, never replaced by
  a guess (machine-checked for the unmapped word problem, the
  non-elementary integral, and the degenerate equation).
- Teacher-specific method step: applies the stored method-compliance
  profile and reports missing constraints honestly.
- UI `/math`: Scan Problem (camera capture), crop/rotate/deskew preview,
  recognized-input card, confirm/correct box, solution steps, AI
  explanation with honest authority note, verification card with per-check
  details. API `POST /api/math/solve`.

**The user-flow example is a test:** photo "2x + 5 = 17" → recognized
"2x + 5 = 17" → user confirms → steps "2x = 12", "x = 6" → independently
verified OK.

**Not live-verified (honest):** the vision-OCR call against a configured
provider (tests inject a deterministic OCR engine; the route requires AI
configuration and refuses honestly otherwise), and browser click-through
of the camera capture.

## §60 Essay workflow hardening: staged pipeline, paced presentation, deadline honesty (2026-10-06)

**Requirement:** never generate an entire essay as one opaque response when
paced writing is requested; fixed 13-stage workflow; compact assignment
plan + sources/evidence before drafting; outline approval; the existing
typing calibration; output modes Instant/Calibrated/Slow/Custom; local
timer with pause/resume and progress restore; deadline scheduling with
breaks as a scheduling preference (10s..6h), no intentional time-wasting,
impossible deadlines told immediately. Suite 1807/1807, build PASS.

**Implemented and executed:**

- `src/lib/essay/pipeline.ts` — the 13 stages as an ordered, tested
  machine: ASSIGNMENT ANALYSIS → RUBRIC → TEACHER REQUIREMENTS →
  RESEARCH → EVIDENCE MAP → THESIS → OUTLINE → SECTION DRAFTS →
  CITATION AUDIT → RUBRIC AUDIT → STYLE AUDIT → FINAL VERIFICATION →
  PACED PRESENTATION. `canDraft` refuses drafting structurally until the
  outline is approved; `nextSectionToDraft` enforces ONE section per
  call; assembly exists only in presentation.
- `src/lib/essay/pacing.ts` — output modes on the EXISTING calibration:
  Calibrated = the user's selected WPM (manual preferred pace → adaptive
  recommendation when auto-adjust → baseline; NO calibration → NO
  invented speed, instant fallback with a disclosed reason); Slow =
  half; Custom = user WPM; Instant = no pacing. Reveal state
  serialize/restore for close/reopen (ACTIVE time only — paused time
  never counts; completed sections never re-reveal).
- The reveal is a LOCAL timer on the client over already-generated,
  already-audited text — no network request per character, no database
  row per character (the draft route writes the session exactly once per
  section; verified by test). Pause/resume works; closing and reopening
  restores progress (localStorage keyed per session+section, restored
  via the pure engine — tested).
- `src/lib/essay/schedule.ts` + scheduler upgrade — the EXISTING
  deadline scheduler decides when sections are generated/displayed.
  Breaks are a scheduling preference: honored when the deadline allows,
  REDUCED to fit when tight (never the reverse), hard-clamped to
  [10s, 6h]. No intentional time-wasting: generation is back-to-back,
  the only waits are the bounded breaks + the local reveal. Impossible
  deadlines are reported IMMEDIATELY with numbers, and the verdict
  states a delayed schedule NEVER guarantees completion.
- API: POST /api/essay/plan (analysis → … → outline; compact plan;
  impossible-deadline verdict persisted honestly), POST/PATCH
  /api/essay/draft-section (outline gate; one section + per-section
  citation/rubric/style audits; final verification once at the end).
  Migration 0023: essay_sessions (per-user RLS; outline_approved NOT
  NULL default false; break preference constrained to [10s, 6h];
  output_mode persisted).
- UI `/essay`: compact plan card, outline approval/edit, one-section-
  at-a-time drafting, per-section paced reveal with mode/WPM/pause/
  resume/progress bar, restore banner, honest local-timer note.

**Not live-verified (honest):** AI plan/draft generation against a
configured provider (tests exercise the pure engines + route structure;
routes refuse honestly when AI is unconfigured), and browser
click-through of the reveal.

## §61 HOSTILE SECURITY AUDIT (2026-10-06): fail-closed guards, ownership fixes, injection defense, attack-surface removal

**Attacker model tested:** another user, a revoked user, an invited-but-
not-approved user, an unauthenticated visitor, a malicious browser
client, request/user/assignment ID tampering, RLS-bypass attempts,
bundle/localStorage/service-worker inspection, stale tokens, and prompt
injection through uploaded docs, teacher docs, research sources, and
web pages. Authorization order verified per protected route:
authentication → active-access → role → resource ownership → operation.
Suite 1892/1892, strict tsc clean, production build PASS, bundle +
public + service-worker secret scan clean.

**Real vulnerabilities found and FIXED (each with a regression test):**

1. **The active-access check was a deny-list** (guard + middleware rejected
   only `status === "revoked"`): any typo'd or future status would fail
   OPEN. Now an explicit allow-list {pending, accepted, active} in both
   the API guard and the middleware — revoked and every unknown status
   fail CLOSED.
2. **The owner's "restore member" action was silently broken**: it wrote
   `status = 'active'`, which the profiles check constraint
   (pending/accepted/revoked) rejects at the DB — un-revoking a member has
   been failing invisibly. Migration 0024 fixes the constraint.
3. **The essay plan queried a nonexistent `teacher_source_docs` table**
   (teacher requirements silently vanished from every essay plan) — and
   the same class of bug in rubric-audit (selecting rubrics columns that
   live on teacher_profiles, not teachers). Both now read the real
   tables (teachers + teacher_profiles).
4. **ID-tampering defense-in-depth**: id-parameterized reads on
   readiness, rubric-audit, solve, and the essay plan relied on RLS
   alone; every one now asserts `.eq("user_id", ...)` ownership
   explicitly. (The LIVE RLS matrix — tests/security/rls-regression.mjs —
   already proved cross-user reads return nothing for all 10 data
   categories; this closes the order-of-authorization gap at the route.)
5. **Prompt injection through teacher documents and research sources**:
   essay routes now wrap every external document with the untrusted-
   content wrapper + injection detector (uploaded files, research web
   pages, and solve already had it — §21/§32); injection attempts are
   excluded and disclosed honestly, never obeyed.
6. **Next.js Image Optimizer attack surface removed** (critical DoS
   advisory for self-hosted builds): the app uses no next/image and no
   remote hosts, so the endpoint is disabled outright
   (`images.unoptimized: true`).

**Dependency audit:** transitive build-time chain (braces, micromatch,
fast-glob, chokidar via tailwind) pinned to their latest patched lines
via package.json overrides; tailwindcss upgraded to 3.4.19 (postcss
resolves to 8.5.29, above all advisory ranges). Residual npm-audit flags
are build-toolchain only (braces has NO fixed release: advisory range
<=3.0.3 with fix=None) — none reachable at runtime; the test battery
asserts runtime code never imports them. The Next.js critical advisory
is configuration-mitigated (optimizer disabled); the full fix is a
semver-major upgrade to Next 15.5.10+/16, deliberately not risked in
this audit round. mammoth (moderate, transitive sprintf-js DoS) is
queued for review. **Honest statement: these two residuals are
documented, not silently closed.**

**Verified already-correct (no change needed):** invitation-only signup
enforced by a DB trigger (no invitation → no account, atomically claimed,
single-use, expiry-checked, 192-bit unguessable tokens, owner-only
issuing/approval); revocation blocks access instantly regardless of
token validity (status allow-list) AND kills refresh tokens server-side;
account deletion cascades auth.users → all data (requireUser rejects the
missing profile); stale tokens are rejected by the per-request profile
check; owner endpoints require the owner role after auth + active-access.

## §62 PRIVATE TESTING CHANNEL (2026-10-06): /downloads + /install hardened, TESTING_TONIGHT.md, release pipeline live

**Goal:** test tonight without any app-store listing, via PWA → Android
APK → desktop installers, with /install and /downloads fully functional.

**Honest artifact policy implemented on /downloads:** the page lists ONLY
assets the current GitHub release actually contains (fetched live from the
public API — the repo is public, so the fetch works unauthenticated). No
release / no artifact → the page says so; NO download button exists for an
artifact that does not exist. Added: **TEST BUILD** label (native artifacts
may not be production-signed), **SIGNED APK / UNSIGNED APK** badges named
per the user's exact labels, honest installation requirements for an
unsigned APK (adb install or apksigner — Android refuses a tapped
unsigned APK), per-artifact SHA-256 (from the release checksum file, with
a graceful link to the checksum file itself), version + date per
artifact, and an iOS honesty block: no .ipa in a release → the page
NEVER implies an unsigned build installs normally; it states the PWA-now
/ development-ad-hoc / TestFlight paths.

**Local gate (this machine):** npm ci clean (302 packages); npm test
1892/1892; npm run build PASS; npx tsc --noEmit -p tsconfig.json clean.

**Native builds, honestly:** this sandbox has NO Java/Android SDK and NO
Rust/Tauri toolchain — android:build cannot run here (attempted: fails
on the missing toolchain; documented, not faked) and desktop:build
correctly FAILS CLOSED because SOPHIRA_APP_URL is not defined for a
release build (native-url.mjs refuses — by design, no silent placeholder
fallback). The supported path ran instead: the **Release workflow was
dispatched via the GitHub API (HTTP 204) and executed on Actions runners
with the full toolchains** — it builds the Android APK (unsigned and
named Sophira-release-unsigned.apk when the ANDROID_* signing secrets
are absent), an honest unsigned iOS .xcarchive (never called an .ipa),
desktop installers where the runner supports them, and SHA-256 checksum
files for every published artifact. Run id 37489113950.

**LIVE PWA validation performed (real browser + HTTP, this session):**
https://sophira.vercel.app is live — /downloads renders the honest
"no native release published yet" state (verified in-browser);
/manifest.webmanifest → HTTP 200, application/manifest+json, name
"Sophira — Your private academic AI assistant", display: standalone,
3 icons; /sw.js → HTTP 200 (application/javascript); /install →
HTTP 200; /login → HTTP 200; / → HTTP 307 redirect as designed.

**NOT performed (stated, not faked):** creating an owner/test-user
account, invitation flow, typing calibration, local-model download,
offline mode, math/research/essay/rubric runs, revocation and
reinstatement — all of these require live user accounts and are written
as the 14 exact steps in **TESTING_TONIGHT.md** for execution tonight.
APK identity/signature validation also awaits the workflow's artifacts;
it has NOT been claimed. When the release publishes, /downloads will
display the real artifacts automatically (the page requires no redeploy
for asset discovery — only the TEST BUILD/SIGNED/UNSIGNED/iOS-honesty
UI needs the Vercel deploy from this push).

