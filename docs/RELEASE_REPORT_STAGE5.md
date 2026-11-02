# Stage 5 release report — regression, accessibility, production readiness

**Date:** 2026-11-02 · **Branch:** `master` · **Commit at verification:** `1c5f530`
**Surface:** 61 pages · 82 API routes · 41 migrations · 4,462 automated assertions

This is a release-verification report. Nothing was deployed, no production database
policy was changed, and no provider priority, subscription behaviour or AI model
configuration was altered.

---

## 1. Required release checks

| Check | Command | Result |
|---|---|---|
| Clean install | `npm ci` | **PASS** (exit 0, from lockfile) |
| Lint | `npm run lint` | **PASS** — 0 errors, 107 warnings (all pre-existing and pinned) |
| Types | `npx tsc --noEmit -p tsconfig.json` | **PASS** (exit 0) |
| Tests | `npm test` | **PASS** — 4,462 passed, 0 failed |
| Build | `npm run build` | **PASS** — compiled, all routes emitted |
| Repo verification | `npm run verify` | **PASS** |
| Secret scan | `npm run scan:secrets` | **CLEAN** (4 artifact dirs, 4 secret names) |
| Release audit | `node scripts/stage5-audit.mjs` | **PASS** (see §6, §7) |

A green build alone does not prove the app works. Section 9 states plainly what was
executed and what was not.

---

## 2. Features implemented (Stage 4, verified here)

- **Gradual insertion** with pause, continue, stop and conflict handling, driven by a
  pure tested state machine. Progress counts only characters the provider confirmed.
- **Revision-guarded chunked writes**: a document that changed underneath produces a
  conflict, never an overwrite.
- **Recovery copies**: stopping, conflicting or failing stores the unwritten remainder
  as a real snapshot and records `recovery_copy_created`.
- **Plain-language activity timeline** replacing raw event codes, including the honest
  statement that Sophira cannot tell who changed a document outside it.
- **Honesty guarantees enforced by test**: no `setTimeout`, no `Math.random`, no typo or
  typing-simulation machinery anywhere in the insertion path.

## 3. Existing functionality preserved

No route was removed, no response contract changed, no AI provider routing or model
configuration touched. Manual insertion, single-shot `doc-update`, Microsoft discovery,
replacement, version listing and restore are unchanged. Students who never connect
Canvas, Google or Microsoft keep every original workflow.

---

## 4. Complete functionality inventory

Status legend: **OK** = present and covered by automated tests · **PARTIAL** = present
with a stated gap · **NOT LIVE** = code complete but no live provider call executed.

| # | Capability | Status | Evidence |
|---|---|---|---|
| 1 | Authentication | OK | `/login`, `/reset-password`, middleware; `auth-redirect-loop`, `owner-auth-flow` |
| 2 | Account creation & invitations | OK | `/signup`, `/create-owner`, `/api/invitations/accept`; `invite-form`, `invitation-delivery` |
| 3 | User permissions | OK | 48/48 tables RLS-enabled, 61 policies, `/access-denied`; role tests |
| 4 | Dashboard | OK | `/dashboard`, `OwnerDashboard` |
| 5 | Navigation | OK | `AppShell` with skip link and `main` landmark (asserted by test) |
| 6 | Course management | OK | `/courses`, `/courses/new`, 8 subject routes; `course-engine` |
| 7 | Teacher profiles | OK | `/teachers`, `[id]`, `/new`, `TeacherProfileEditor` |
| 8 | Assignment creation | OK | `/assignments/new` |
| 9 | Assignment workspaces | OK | `/assignments/[id]`, `/proposals` |
| 10 | Canvas integration | NOT LIVE | `canvas.ts`, `canvas-sync.ts`, 5 routes, `CanvasPanel`; tokens stored server-side only |
| 11 | AI conversations | OK | `/tutor`; `providers`, `essay-pipeline` |
| 12 | AI provider selection | OK | `/setup`, `/settings`; `providers` tests |
| 13 | Writing assistance | OK | `/writing/*`, typing profile module |
| 14 | Originality review | OK | `originality.ts`, `/writing/review`; findings are offsets, never fake percentages |
| 15 | Citation verification | OK | `adversarial-citations` (hostile inputs refused) |
| 16 | Research | OK | `/notebooks/[id]` research flow; `notebook` tests |
| 17 | Document extraction | OK | `/api/extract`; `doc-bench`, `pdf-fragility` |
| 18 | Google Docs | NOT LIVE | 9 routes; live insertion unexercised (no owner OAuth here) |
| 19 | Microsoft Word | NOT LIVE | 7 routes; live Word flow unexercised |
| 20 | Document history | OK | `document_history`, owner-scoped; Stage 4 suite |
| 21 | Recovery | OK | Recovery copies, snapshot download, guarded restore |
| 22 | Learning & personalization | OK | `/learning`, writing profiles; academic-only scope enforced |
| 23 | Notifications | **PARTIAL** | No notification centre or push. In-app toasts (35 files) and email digests (9 files) only |
| 24 | Offline | OK | `/offline`, `public/sw.js`, `manifest.webmanifest`; `offline` tests |
| 25 | Mobile | OK | Responsive breakpoints across the app, `100dvh` handling, `/install` |
| 26 | Desktop | OK | Same responsive app; PWA install |
| 27 | Administrator | OK | `/owner`, `/owner/health`, `/owner/integrations` |

