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
