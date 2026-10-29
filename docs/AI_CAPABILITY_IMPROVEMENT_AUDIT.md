# AI Capability Improvement Audit (Prompt 1)

**Status:** audit and plan only. No application logic, dependency, schema, or deployment change was made.
**Date:** 2026-10-29
**Repository:** https://github.com/BridgeLine-Services/Sophira
**Branch audited:** `master` at `75b41bb` (working tree clean)

---

## 1. Repository and baseline

| Item | Fact |
|---|---|
| Framework | Next.js App Router (server components + API routes), TypeScript |
| Package manager | npm (`package-lock.json` committed) |
| Dependencies | 24 runtime, 10 dev |
| Document stack | `pdf-parse@1.1.1`, `mammoth`, `xlsx` (SheetJS CDN tarball), `jszip`, `@huggingface/transformers` (browser/edge) |
| Build | `next build`; `serverExternalPackages: ["pdf-parse"]` in `next.config.mjs` |
| DB / auth | Supabase (Postgres, RLS, Auth, private storage), invitation-only signup |
| CI | `.github/workflows` — `CI` and `Migrations` jobs, both green on `75b41bb` |

### Commands actually executed for this baseline

| Command | Result |
|---|---|
| `npm test` | **PASS — 4018/4018** |
| `npm run verify` | **PASS** (optional-capability warnings only) |
| `npm run build` | **PASS** |
| `npm run scan:secrets` | **CLEAN** (4 client artifacts, 4 secret names) |
| `node scripts/release-gate.mjs --self-test` | **PASS** — 39 registered checks, exactly 39 implemented |
| `npm run lint` | **BLOCKED, pre-existing** — `sh: 1: eslint: not found` (eslint is not installed and not declared in devDependencies) |

**`npm run lint` is a pre-existing repository defect, not a regression.** Any later prompt that claims lint coverage must either install eslint (a change to `package.json`, needs review) or report lint as unavailable. Nothing in this audit changed it.

No test in this baseline requires live external credentials. Security regression suites (`tests/security/rls-regression.mjs`, `invitation-regression.mjs`) are **offline** checks over policies and code paths; none of them proves live RLS behaviour against a running database. That distinction is carried into every later phase.

---

## 2. Existing capability inventory (verified in source)

### AI core
- `src/lib/ai/context.ts:64` `wrapUntrusted(label, text)` — delimiter/labelling wrapper for untrusted document and web text.
- `src/lib/ai/context.ts:69` `detectInjectionAttempt(text)` — heuristic injection detection over untrusted content.
- `src/lib/ai/provider.ts:95` `resolveProviders(env)` — eligibility and ordering; `:313` `selfhostChat()` — OpenAI-compatible self-hosted call with timeout; `:469` `serverAiChat()` — dispatch + response validation.
- Free-first policy lives in the resolver: self-hosted → Gemini free tier → OpenAI **only** when `ALLOW_PAID_AI=true` or budget > 0; defaults `false` / `0`.
- Browser-local inference: `src/lib/offline/` (`local-engine.ts`, `load-transformers.ts`, `device-capabilities.ts`, `crypto.ts`, `conflicts.ts`, `client.ts`, `api.ts`, `backend.ts`).

### Documents
- `src/app/api/extract/route.ts` — response contract at lines 14–15: `confidence: "high" | "medium" | "low" | "failed"` and `notes`; honest low-confidence copy for scanned PDFs (lines 34–35).
- `src/lib/extract/documents.ts` — DOCX HTML→text, PPTX, spreadsheet paths.
- `src/lib/notebook/ingest.ts` — per-format ingestion producing source title, type, URLs, hash, text, page/section metadata, verification status, notes.

