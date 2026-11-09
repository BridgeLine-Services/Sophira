# Phase 0 — Repository protection and engineering baseline

**Date:** 2026-11-09
**Audited HEAD:** `7dac64d39f22424efcc21d7db6c5f35a247015d7` (master, verified via GitHub API — not assumed)
**Working branch for this phase:** `phase-0/baseline-assessment` (no production changes, no migrations run, no env changes)
**Method:** every claim below was produced by the command named, on this exact commit.
Where something could not be measured, it says so.

---

## 0. Reproducible baseline (measured 2026-11-09 on 7dac64d)

| Check | Command | Result |
|---|---|---|
| Test suite | `npm test` | **4863 / 4863 passed, 0 failed** |
| Type check | `npx tsc --noEmit -p tsconfig.json` | clean (exit 0) |
| Production build | `npm run build` | PASS (70+ routes, static + dynamic) |
| Secret scan | `npm run scan:secrets` | CLEAN (2 client artifact dirs, 4 secret names) |
| Release gate self-test | `node scripts/release-gate.mjs --self-test` | PASS (41 checks registered) |
| Deployment verify | `npm run verify` | PASS (warnings only for optional capabilities) |
| Lint | `npm run lint` | **0 errors, 104 warnings** (eslint IS installed now; the older audit's "lint unavailable" limitation no longer applies) |

Not run (and not claimed): any live database/RLS matrix (needs the project's credentials),
any live model-quality benchmark (no inference endpoint reachable from this sandbox),
physical-device checks, and any production deployment change.

---

## 1. Existing feature inventory (verified in source)

**Pages (69 `page.tsx`):** dashboard, courses (+ new/[id]), assignments (+ new/[id] workspace),
teachers, essay, math, tutor, library, notebooks (+ detail), memories, learning, corrections,
proposals, notifications, owner (+ members, invitations, analytics, system-health, activity,
trends, preservation), settings, onboarding, online, offline, local, login, signup,
create-owner, reset-password, setup, install, downloads, terms, privacy, license,
access-denied, error/global-error/not-found.

**API surface (31 route groups):** account (delete, export), ai (solve, analyze-writing,
extract-teacher-doc, feedback-to-proposal, style-suggestions, health), archive, complete-owner,
courses, essay (plan, draft-section), extract, health, integrations (canvas ×6, google ×9,
microsoft ×7, selections ×2), invitation-requests, invitations (+ accept), learning/patterns
(+ evidence), math (solve, prepare, practice), memory (+ [id]), network (members, stats),
notebooks (×7), notifications, owner (preservation, system-health), preferences/foreign-language,
provider-diagnostics, provider-status, readiness (+ final), research (+ audit, verify-again,
resume), rubric-audit, schedule (+ executions), setup-repair, setup-sql, setup-status, tutor,
typing (+ profile), writing (grammar, plan, review).

**Data model (43 migrations, 43 tables + auth):** academic_sources, app_config, canvas_*
(3), document_history, essay_sessions, invitation_requests, learning_patterns,
member_notifications, notebook_* (7), notification_preferences, owner_bootstrap,
profile_versions, profiles, provider_connections, provider_usage, research_* (7),
rubric_audits, schedule_executions, sophira_meta, student_memories (+ evidence),
subject_preferences, typing_attempts, typing_profiles, work_schedules, workload_selections.
Storage: one private bucket `private-docs`; no public buckets.

---

## 2. AI architecture (as built — not as imagined)

```
browser ──► 31 API route groups ──► aiChat() [src/lib/ai/client.ts]  (server-only)
                                        │  records best-effort provider_usage
                                        ▼
                             serverAiChat() [src/lib/ai/provider.ts]
                                        │  resolveProviders(readAiEnv()) → ordered candidates
                                        ▼
      AI_PROVIDER=auto (default):  selfhost ──► gemini ──► openai(only if paid explicitly allowed)
                                   │            │          │
                     LOCAL_LLM_BASE_URL   GEMINI_API_KEY  OPENAI_API_KEY + ALLOW_PAID_AI/MONTHLY_AI_BUDGET_USD
                     (OpenAI-compatible   (verified free-  (default OFF: fails closed with
                      Ollama/vLLM/…)       tier models)     an honest message)
                                        │
                    no remote candidate ─┴─► AiNotConfiguredError → routes answer honestly, point at Offline mode
Offline mode (browser): src/lib/offline/* — model registry/manager, device capabilities,
web worker engine, encrypted store (crypto.ts), sync queue + conflict resolution, backend adapter.
```

Explicit modes: `AI_PROVIDER=selfhost|gemini|openai|local`. `local` = the server makes **no**
remote AI calls. Paid providers are inert unless explicitly enabled and within budget.

Provider reliability today: health probe `/api/ai/health`, `/api/provider-diagnostics`,
`/api/provider-status`, per-provider call classification (`UseRecord`: provider, model,
classification, ok, tokens). **Missing** (verified by grep, not assumed): request timeouts,
retry policy, circuit breaker, and per-request provenance surfaced to the UI.

---

## 3. Persistence architecture

Authoritative store: Supabase Postgres (RLS on every table; owner NOT exempt from private
member data) + private storage bucket. `docs/DATA_AND_MEMBER_PRESERVATION.md` and
`docs/BACKUP_INVENTORY.md` define why a redeploy cannot delete members (identities live in
`auth.users` + `profiles`; migrations are additive).

Current save behavior — **measured**: writes happen on explicit actions and on route
completion; there is **no** visible save-state vocabulary in the UI. A grep for
`Saving... / Saved / Save failed, retrying / Changes waiting to sync` returns **zero**
matches. Existing feedback strings are per-feature ("Schedule saved.", "Sample saved.",
"Sync failed", "Synchronization failed. Your changes are still queued safely.").
Offline sync has a real queue with conflict handling; the **UI vocabulary** required by the
directive (§5) is a genuine gap, not a wording tweak.

Browser-local, non-authoritative: offline encrypted store + sync queue (by design), UI drafts.

---

## 4. Document ingestion

Upload → `/api/extract` → parser chain (text, DOCX, PDF via pdf-parse, modern-PDF fallback via
pdfjs-dist) → structured blocks with per-page provenance → user-visible uncertainty; PDF
baseline measured in `docs/DOCUMENT_EXTRACTION_BASELINE.md` (modern PDF 3/3 deterministic;
scanned pages correctly empty rather than fabricated). Stored in `private-docs` (RLS) with
`document_history` revisions.

---

## 5. Missing functionality relevant to Phase 1

1. No request timeout / retry / circuit breaker / provider-trace surface (item G).
2. No model evaluation corpus runner wired into the suite (item C) — an eval corpus exists
   (26 cases, "evals 14 deterministic pass / 12 skipped" per the final report) but there is no
   model-comparison harness producing accuracy/latency/hallucination tables.
3. No owner-facing "model readiness report" tied to hardware (item F).
4. No visible save-state vocabulary (directive §5) across editors.
5. No persisted task checkpoints for multi-stage AI tasks beyond research resume (item E).
6. Provider provenance/fallback reasons are computed (`resolveProviders().reasons`) but not
   surfaced per request to the member (item B: "display a simple notice when an external
   provider is used").

---

## 6. Files each later phase will touch (dependency map)

| Area | Files | Downstream consumers |
|---|---|---|
| Provider routing/timeouts | `src/lib/ai/provider.ts`, `src/lib/ai/client.ts`, `src/lib/env.ts`, `src/config/env.manifest.json` | all 17 AI routes + `/api/ai/health`, `/api/provider-diagnostics` |
| Eval harness | `scripts/` (new), `tests/` (new), `src/lib/ai/*` (read-only) | none (additive) |
| Save-state vocabulary | shared components in `src/components/`, editor pages (`assignments/[id]/Workspace.tsx`, `notebooks/[id]`, `settings`) | visual only; no API change |
| Checkpoints | `src/lib/research/*`, `src/app/api/research/resume/route.ts` pattern | research, essay, notebooks |
| Readiness report | `src/app/owner/system-health`, `/api/ai/health` | owner UI only |

Shared components that must NOT be rewritten: `src/lib/supabase/*`, `src/lib/owner-setup.ts`,
`src/lib/db-ddl.ts`, auth/middleware chain, `src/lib/ai/context.ts` + `subjects.ts` contracts.

---

## 7. Acceptance tests defined for Phase 1 (baseline additions)

1. `AI_PROVIDER=auto` with `LOCAL_LLM_BASE_URL` set → selfhost is candidate #1.
2. `AI_PROVIDER=local` → zero remote candidates, regardless of keys.
3. Paid OpenAI stays inert with default env (`ALLOW_PAID_AI=false`, budget 0).
4. Configured timeout produces a classified failure, not a hang (new).
5. Local 404 / unsupported model is reported as unhealthy, not healthy (new).
6. Vision request refuses a non-vision model (existing check, extended).
7. No provider key in client bundles (existing secret-scan, extended to new files).
8. Offline inference path unchanged (existing suite).
9. Eval harness: deterministic fixtures produce a report; skipped cases reported as skipped,
   never as pass.
10. Every existing test in the 4863 baseline continues to pass.

---

## 8. Risk assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Touching provider routing breaks 17 AI routes | medium | routing is single-sourced in `resolveProviders`; change behind additive options + full suite |
| Timeouts change latency behavior for slow local models | medium | defaults chosen from measured local timings; owner-configurable, documented |
| Save-state UI spreads across many editors | low-medium | shared component; per-page adoption, no API change |
| Eval corpus mistaken for a quality guarantee | medium | report explicitly separates deterministic fixtures from live-model scoring |
| Sandbox cannot reach a real inference server | high | benchmarks run only where an endpoint is reachable; otherwise reported as NOT RUN |

---

## 9. Rollback plan

Every Phase 1 change is a small commit on its own branch. Revert = `git revert <sha>`; no
migration is added by Phase 1, so rollback carries no data risk. Feature flags
(env-gated, default-off) protect any behavior change to existing routes. No production env var
is modified without the owner's explicit instruction.

---

## 10. Branch and release safety (this phase)

- Work happens on `phase-0/baseline-assessment`; master untouched.
- No migration was executed; no production data read or written.
- No environment variable was changed.
- The only file added is this assessment.
