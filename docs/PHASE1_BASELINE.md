# PHASE 1 — BASELINE AND PRESERVATION RECORD

**Date:** 2026-11-03 · **Branch:** `master` · **HEAD:** `1770220` · **Author:** Sophira development session

## What Phase 1 is

The directive's body begins at Phase 2. The only Phase 1 content is in GLOBAL INSTRUCTIONS §A ("Understand
the existing application before making changes") and §B (absolute preservation), and one line in the Phase 2
section: *"Phase 1 is already complete. Do not rebuild the owner management operations."*

So this record does what §A and §B ask, and nothing else:

1. Identify the production branch and latest commit.
2. Read the eight listed documents.
3. Compare their claims against the actual source and tests.
4. Record the current functionality and its dependencies **before** any editing.
5. State plainly what is verified and what is not.

Nothing was redesigned, migrated, or deployed in this phase. No route, schema, auth rule, RLS policy,
integration, offline feature, or PWA asset was touched.

## 1. Repository and production target

| Item | Value | How established |
|---|---|---|
| Repository | `https://github.com/BridgeLine-Services/Sophira` | remote configured locally |
| Production branch | `master` | Vercel auto-deploy; a commit made minutes earlier was already live |
| Latest commit | `1770220` (ci(prod): check the live site daily…) | `git log` after push |
| Deployed address | `https://sophira.vercel.app` | recorded in `docs/FEATURE_STATUS.md`, `docs/FINAL_COMPLETION_AUDIT.md`, and confirmed by request |
| Live status at 22:40 UTC | signed-out gate, public pages and headers all correct (27/27) | `npm run smoke:prod`, evidence in `docs/PRODUCTION_ACTIVATION.md` |
| Signed-in status | **NOT TESTED** | no member credentials in this environment |

## 2. Inventory, regenerated from source

Produced by the repository's own script, not typed by hand: `node scripts/inventory.mjs`.

```
inventory: 69 pages (44 shell, 30 client), 85 API routes
```

That agrees with both the directive and `docs/REDESIGN_INVENTORY.md` (69 / 44 / 85). It also reconciled a
number I had wrong: my own API scan reported 84 routes because it walked `src/app/api` only.
`src/app/auth/callback/route.ts` is the 85th, and it is the OAuth/recovery callback handler, so it is a GET
that matters. `tests/api-dynamic.ts` now walks all of `src/app` and covers it.

Redesign state, from `docs/redesign-status.json` (8 tracked routes) and the generated inventory:

| Status | Count |
|---|---|
| Complete | 0 |
| Partial | 8 (all `/owner` routes) |
| Not started | 61 |
| Total pages | 69 |

The eight partial entries each carry a written reason that ends the same way: automated tests pass and the
route authorises server-side, but light/dark and mobile visual review has not been done. That is an honest
`PARTIAL`, and it stays `PARTIAL` until a browser exists to review it.

## 3. Functionality recorded before any change

These are the systems this project must not break. File pointers are for the next phase, not a change list.

- **Authentication** — `src/middleware.ts` (route gate), `src/lib/supabase/guard.ts`, `src/app/auth/callback/route.ts`.
  Sign-in, password reset, invitation acceptance, first-owner creation, invitation-only registration.
- **Privacy / RLS** — `supabase/migrations/` (43 files), `supabase/bootstrap-all.sql`, `tests/security/rls-regression.mjs`,
  `tests/security/invitation-regression.mjs`, `src/lib/owner/page-context.ts` (authorisation only, not content).
- **Owner administration** — nine routes: `/owner`, `/owner/members`, `/owner/invitations`, `/owner/requests`,
  `/owner/activity`, `/owner/status`, `/owner/security`, `/owner/ai-providers`, `/owner/health`. Phase 1 of the
  previous directive; not to be rebuilt.
- **Academic intelligence** — `src/lib/ai/` (academic levels, writing-profile learning, style suggestions), `src/lib/memory/`.
- **Integrations** — `src/lib/integrations/` (Google, Microsoft, `history.ts` with its absolute rule that OAuth
  tokens are never part of any event), `src/lib/research/` with `policy.ts`.
- **Offline / PWA / native** — service worker and manifest, `/offline`, `/install`, `/downloads`, Capacitor and
  Tauri projects.
- **Design system** — `src/app/globals.css` (semantic tokens, light and dark), `src/components/ui/`,
  `src/components/app/AppShell.tsx` (44 pages share it).
- **Verification tooling** — `scripts/` (`inventory`, `contrast`, `a11y-audit`, `design-drift`, `release-gate`
  with its 41 checks asserted at runtime, `smoke-runtime`, `smoke-prod`, `member-preservation`, `backup-sophira`)
  and 4,858 automated tests.

## 4. Documentation reconciled against source

| Claim | Source of claim | Reality | Verdict |
|---|---|---|---|
| 69 page routes, 44 using the shell | directive, `REDESIGN_INVENTORY.md` | 69 pages, 44 shell | **agrees** |
| 8 partial, 61 not started, 0 complete | directive, `redesign-status.json` | 8 partial, 0 complete, 61 untracked | **agrees** |
| 85 API routes | `REDESIGN_INVENTORY.md` | 85 route handlers (84 API + 1 auth callback) | **agrees** |
| 41 release-gate checks | `RELEASE_GATE.md`, gate asserts the count at runtime | script present, count asserted in code | **agrees** |
| Live deployment **NOT TESTED** | `PRODUCTION_ACTIVATION.md` (older text) | superseded: 27/27 signed-out checks against production on 2026-11-03 | **corrected today** |
| 47 vs 48 protected tables | `SOPHIRA_PHASE_COMPLETION_AUDIT.md` vs newer implementation | both numbers appear across documents; not resolved from here | **Phase 3 item, unresolved** |
| Migrations `0042`, `0043` applied | implied by the presence of the files | files exist (`0042_member_notifications`, `0043_member_phone`); application to production **not verified** — no database credentials here, and file existence proves nothing | **NOT TESTED** |

## 5. Verification run for this record

| Command | Result |
|---|---|
| `npm test` | 4,858 passed, 0 failed |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 104 warnings |
| `npm run build` | succeeds |
| `npm run smoke:prod` (against production) | 27/27 |
| `node scripts/inventory.mjs` | 69 pages, 44 shell, 85 routes |
| `production-smoke.yml` dispatch | GitHub Actions run `41734777238`: completed, success |

## 6. What Phase 1 does not establish

- **No browser exists in this environment.** Keyboard traversal, focus visibility, screen readers, and the
  mobile/desktop visual review that the 8 `PARTIAL` owner routes are waiting on remain **NOT TESTED**. Static
  audits (`a11y-audit`, `contrast`) are not a substitute, and neither is a passing build.
- **No member or owner credentials, no Supabase project.** Live RLS, cross-member isolation, the record census
  against a real database, and every Phase 3 security test are **BLOCKED** on a separate test project.
- **No third-party credentials.** Google, Microsoft, Resend, and web search are **BLOCKED** (Phase 4).
- **No devices.** PWA install and native builds are **NOT TESTED** (Phase 6).

## 7. Immediate next step

Phase 2, starting from the generated inventory rather than any older list: establish the existing token and
component standards from `globals.css`, `components/ui`, and `AppShell`, then redesign route by route, marking
`redesign-status.json` only when a route has actually passed its checks. The 61 `NOT STARTED` routes are the
work; the 8 `PARTIAL` ones need visual review that this environment cannot provide.