**Gap stated plainly:** item 23 is the only capability with no dedicated
implementation. If notification delivery is a release requirement, it is missing work,
not untested work.

---

## 5. Non-technical user experience

- Raw provider errors, stack traces and OAuth internals are **absent from user-facing
  copy**: asserted by test across all app components.
- The error boundary catches render failures, prints no error text, and offers "Try
  again" and "Go to dashboard".
- A friendly not-found page was **added in this stage** (`/not-found`); previously a
  stale link fell through to Next's bare default.
- Two pages explained storage using the phrase "row-level security". That is schema
  vocabulary and now reads "only your account can read them".
- Empty states, progress indicators and confirmation messages exist on the main
  workflows (documents, research, writing review, offline queue).

---

## 6. Security checks

| Check | Result |
|---|---|
| RLS coverage | **48 of 48 tables** have row level security enabled; 61 policies |
| Client bundle exposure | 173 chunks scanned: **no** service-role, client-secret or `provider_connections` reference |
| Provider tokens in browser | Not present. The only token field references are Supabase GoTrue's own session client |
| Service-role routes | 6 routes use the admin client; **all** authenticate the caller (`requireUser` or server-verified `supabase.auth.getUser`) |
| Cross-user access | RLS authoritative on every table; `another user` / isolation assertions in `course-engine`, `hostile-audit`, `notebook`, `run` |
| Hostile content & prompt injection | `hostile-audit` suite; retrieved content treated as data, never instructions |
| Expired / revoked session | `auth-redirect-loop` (no redirect loops, safe landing) |
| Unauthorized document / assignment access | Owner-scoped queries; `document-history` asserts no service-role client in the gradual route |
| Insecure restoration | Restores are revision-guarded and record `restore_attempted` / `restore_refused` |
| Secret scan | CLEAN |

No production database policy was modified in this stage.

---

## 7. Accessibility checks

Verified structurally by the new `tests/accessibility.ts` (14 assertions):

- **Form labels:** 33 form controls; every one now has a programmatic name. **13 were
  unlabelled** (visible label or placeholder only, announced as "edit text") and were
  fixed across 7 files.
- **Keyboard focus:** one global `:focus-visible` rule draws a 2px ring with offset;
  asserted to never remove the outline without replacing it.
- **Reduced motion:** `prefers-reduced-motion` sets animation-duration to 0.01ms and
  scroll-behavior to auto. Asserted, not assumed.
- **Dialogs:** declare `role="dialog"` with a name or `aria-modal`.
- **Skip link and landmarks:** present in the shell (pre-existing test).
- **Responsive:** breakpoints used broadly; `100dvh` for mobile viewport.
- **Icon-only buttons:** none lack a label in the guard's scope.

**Limitation:** these are structural guards. No manual screen-reader pass (VoiceOver /
NVDA) and no automated axe run were executed, so contrast and reading order are
**not** certified by this report.

---

## 7a. Runtime verification (added after the checks above)

Every check listed in §1 inspects source or a build artifact. None of them starts the
server, so none could see a page that compiles but renders blank. This was closed by
`scripts/smoke-runtime.mjs` (`npm run smoke:runtime`), which boots the production build,
requests real URLs and asserts on the responses. It needs no credentials.