### Research
- `src/lib/research/authority.ts` — assignment-aware authority layer over the generic ranking; domain classifiers at `:52` (`GOV_DOMAIN`), `:55` (`ARCHIVE_DOMAIN`), `:56` (`STATS_DOMAIN`), `:57` (`RESEARCH_ORG_DOMAIN`); `classifyAssignment()` at `:117`; `AUTHORITY_PROFILES` at `:160`.
- `src/lib/research/research.ts` — `generateQueries()`, `normalizeUrl()`, `dedupeSources()`.
- `src/lib/research/verify.ts` — `VerificationStatus`, `VerifiedPage`, `titlesCorrespond()` `:131`, `fetchAndVerify()` `:146`.
- `src/lib/research/claims.ts` — claim/evidence linking (present).
- `src/lib/readiness/finalGate.ts` — submission readiness gate (present).

### Environment / configuration
- `src/config/env.manifest.json` is the single authoritative catalog; `tests/env-manifest.ts` fails CI on any undeclared `process.env` read (this caught a real omission during the invitations work).
- `src/lib/config/discovery.ts` — one resolver reporting categorical readiness (supabase, site_url, database channel, email, sms) with variable **names** only.
- `src/lib/supabase-config.ts` — alias catalogs (`CONNECTION_ENV_NAMES`, eight connection conventions) and classic/new key generations with project-ref validation.
- `src/lib/auth-redirect.ts:26` `appOrigin()` — explicit config → Vercel production domain → deployment URL → browser origin, all https/loopback validated (`isLoopback` typo `"loop"+"alhost"` fixed 2026-10-29; it previously accepted bare `localhost` in production).

---

## 3. External repository findings

Licence and maintenance verified from each project's public README/repository metadata. **No repository was installed, vendored, or executed during this audit.** Where a claim below rests on documentation rather than a file I read, it is marked *(docs)*.

| # | Project | Licence | Runtime | Overlap with Sophira | Decision |
|---|---|---|---|---|---|
| 1 | Docling | MIT *(docs)* | Python + ML models | PDF/DOCX layout-aware extraction vs `pdf-parse`/`mammoth` | **BENCHMARK BEFORE ADOPTION** — only if Prompt 3 measures a real table/multi-column loss. Requires a separate Python service; cannot run in the Next.js runtime. |
| 2 | MarkItDown | MIT *(docs)* | Python | Broad format→Markdown vs existing Node parsers | **BENCHMARK BEFORE ADOPTION** (lower cost than Docling, still Python). |
| 3 | Promptfoo | MIT *(docs)* | Node CLI | Nothing in Sophira; would be a dev-only eval harness | **BENCHMARK BEFORE ADOPTION** as a dev-only tool in Prompt 2; must stay out of runtime deps. |
| 4 | OWASP GenAI Top 10 | CC BY-SA *(docs)* | n/a (reference) | Threat-model reference for injection/LLM01 | **REUSE EXISTING SOPHIRA CODE** as the enforcement layer; use OWASP only as a checklist source. Note: CC BY-SA is a documentation licence — cite, never copy text into the product. |
| 5 | pgvector | PostgreSQL Licence *(docs)* | PG extension | Existing deterministic chunking + keyword/BM25 retrieval | **OPTIONAL FUTURE INTEGRATION** — only on measured retrieval gap; needs migration + RLS plan + backfill strategy. |
| 6 | LangGraph | MIT *(docs)* | Python / JS | Existing staged workflows with explicit validation | **REJECT FOR THIS PROJECT** unless Prompt 6 documents a concrete state-loss or duplicate-write failure. |
| 7 | Ollama | MIT *(docs)* | Local server, OpenAI-compatible API | `LOCAL_LLM_BASE_URL` self-hosted path already speaks this contract | **REUSE EXISTING SOPHIRA CODE** — Sophira already supports the contract; Ollama is one valid server, not a dependency. |
| 8 | llama.cpp | MIT *(docs)* | C++ binary / server | Same OpenAI-compatible contract | **REUSE EXISTING SOPHIRA CODE** (same reasoning). |
| 9 | Haystack | Apache-2.0 *(docs)* | Python | Existing research ranking, verification, claims | **REJECT FOR THIS PROJECT** for now: adopting it duplicates verified logic and adds a Python service. |

