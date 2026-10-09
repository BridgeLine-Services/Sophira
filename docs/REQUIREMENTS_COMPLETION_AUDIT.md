# Sophira — Requirements Completion Audit

**Audit date:** 2026-10-09 · **Baseline audited:** commit `7c7295c` (universal mathematics
engine) plus this session's data-export slice · **Branch:** `master`

This is the master traceability document required by the original Sophira mission. Every
requirement area from the original vision carries an explicit status with its real
implementation paths, tests, and honest limits. Statuses:

- **VERIFIED_COMPLETE** — implemented and verified by executed evidence (tests/build/gate PASS)
- **IMPLEMENTED_NOT_FULLY_VERIFIED** — implemented and unit/integration tested offline; the remaining verification requires live credentials or a physical device
- **BLOCKED_BY_EXTERNAL_CONFIGURATION** — code is complete and honest; an owner-side prerequisite (credentials, legal facts, hardware) is the only obstacle
- **PARTIALLY_IMPLEMENTED** / **MISSING** — real code gap (none remain as of this audit)

**Authoritative validation battery (executed 2026-10-09, all green):**
`npm test` → **2764/2764 assertions** · `npx tsc --noEmit` → clean · `npm run build` → clean ·
`npm run scan:secrets` → CLEAN · `release-gate --self-test` → 39/39 checks registered.

---

## 1. Mathematics engine (protected subsystem)

**Status: VERIFIED_COMPLETE**

- **Implementation:** `src/lib/math/registry.ts`, `orchestrator.ts`, `pipeline.ts`,
  `solve.ts`, `normalize.ts`, `image.ts` · `POST /api/math/solve` · `/math` UI ·
  docs: `MATHEMATICS_ENGINE.md`, `MATHEMATICS_COVERAGE.md`, `MATHEMATICS_EVALUATION.md`, `MATH_SCAN.md`.
- **Verification:** math pipeline / registry / integral test modules run in every
  `npm test` (2764 total); deterministic vs numerical vs AI-assessed distinctions are
  asserted, not just documented. Production build includes the engine routes.
- **Honest limits:** external proof assistants and scientific-computing engines remain
  explicitly unavailable — no such integration is claimed. AI-derived reasoning is never
  labeled formal proof (asserted by the math test modules).
- **Live evidence:** first testing release (`docs/FIRST_TESTING_RELEASE_REPORT.md`, 2026-10-09)
  documents a verified live integration-by-parts solve against https://sophira.vercel.app.

## 2. Private, invite-only, multi-user foundation

**Status: VERIFIED_COMPLETE (offline-conformance) + BLOCKED_BY_EXTERNAL_CONFIGURATION (live matrices)**

- **Implementation:** invitation lifecycle (`src/app/api/invitations`, `invitation-requests`,
  DB trigger + RLS), single-owner bootstrap (`0025`, `0026`, self-healing provisioning,
  `/setup` + `/api/setup-status` + `/api/setup-repair`), revoked-user guard
  (`src/lib/supabase/guard.ts`), account deletion (`/api/account/delete`, cascades everything).
- **Verification:** on EVERY `npm test`: RLS-conformance (all 28 migrations' tables
  RLS-enabled, policies `auth.uid()`-scoped, no permissive policies, `network_stats`
  aggregate-only) and the 18-item invitation conformance matrix, all tamper-verified
  (weakening any of them fails the suite). The full live privacy/invitation/RLS matrices
  (`tests/security/*.mjs`) run against a real database when `SUPABASE_TEST_*` is set.
- **Blocked:** live matrices require `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY` /
  `SUPABASE_TEST_SERVICE_ROLE_KEY` (owner must supply them) — release-gate check 18.

## 3. Data export (user control over personal data) — NEW this session

**Status: VERIFIED_COMPLETE**

