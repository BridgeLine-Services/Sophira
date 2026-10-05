# Sophira — Test Report

Date: 2026-09-26 (membership & learning upgrade) · Next 14.2.35, strict TypeScript · `npm test` + `npm run build`

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