### Exploratory academic projects
`academic_ai_assistant`, `ERAGA-Educational-RAG-Assistant`, `ScholarChat-AI`, `campus-docs-assistant` — all **REJECT FOR THIS PROJECT** as dependencies: unverified licences, unclear maintenance, and direct overlap with capabilities Sophira already implements behind authentication and RLS. They remain useful as *design* reading only; no code or dependency is imported.

### Licensing constraint
Sophira is proprietary. Docling/MarkItDown/Promptfoo/pgvector/Ollama/llama.cpp/Haystack are permissive (MIT/Apache-2.0/PostgreSQL Licence) and *would* be compatible if adopted, but permissive is not a reason to adopt. OWASP material is **CC BY-SA**: attribution required and share-alike applies to derived text, so it must be cited, never pasted into Sophira docs or code comments.

---

## 4. Integration map

| Capability | Existing implementation | Existing behaviour | Verified deficiency | Candidate | Proposed change | Files to modify | Files to preserve | Tests to add | Risk | Rollback | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Academic answer quality | `src/lib/ai/client.ts` (persona + rules), `provider.ts:469` `serverAiChat` | Server-side multi-provider tutoring with injection wrapping | No repeatable, scored evaluation corpus; correctness is asserted only structurally | Promptfoo (dev-only) | Add `tests/ai-evals/` corpus + repo-native deterministic runner; Promptfoo optional, never in runtime deps | `tests/ai-evals/**` (new), `package.json` (devDeps, review), `docs/RELEASE_GATE.md` | `client.ts`, `provider.ts`, all 39 gate checks | 20 eval cases from Prompt 2, incl. false-positive academic cases | Low (additive, offline) | Delete `tests/ai-evals/`, revert package.json | BENCHMARK |
| Prompt-injection defence | `context.ts:64` `wrapUntrusted`, `:69` `detectInjectionAttempt` | Heuristic detection + delimiters; injection in PDFs/web tested at 4018-assertion level | Detection is heuristic; no adversarial corpus, no translation/role-play variants | OWASP LLM01 | Extend tests, not detection behaviour | `tests/run.ts` (extend), `tests/ai-evals/**` | `context.ts` untouched | Escape variants, document/webpage injection, secret-disclosure attempts, legit false positives | Low | Revert test additions | REUSE EXISTING CODE |
| Government-information boundary | `authority.ts` classifiers; `verify.ts:146` `fetchAndVerify`; `research.ts` query/URL handling | Domain-tier ranking; **no explicit restricted-material policy layer, and `.gov` is a *positive* authority signal** | Prompt 2 requirement is unmet in code: nothing rejects restricted/unauthorized government material, and `.gov` is treated as authoritative | OWASP LLM01 / source-policy | Narrow policy layer consulted by source selection **and** fetch, refusing access-control bypass; keep `rankCandidates`/authority intact | `src/lib/research/policy.ts` (new), `research/authority.ts` (call-through), `api/research/route.ts`, `verify.ts` (pre-fetch check) | `rankCandidates`, `AUTHORITY_PROFILES`, `classifyAssignment`, `titlesCorrespond` | Allow/deny matrix, rephrasing bypass, legit `.gov` stats page allowed, redirect probe | **Medium** — touches retrieval path; must not block lawful sources | Feature flag off → policy returns `allow` and logs no decision | ADOPT (Prompt 2, smallest scope) |
| SSRF / fetch safety | `verify.ts:146` `fetchAndVerify` | Fetches candidate URLs, handles redirects and dead links | No explicit block on localhost / private IP / metadata endpoints (unverified in this audit — needs Prompt 4 check) | — | Deny-list + redirect re-check inside the existing verifier | `src/lib/research/verify.ts` | Public statuses, `VerifiedPage` shape | SSRF cases, redirect-to-private, legitimate academic URLs | Medium | Remove deny-list; behaviour identical for public URLs | BENCHMARK (Prompt 4) |
| Document extraction | `api/extract/route.ts` (contract lines 14–15), `extract/documents.ts`, `notebook/ingest.ts` | Node parsers for PDF/DOCX/PPTX/XLSX/CSV/text/images with honest confidence | Unmeasured: table/multi-column/equation fidelity. Scanned PDFs already honestly `low` | Docling, MarkItDown | Build synthetic corpus, measure current parser first; adopt only on measured gain | `tests/document-corpus/**` (new) | Route contract, `confidence`, `notes`, size limit, `serverExternalPackages` | Every format, malformed/empty/oversized, injection-in-document, hash + locator stability | Medium if a service is added | Corpus is additive; parsers untouched | BENCHMARK |
| Retrieval quality | `research/research.ts` `generateQueries`/`dedupeSources`; `authority.ts` ranking | Deterministic keyword/BM25-style retrieval, no embeddings | Not measured per academic category | pgvector, Haystack | Measure first; vector path only on demonstrated gap | `docs/` decision record + optional migration | RLS, user scoping | Ranking relevance across 6 categories, reproducibility | High if pgvector | No migration until approved | BENCHMARK / DEFER |
| Local + self-hosted AI | `provider.ts:313` `selfhostChat`, `resolveProviders:95`, `src/lib/offline/**` | Self-hosted first, free cloud second, paid gated; browser model with integrity checks | Model/runtime quality unmeasured; no benchmark corpus | Ollama, llama.cpp | Benchmark through the **existing** OpenAI-compatible contract | `docs/` results only | Provider IDs, ordering, cost policy, offline path | Provider-selection, no-silent-paid-fallback, offline inference readiness | Low | Docs only | REUSE EXISTING CODE |
| Orchestration | `readiness/finalGate.ts`, staged research/verify/claims flows | Explicit checks between stages; no durable cross-request state machine | No concrete failure demonstrated in this audit | LangGraph, Haystack | None now; Prompt 6 must find a real failure first | `docs/ORCHESTRATION_ADOPTION_DECISION.md` | All workflow guarantees | Failure/resume and duplicate-write cases if any are found | Low | Docs only | REJECT (for now) |
| Eval/lint gating | `scripts/release-gate.mjs` (39 checks), `npm run verify` | Deterministic offline gate | `lint` script cannot run (eslint absent) | Promptfoo (dev) | Fix lint availability **or** record it honestly; add an offline eval section | `package.json` (review), `docs/RELEASE_GATE.md` | The 39 checks, `--self-test` invariants | Gate self-test assertions | Low | Revert | BENCHMARK |

