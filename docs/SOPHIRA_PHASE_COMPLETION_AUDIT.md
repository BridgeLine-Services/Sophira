# Sophira phase completion audit

Audited branch: `master` @ `3f02c20` (baseline), plus `327d691`, `447e091` and `caf476c`.
Audit date: 2026-11-03.

Statuses used, exactly as the directive defines them: **COMPLETE** (implemented and verified),
**PARTIALLY COMPLETE**, **BLOCKED** (needs credentials or owner action), **NOT TESTED**
(implemented, not tested in the required environment), **NOT STARTED**.

Nothing below is marked COMPLETE because code exists. Where verification happened in this
sandbox, the command is named. Where it could not happen, the row says so and says why.

---

## Baseline verification actually executed

| Command | Result |
| --- | --- |
| `npm test` | 4,830 passed, 0 failed |
| `npx tsc --noEmit` | clean |
| `npm run build` | compiled successfully |
| `npm run lint` | 0 errors, 104 warnings |
| `npm run verify` | PASS |
| `npm run smoke:runtime` | 77/77 against the built app (8 public routes, security headers, page-route allowlist, anonymous-API probe, cache policy, crawler guidance) |
| `npm run scan:secrets` | CLEAN |
| `node scripts/contrast.mjs` | PASS, 32 pairs (16 per theme) |
| `node scripts/design-drift.mjs` | 0 literal palette colours |

---

## Phase 1 - Owner navigation

**Status: COMPLETE.** Preserved, not rebuilt.

Requirement: every owner function on a dedicated page under `/owner`, reached from the sidebar.

- Implementation: `src/app/owner/*/page.tsx` (10 routes), `src/components/app/AppShell.tsx`
  (nav config), `src/components/app/OwnerDashboard.tsx` (overview only).
- Shared modules, unchanged: `src/lib/owner/page-context.ts` (server-side owner gate),
  `src/lib/owner/roster.ts`, `src/lib/owner/member-actions.ts`,
  `src/lib/owner/invitation-actions.ts`.
- Tests: `tests/course-engine.ts` (owner-nav grouping, href integrity, page existence),
  `tests/prod-fixes.ts` (no hash-only owner links), `tests/run.ts` (owner access wording).
- Result: passing. Every nav destination resolves to a page module; the nav contains no hash.

## Phase 2 - Application redesign

**Status: PARTIALLY COMPLETE.** 0 of 69 routes are finished; 8 are partial.

Completed and verified in this branch:
- Design system: one dark palette (two had drifted), `--c-on-accent` for text on filled
  emphasis surfaces, AA contrast measured in both themes. See `docs/THEME_VERIFICATION.md`.
- `scripts/design-drift.mjs` plus a ratchet in `tests/run.ts`: **0** literal palette colours
  remain in `src`, so every screen now renders from semantic tokens. Two real dark-mode bugs
  were fixed by that pass (light-slate chips in `SyncStatus` and `SystemHealthPanel`, white text
  on the accent gradient in `dashboard/page.tsx`, and a rose destructive button with white text).
- All 69 routes were inventoried, not redesigned: `docs/REDESIGN_INVENTORY.md`.
- Crash safety (`327d691`): there was no `global-error.tsx`, and `error.tsx` does not catch a
  failure thrown in the root layout itself, so a layout-level crash rendered a blank white page.
  Added, with plain-language text and a plain link (a client-side `Link` could fail for the same
  reason the boundary was reached). Its own crash path is **NOT TESTED**: inducing a real layout
  failure needs a browser session.
- Keyboard access (`327d691`): the audit found two dialogs dismissible only by mouse. One had a
  backdrop safe to mark `aria-hidden`; in `notebooks/[id]` the handler sat on the element wrapping
  the dialog, so it was split into a real backdrop plus `role="dialog" aria-modal="true"` rather
  than silencing the rule. Screen-reader confirmation of either is **NOT TESTED** (no browser).

Still open, per route, for the remaining 61: page-level redesign against the design system,
then light/dark and mobile checks. `docs/redesign-status.json` records only what has passed,
and a test forbids marking a route complete without a written reason.

Not verified anywhere yet: layout at 360/390/430/768/1024/1440 px, focus order through the new
owner tiles, dark-mode visual quality. These need a browser; none is available in this
environment, so they are **NOT TESTED** rather than assumed.

Accessibility is now covered by three gates that run in the suite, each with its own limits:

| Gate | Covers | Does not cover |
| --- | --- | --- |
| `scripts/contrast.mjs` | WCAG AA ratio for every token pair, both themes | real rendered output, images, gradients |
| `scripts/a11y-audit.mjs` | controls with no accessible name (buttons **and** links), form controls with no label, dialogs without `aria-modal` and a name, and `<div onClick>` that only a mouse can reach unless it is marked presentational (TypeScript AST, 127 files, self-tested against 6 planted defects) | focus order, keyboard traps, ARIA misuse beyond these rules |
| `src/app/global-error.tsx` | ships in the build (chunk verified) and is the only boundary Next uses for a root-layout crash — without it that crash showed a blank white page | a genuine layout crash has **not** been triggered here, so its rendered appearance is browser-verifiable work |
| anonymous-API probe (in smoke) | 79 API routes POSTed an empty body signed-out: no 500s, no stack frames, module paths, DSNs or JWTs in any response | authenticated behaviour, and the 4 state-changing routes excluded from the probe |
| `scripts/smoke-runtime.mjs` | one non-empty `h1` per public page, security headers, and: no page route outside an explicit public allowlist answers 200 signed-out (71 routes probed) | authenticated pages' content, which needs a signed-in session |

