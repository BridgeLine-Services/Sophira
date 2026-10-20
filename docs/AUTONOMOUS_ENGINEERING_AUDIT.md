# Sophira Autonomous Engineering Audit

**Audit date:** 2026-10-19  
**Repository:** `BridgeLine-Services/Sophira`  
**Baseline:** `master` at `74f59d0`  
**Mode:** read-only engineering audit; no production writes or deployment actions performed

## Executive result

Sophira is materially implemented and its repository-side quality gates are substantially stronger than a prototype. The current tree passes the full TypeScript test suite, production build, root typecheck, secret scan, environment-manifest check, migration self-test, and release-gate structural self-test.

This is **not a production GO certification**. The release gate correctly remains dependent on live Supabase matrices, owner/device acceptance, deployment verification, legal facts, and provider configuration. Those are environment- and owner-controlled evidence, not claims that can be established from source inspection alone.

## What was verified

| Area | Evidence | Result |
|---|---|---|
| Automated regression suite | `npm test` | **PASS — 3,768 passed, 0 failed** |
| Production compilation | `npm run build` | **PASS — Next.js build completed; 66 static pages generated** |
| Root typecheck | `npx tsc --noEmit` | **PASS** after the build generated `.next/types` |
| Secret scanning | `npm run scan:secrets` | **PASS — CLEAN** |
| Environment contract | `npm run env:example` | **PASS — `.env.example` in sync** |
| Migration structure | `node scripts/apply-migrations.mjs --self-test` | **PASS** |
| Release-gate structure | `node scripts/release-gate.mjs --self-test` | **PASS — exactly 39 checks registered** |
| Dependency audit | `npm audit --omit=dev --audit-level=moderate` | **BLOCKED — 3 moderate `sprintf-js` findings via `mammoth`/`argparse`; automated fix is breaking** |

The initial parallel typecheck raced the build and reported missing `.next/types`; rerunning after the build completed passed cleanly. This is an environment-ordering issue, not a source failure.

## Architecture and safety findings

### Strong controls present

1. **Privileged database access is allowlisted and parameterized.** `src/lib/db-privileged.ts` restricts functions, tables, columns, and profile fields; values are passed as query parameters. Direct access is used only when configured, with a documented PostgREST fallback for deployments that lack the direct channel.
2. **Invitation acceptance is atomic.** The update requires `status = 'pending'` and returns only the row accepted, preventing concurrent double acceptance.
3. **Offline revocation is fail-closed.** `SyncEngine` distinguishes authorized, unauthorized, and unknown states; unknown preserves the queue, confirmed unauthorized seals the queue, and logout is required for purge.
4. **Offline sync preserves unsynced edits.** Upload order is deterministic, conflicts are recorded explicitly, remote pulls stop at unsynced local rows, and failed operations remain retryable.
5. **Release status is honest by construction.** `scripts/release-gate.mjs` defines PASS, FAIL, BLOCKED, and NOT RUN; only all-PASS produces GO. Live security checks require the three test Supabase variables instead of silently substituting assumptions.
6. **CI has a single authoritative path.** The scheduled health workflow runs the release gate, stores its report, and uses one pinned issue for owner notification. It does not claim success from a missing or skipped matrix.

### Remaining risks / evidence gaps

1. **Live security evidence is not reproducible from this sandbox.** The release gate requires `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, and `SUPABASE_TEST_SERVICE_ROLE_KEY` for live RLS and invitation matrices. No live secrets were requested or exposed during this audit.
2. **Dependency audit needs a deliberate decision.** `sprintf-js` is pulled through `mammoth`; `npm audit fix --force` proposes a breaking `mammoth` downgrade. Do not apply that automatically. Prefer an upstream-compatible dependency update or a documented risk acceptance after checking the actual affected code path.
3. **Device acceptance remains external evidence.** Browser, Android, iOS, and desktop acceptance cannot be certified by source inspection. The release gate reads `docs/DEVICE_ACCEPTANCE.md` and correctly treats NOT TESTED as blocked.
4. **Provider/OAuth and legal readiness are configuration facts.** Google/Microsoft consent, AI provider readiness, search readiness, owner account state, and legal copy must be verified in the target deployment and documented with dated evidence.
5. **The requested eight reference repositories were not identifiable in the available project context.** The repository’s audit documents and local attachment did not provide a machine-readable list of exact repository URLs. No substitute repositories were silently selected; comparative conclusions above are based on Sophira’s current source and its own documented architecture.

## Priority roadmap

### P0 — release evidence, not speculative code

- Run the full release gate in the target environment with the three Supabase test variables and preserve the report artifact.
- Complete and date every row in `docs/DEVICE_ACCEPTANCE.md` for the supported browser and native targets.
- Verify deployment environment variables, database migration state, AI readiness, OAuth consent, search readiness, owner account, and legal facts through the app’s System Health surface.

### P1 — dependency and operational hardening

- Investigate the `sprintf-js` advisory through the dependency graph and `mammoth` compatibility notes. Upgrade to a non-vulnerable compatible chain if available; otherwise record a bounded risk acceptance and compensating control.
- Add a deterministic CI job for the root typecheck after the build or change the typecheck configuration so a clean checkout does not depend on a previously generated `.next/types` directory.
- Keep the scheduled health workflow as the sole notification path and retain gate artifacts for trend comparison.

### P2 — maintainability

- Keep the privileged identifier allowlists synchronized with migrations using the existing test, and extend coverage whenever a new server-side table/function is added.
- Preserve the offline queue’s explicit conflict and revocation semantics; add regression cases for cursor replay and partial pull failures when those behaviors change.
- Add the exact external reference repository list to an audit input file if comparative benchmarking is still required.

## Release recommendation

**Recommendation: HOLD production certification pending owner/live evidence.** The repository implementation is in a strong, test-backed state, and the current automated suite is green. The hold is specifically for live authorization/security matrices, device acceptance, deployment/provider/legal checks, and the unresolved moderate dependency advisory—not for an unverified claim that the core code is incomplete.