- **Implementation:** `GET /api/account/export` (this session) — every user-owned table
  (36 tables across migrations 0001–0028) returned as a self-describing JSON download
  via the RLS-scoped client; per-table row cap reported as `truncated` (never silently
  incomplete); read failures reported as error entries; `no-store` on the response.
  Settings → "Download my data (JSON)" button. Uploaded file binaries stay in private
  storage (records exported, bytes not — documented in the route).
- **Verification:** 57 new conformance assertions (`tests/account-export.ts`) run in every
  `npm test`: authorization chain, RLS-only reads (no admin client), complete table
  coverage cross-checked against the actual migrations, honest truncation, UI wiring.

## 4. Personalized academic workflow

**Status: VERIFIED_COMPLETE (core chain) — per-stage evidence in `docs/FEATURE_STATUS.md`**

- **Course/teacher intelligence:** structured teacher rules, extraction with warnings,
  AI-proposed rules require explicit approval, conflicts surfaced, teacher precedence
  over generic preferences, applied-rules visibility (`FEATURE_STATUS.md` rows; suite
  sections on teacher precedence + correction learning).
- **Assignment workspace:** full lifecycle (create → attach → analyze → generate → review
  → revise → version → readiness → resume) with assignment-scoped context; version history
  and resumability asserted in the essay-pipeline tests.
- **Learning/tutoring:** mistake recording with evidence, observed-vs-confirmed distinction,
  approval before consequential rules, stale-pattern decay (180 days, self-healing),
  subject/teacher scoping, explain-why-applied, user review/deactivate/delete, memory
  management UI + student-memory isolation (0020, suite §28 memory tests).
- **Writing profile/workspace:** sample-derived profiles, explicit approval, teacher
  overrides, AI-vs-original distinction, versioning, disable/reset; typing calibration and
  paced output remain legitimate accessibility features — no timestamp or keystroke
  falsification exists (asserted by the typing-profile and pacing suites).
- **Rubric + final readiness gate:** deterministic machine checks, AI judgments labeled as
  AI assessments, unsupported claims block, every blocker explained with a resolution path,
  re-evaluation after revision, and the machine-enforced final gate
  (`src/lib/readiness/finalGate.ts`, migration 0015) that can never display a ready state
  while a hard check fails.

## 5. Research, notebooks, source-grounded answers

**Status: VERIFIED_COMPLETE (pipeline) + BLOCKED_BY_EXTERNAL_CONFIGURATION (search provider)**

- **Implementation:** `/api/research` + `ResearchPanel`, per-URL fetch/verification
  (redirects, dead links, paywalls, thin content), claim→evidence traceability with
  verbatim-passage verification (0013), assignment-aware source authority with teacher
  override (0014), citation audit with live re-verification, notebooks with grounded chat
  and provenance-preserving artifacts.
- **Verification:** offline suite covers the full chain; `RESEARCH_LIVE=1 npm test`
  live-verifies fetch/redirect/dead-link/access-refusal/extraction/claim-evidence/citation
  stages against the real web.
- **Blocked:** the search-provider stage requires a live `SEARCH_API_KEY` (Brave/Tavily)
  — owner-side; without it the UI reports honestly and fabricates nothing.

## 6. Documents, uploads, mathematical scanning

**Status: VERIFIED_COMPLETE**

- **Implementation:** `src/lib/extract/documents.ts`, the scan pipeline and its refusal
  behavior for unsupported mathematics (`MATH_SCAN.md`), bounded parsing, owner-isolated
  private storage. OCR output distinguished from confirmed text; ambiguous image
  transcription requires user confirmation; original image preserved with the recognized
  expression. Adversarial document/prompt-injection tests (`tests/adversarial-citations.ts`,
  `tests/hostile-audit.ts`, security suites).

## 7. AI providers and offline reliability

**Status: VERIFIED_COMPLETE (self-hosted core) — optional cloud providers BLOCKED_BY_EXTERNAL_CONFIGURATION**