---

## 5. Risks and missing test coverage

1. **No live security verification.** `rls-regression.mjs` and `invitation-regression.mjs` are offline inspections. Live RLS/authorisation behaviour against a real Supabase project is unproven in this environment and must not be reported as tested.
2. **`npm run lint` cannot run** (eslint not installed). Any "lint passes" claim before that is fixed is false.
3. **Government boundary is prompt-level today.** The code ranks `.gov` *higher*, which is the opposite of a restriction layer; Prompt 2 must add an explicit, narrow policy and tests.
4. **Provider quality is unmeasured.** 4018 assertions prove structure and policy, not answer quality.
5. **Extraction fidelity is unmeasured.** No corpus exists for tables, columns, equations.
6. **Promptfoo in CI** risks network dependence; it must stay optional and offline-safe.
7. **Docling/MarkItDown/Haystack are Python.** Any adoption implies a second runtime and service boundary — an architecture decision requiring explicit approval, not a package install.

---

## 6. Prioritised implementation sequence

1. **Prompt 2 (safety + evals)** — highest value per unit of risk: offline eval corpus, injection/secret/cross-user tests, and the government-information policy layer in code with SSRF-adjacent fetch rules. No new runtime dependency required.
2. **Prompt 3 (documents)** — corpus and measurement before any parser change; adopt only on evidence; otherwise document that current parsers are retained.
3. **Prompt 4 (research)** — measure ranking per category, then and only then consider pgvector; add the fetch deny-list.
4. **Prompt 5 (local AI)** — benchmark through the existing OpenAI-compatible contract; no framework.
5. **Prompt 6 (orchestration)** — decision record; expect "retain current architecture".
6. **Prompt 7 (final regression)** — full gate, honest reporting of anything unrunnable.