Security headers (added 2026-11-03, asserted by the smoke suite): `X-Content-Type-Options`,
`Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, and `Strict-Transport-Security`
in production builds. Before this the app sent **none** of them, which left `/create-owner`
framable by a hostile page. **NOT shipped deliberately:** a Content-Security-Policy. Next injects
inline hydration scripts and the app calls Supabase and provider APIs, so a wrong policy
white-screens the app, and this environment has no browser to validate one against. Tracking it as
pending rather than shipping it unverified is the honest option; `X-Frame-Options` already covers
the clickjacking case.

Genuinely **NOT TESTED**: keyboard traversal, focus visibility in the browser, screen-reader
announcements, reduced-motion behaviour. These need a browser and assistive technology; claiming
them from static analysis would be exactly the shortcut the directive forbids.

## Phase 3 - Security and data preservation

**Status: PARTIALLY COMPLETE.**

- RLS and owner guards: `src/lib/supabase/guard.ts`, `src/middleware.ts`, and per-route owner
  checks (`src/lib/owner/page-context.ts`). Route-level guard ratchet exists and passes.
- Member and record preservation: `scripts/member-preservation.mjs` (`npm run preserve:members`)
  snapshots members and invitations **and now row counts for 47 user-data tables** (`447e091`).
  Before that, a migration or restore that emptied assignments, notebooks or research still
  printed "Members and invitations preserved", so the most permanent data was the part nothing
  watched. Losing rows in any table, or a table vanishing entirely, now fails the comparison.
  The comparison is self-tested offline against 4 planted losses and 4 legitimate changes that
  must be ignored (growth, unchanged, new table, acknowledged deletion). A run against a real
  database is **NOT TESTED** - no Supabase credentials exist here, so the counting itself is
  unexercised.
- Cache policy (`caf476c`): `/api/*` and member page groups now answer `no-store, private`.
  Verified against the running built server, including the negative: with the rule removed and
  the app rebuilt, `/api/notifications` returns no cache header and the suite reports 76/77.
  Public pages keep their caching (`/terms` still `s-maxage=31536000`), so the rule is scoped.
- `src/app/robots.ts` (`caf476c`) disallows member areas and the first-run setup page. It is
  advisory only: those paths are already gated by the middleware, and the file says so.
- Live cross-user testing against a separate Supabase project: **BLOCKED**. No test project
  credentials exist in this environment; the directive forbids using production.
- Migrations `0042` (notifications) and `0043` (member phone): additive and reviewed, **not
  applied to production**. Applying them needs owner authorisation; see
  `docs/PRODUCTION_ACTIVATION.md`. Presence of the file proves nothing and is not treated as
  applied.
- Backup verification: **NOT TESTED**. `npm run backup:plan|run|verify` exist, but no backup has
  been restored and checked here, so none is called verified.

## Phase 4 - External integrations

**Status: PARTIALLY COMPLETE / BLOCKED on credentials.**

- Google Docs and Microsoft Word: implementation present (`src/app/api/integrations/*`,
  `src/lib/integrations/history.ts`). Real-account verification **BLOCKED**: no Google or
  Microsoft credentials in this environment.
- The absolute rule in `src/lib/integrations/history.ts` that OAuth tokens never enter an event
  is intact and asserted.
- Research providers: code and policy present (`src/lib/research/`, `src/app/api/research/`);
  behaviour with a live provider **BLOCKED** (no `SEARCH_API_KEY`). The policy refuses restricted
  material and SSRF destinations in code.
- Invitation delivery: truthful reporting enforced (`src/lib/owner/invitation-actions.ts`);
  "sent" only on provider confirmation, copy-link fallback otherwise. Live email delivery
  **BLOCKED** (no Resend configuration here).

## Phase 5 - Academic intelligence

**Status: PARTIALLY COMPLETE - engine preserved.**

- Academic levels, writing-profile learning, style suggestions, math verification and the
  readiness gate are unchanged; their tests pass.
- Approval-based learning, per-member isolation and correction scoping are asserted in tests.
- Document history reflects observed provider revisions only (**NOT TESTED** against a live
  provider; the prohibition on fabricated revisions is enforced in code and tests).
- Remaining: nothing identified as broken. The gap is live-provider verification, which is the
  Phase 4 blocker.

## Phase 6 - Release verification

**Status: PARTIALLY COMPLETE.** Documentation reconciled in this branch.

- `docs/RELEASE_GATE.md` said "The 39 checks" and listed 41 out of order; the gate registers 41.
  Fixed, and a test now fails if the document and the gate disagree on the count or numbering.
- Automated suite, build, smoke, secrets: passing (see baseline table).
- Physical devices: **NOT TESTED**. No device testing was performed; `docs/DEVICE_ACCEPTANCE.md`
  remains a matrix of what is outstanding.
- Production deployment check: **NOT TESTED**. `docs/PRODUCTION_ACTIVATION.md` records an older
  deployed commit (`c10a769`); this branch has not been deployed, and no claim is made that the
  owner navigation or theme work is live.

---

## Owner actions

1. Authorise migrations `0042` and `0043` after the documented backup check. Nothing is applied
   without that authorisation.
2. Provide a separate Supabase test project (URL plus service key entered in the platform's
   secret form, never in chat) to unblock live cross-user security testing.
3. Connect Google, Microsoft and a search provider if live integration verification is wanted.
4. Grant explicit deployment approval when the redesign is ready to go live.