- **Implementation:** one authoritative provider layer with documented priority and budget
  rules (`docs/SELF_HOSTED_AI_ARCHITECTURE.md`, `docs/OFFLINE_ARCHITECTURE.md`,
  `docs/OFFLINE_MODELS.md`), provider-status/diagnostics endpoints that carry no secrets
  (asserted), crash-guard and provider tests in every run. Paid providers cannot run
  unless explicitly enabled; missing keys produce actionable errors, never fabricated
  responses. The UI labels response provenance (deterministic computation vs local model
  vs remote model vs external research).

## 8. UX, accessibility, PWA, installation

**Status: IMPLEMENTED_NOT_FULLY_VERIFIED (live/device parts)**

- **Implementation:** persistent desktop sidebar rail + responsive redesign (2026-10-09
  round), loading/empty/error/retry states throughout, honest offline capability overview,
  PWA (`/install`, `docs/PWA_TESTING_GUIDE.md`), native projects (`docs/NATIVE_BUILDS.md`).
- **Verified:** offline conformance suites; deployed smoke test (HTTP 200) recorded in the
  first testing release report.
- **Blocked:** physical-device PWA install (Android/iPhone), APK build + on-device test,
  and native URL configuration require `SOPHIRA_APP_URL` and real hardware — release-gate
  checks 11–15. Not marked device-verified anywhere.

## 9. Data management and operational reliability

**Status: VERIFIED_COMPLETE (code) + BLOCKED_BY_EXTERNAL_CONFIGURATION (production application)**

- **Implementation:** migrations 0001–0028 (28 files, forward-only, cascade-preserving;
  the 0019/0028 repair chain documented in-file), health endpoint with real dependency
  status, doctor + env-manifest + prod-env-policy suites in every `npm test`, structured
  actionable API errors, crash guard.
- **Blocked:** applying 0001–0028 to the production database and setting the production
  environment variables (SOPHIRA_APP_URL, SUPABASE_URL, SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY, SEARCH_API_KEY) are owner-side — release-gate checks 17 and
  the migration probe (0028 `network_stats` function, POST RPC probe).

## 10. Legal

**Status: BLOCKED_BY_EXTERNAL_CONFIGURATION**

- **Implementation:** four legal documents with a machine-checked placeholder inventory
  and publication gate (`docs/legal/LEGAL_CONFIGURATION.md`); ToS §18 cautious enforcement
  language; LEGAL_REVIEW_NOTICE preserved (templates, not legal advice, attorney review
  recommended). No legal values invented.
- **Blocked:** 28 owner-supplied facts (entity name, jurisdiction, dates, contact, etc.)
  plus attorney review before production — release-gate check 16.

## 11. Release gate

**Status: VERIFIED_COMPLETE (mechanism) — current verdict BLOCKED (owner-side prerequisites)**

`node scripts/release-gate.mjs --report` (2026-10-09, this audit): **39 checks —
21 PASS · 0 FAIL · 17 BLOCKED · 1 NOT RUN → RELEASE STATUS: BLOCKED.** Every blocker is
owner-side (production env vars, live test credentials, legal facts, physical devices).
Zero code-side failures. Report persisted at `docs/RELEASE_GATE_REPORT.txt`.

---

## Remaining work (all owner-side; no code blockers)

| # | Item | Needed from the owner |
| --- | --- | --- |
| 1 | Production env vars | Set SOPHIRA_APP_URL, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SEARCH_API_KEY in Vercel + CI |
| 2 | Live security matrices | SUPABASE_TEST_URL / ANON / SERVICE_ROLE secrets |
| 3 | Production migrations | Apply 0001–0028 to the production database |
| 4 | Legal facts | 28 fields in `docs/legal/LEGAL_CONFIGURATION.md` + attorney review |
| 5 | Device verification | Android/iPhone PWA install, APK build + test, set SOPHIRA_APP_URL |

**Counts:** VERIFIED_COMPLETE 7 areas · IMPLEMENTED_NOT_FULLY_VERIFIED 1 (device/live UX) ·
BLOCKED_BY_EXTERNAL_CONFIGURATION 5 (live matrices, search provider, production config,
legal, device) · PARTIALLY_IMPLEMENTED 0 · MISSING 0.