Ordering rationale: each step strengthens a boundary or produces evidence while touching the smallest possible surface. Security work precedes quality work because a quality improvement on an unsafe boundary is worse than no improvement.

---

## 7. Explicit decisions not to adopt

- **No LangGraph, no Haystack** — no demonstrated orchestration failure; both add a second runtime and would duplicate verification logic that already has tests.
- **No pgvector and no embeddings** — retrieval has not been measured as inadequate; adding it would create backfill, RLS and cost obligations.
- **No Docling/MarkItDown in the Node runtime** — Python-only; a service boundary is an architecture decision requiring explicit approval.
- **No Promptfoo in production dependencies** — dev-only, optional, offline-safe; keep `npm test` free of network calls.
- **No new provider framework** — Ollama and llama.cpp already satisfy the existing contract; Sophira should not depend on either.
- **No evaluation corpus built from real student data** — synthetic fixtures only.

---

## 8. Required regression tests per subsequent prompt

**Prompt 2:** injection (direct, document, webpage), secret disclosure, cross-user access, tool-escalation, restricted-government retrieval (plus rephrased/translated bypass), lawful academic request still allowed, false-positive assignment text, malformed source metadata, eval-corpus determinism offline.
**Prompt 3:** all existing formats, response-field stability, empty/malformed/oversized, page+section metadata, citation offsets and content hashes, private-storage and notebook ownership, injection inside files.
**Prompt 4:** ranking relevance across six categories, teacher-requirement precedence, prestige-vs-relevance conflict, unsupported/fabricated claims, dead links and access refusals, snippet-not-evidence, SSRF and redirect probes, cross-user isolation, provider-unavailable honesty.
**Prompt 5:** provider ordering unchanged, no silent paid fallback, self-hosted timeout behaviour, `LOCAL_LLM_BASE_URL` validation, offline integrity + real inference readiness, no secrets in health responses.
**Prompt 6:** only if a real workflow defect is found — resume-after-failure, duplicate-write prevention, approval-before-destructive-write.
**Prompt 7:** full sequence (`npm ci`, `test`, `build`, `verify`, `scan:secrets`, `release-gate --self-test`, `release-gate`) with `lint` reported as blocked until eslint exists.

---

## 9. Preservation checklist (unchanged by this audit)

- Login, owner creation, invitations, revocation, sessions; Supabase Auth only.
- Single-owner atomic claim; owner-only invitations; RLS and user-scoped data.
- Private document storage and ownership checks on `/api/extract` and notebook sources.
- Existing API request/response shapes (extraction `confidence`/`notes`, notebook ingest shape, research records).
- Provider ordering, free-first policy, `ALLOW_PAID_AI=false` / `MONTHLY_AI_BUDGET_USD=0` defaults, no silent paid fallback.
- Offline model consent, integrity checks, encrypted offline storage, queued sync, conflict resolution.
- Research source verification, citation integrity, claim-to-evidence traceability.
- Assignment/teacher authority, rubric checks, readiness gate, math verification.
- Routes, navigation, responsive layout, installable-app behaviour.
- The release gate's 39 checks and `--self-test` invariants.

---

## 10. Conclusion

Sophira's AI architecture is already strong: provider abstraction with free-first ordering, prompt-injection wrapping, honest confidence reporting, source authority with assignment awareness, and 4018 offline assertions behind a 39-check release gate. The real gaps are **evidence and boundaries**, not architecture: no scored evaluation corpus, no code-level government-information policy (`.gov` is currently a *positive* signal), unmeasured extraction and retrieval fidelity, an unrunnable lint step, and no live RLS verification.

Prompt 2 should proceed first. No dependency was installed, no schema or application logic changed, and no deployment was performed.