**Result: 26/26 checks pass.** Public pages return 200 with real content, a document
title and no error boundary; the four protected routes fail closed with a 307 to
`/login`; an unknown URL never renders an authenticated shell to a signed-out visitor;
the stylesheet is served (43,824 bytes) and carries the theme tokens.

**Defect found and fixed by this pass:** `/login` was a client component using
`useSearchParams` inside a `<Suspense>` with **no fallback**, so the server sent an
empty body (9,079 bytes of metadata and nothing else). On a slow connection, or with
JavaScript blocked, a student saw a blank page with no explanation and no way forward.
The page now server-renders its heading, a `role="status"` loading line, and a
`<noscript>` message telling the user to enable JavaScript or ask for help. After the
fix the same URL sends 9,830 bytes containing the sign-in heading.

This is exactly the class of failure a green build cannot reveal, and it is why §11's
limitations list no longer says "never executed at runtime".

## 8. Database migrations

**None added in Stage 4 or Stage 5.** The two new event types reuse existing text
columns. Total migrations stay at 41. Nothing to reverse, nothing to review for policy
changes.

---

## 9. Automated test results

```
npm test → 4,462 passed, 0 failed, 4,462 total
```

Growth: 4,368 (Stage 3) → 4,441 (Stage 4 core) → 4,448 (offset regression) →
4,462 (+14 accessibility).

Regression coverage includes: the original workflows, students with **no** Canvas,
Google or Microsoft connection, AI provider failure paths (work is not destroyed),
partially completed operations resuming from a provider-confirmed offset, and the
documented absolute prohibition that OAuth tokens never appear in any event.

## 10. Live integration results

**None executed. This is the most important limitation in this report.**

| Integration | Status | Why |
|---|---|---|
| Google Docs | **NOT RUN** | No owner OAuth registration and no real document in this environment |
| Microsoft Word | **NOT RUN** | Same |
| Canvas LMS | **NOT RUN** | Requires a real institution instance, client credentials and a student account |
| AI providers | **NOT RUN live** | Contract-level tests only; no paid provider call was made |

Exact tests that could not run live: the provider-dependent blocks in
`tests/document-history.ts`, `tests/provider-integrations.ts`, `tests/document-selection.ts`,
`tests/offline.ts`, `tests/owner-system-health.ts`, `tests/canvas` coverage, and
`tests/providers.ts` live-call cases.

Mock and contract tests are reported as mock and contract tests. They are **not**
substituted for live verification anywhere in this document.

---

## 11. Known limitations

1. Live provider flows are unverified (see §10). The code is build-verified and wired,
   not hardware-tested.
2. 107 lint warnings remain (dead code and two hook-dependency cases). Running builds,
   real debt.
3. No manual screen-reader or contrast certification.
4. Canvas sync has never ingested a real course.
5. Notifications are toasts and digests only.

## 12. Outstanding defects

| Severity | Defect | Status |
|---|---|---|
| Medium | No notification centre; item 23 of the inventory is unimplemented | Open, disclosed |
| Low | 107 lint warnings (102 unused vars, 5 hook deps) | Open, pinned so they cannot grow |
| Low | Accessibility verified structurally only | Open, disclosed |

No defect found in this stage was left silently unfixed: the four real issues found
(unlabelled controls, schema jargon, missing 404, absent global focus assertion) were
fixed and are covered by new tests.

## 13. Rollback

- Stage 5 accessibility work: `git revert 1c5f530`.
- Stage 4 document work: `git revert d87c324 c3491ba b317056` (newest first).
- No migration to reverse; no production data written or rewritten. Recovery copies
  already created remain readable because their storage format is unchanged.

## 14. Deployment recommendation

**All required repository checks passed.** That is necessary but not sufficient.

**Recommendation: deploy to staging, then production after the live smoke tests.**

Blocking smoke tests before production:

1. Connect Google in staging and insert approved text into a real Doc; verify the
   timeline shows pending → confirmed, and that stopping preserves a recovery copy.
2. Repeat for Microsoft Word, including one deliberate conflict.
3. Connect Canvas in a sandbox course and confirm assignments land once (no duplicates)
   and that unrelated students' assignments are invisible.
4. Confirm one AI provider failure mid-operation leaves the student's work intact.

Automated evidence says the application is stable and its guarantees hold. It does not
say the integrations work against the real services, because they were never called.
Ship to staging now; ship to production after those four checks.
