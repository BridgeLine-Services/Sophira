# Sophira professional reskin — implementation report (2026-11-12)

Branch `feat/professional-reskin`, based on `master` = `e1c0de4` (the commit
production served when this phase began). **Production was not deployed.**

## 1. Commits

- Base: `e1c0de4`
- Final: the tip of `feat/professional-reskin` (this report is in its last commit)
- Preview deployment: not created. Pushing the branch is the only deployment step taken.

## 2. Every modified file, and what changed in it

### Design system
| File | Visual change |
|---|---|
| `src/app/globals.css` | Per-theme elevation (`--elev-1/2/3`, `--elev-accent`), hero gradient variables, and one component layer: page frame, panels, stat tiles, nav rows, callouts, segmented controls, status dots, refined `data-table`. `.dash-*` re-skinned from purple-on-white to the teal/charcoal hero with **theme-aware** panels. Token values unchanged. |
| `tailwind.config.ts` | Radius (`panel`, `tile`), elevation (`e1/e2/e3/accent`), readable type ramp, `max-w-content` 78rem, `ease-calm`. |

### Shared primitives (public props unchanged)
`Button.tsx` (accent primary with tinted elevation, card-weight secondary, 44px md),
`Card.tsx` (panel radius, per-theme shadow), `Badge.tsx` (hairline ring),
`Input.tsx` (teal focus, hover border, 44px floor), `EmptyState.tsx` (accent icon
disc), `Toast.tsx` (panel weight), `ConfirmDialog.tsx` (wider panel, blurred scrim,
stacked actions on phones).

### Shell
`src/components/app/AppShell.tsx` — 256px sidebar rail on `bg-sidebar` with a brand
lockup, labelled navigation groups, `.nav-item` rows with an accent indicator, a rank
card, `bg-topbar` header, aligned tablet row, `bg-sidebar` drawer with the same brand
lockup, and a bottom bar with an active pill. Same registries, same role filters, same
four renderers, same destinations.

### Operator console
`src/app/owner/page.tsx` — administrative overview as a stat grid, "Needs attention"
as a real panel with a tone dot per item, token-based callouts, provider tables.
`src/components/app/OwnerDashboard.tsx` — stat grid plus twelve management
destinations as one grouped list of panel rows.

### Everything else (mechanical, same guarantees)
`src/app/access-denied`, `co-owner`, `courses/[id]`, `dashboard`, `downloads`,
`lectures`, `notifications`, `offline`, `owner/ai-operations`, `owner/analytics`,
`owner/backup`, `owner/features`, `owner/qa`, `tester`, `writing` pages, plus
`components/app/CanvasAssignmentContext`, `DocumentBrowser`, `MemberDirectory`,
`ReadinessPanel`, `SystemHealthPanel`, `WritingReviewWorkspace`,
`components/owner/AnnouncementComposer`, `OwnerAreaGrid`, `teachers/[id]/TeacherProfileEditor`:
repair of utility names that resolved to no colour (`text-muted-foreground`,
`border-destructive`, `bg-destructive`), raw emerald/amber status squares replaced by
tokens, one section-heading style, panel surfaces, `data-table` on static tables.

### Tests (updated, never deleted)
`tests/self-healing-provision.ts` (rail width `w-64`, offset `lg:pl-64`),
`tests/course-engine.ts` (menu-button class, `max-w-content` ceiling, `meta-strong`
heading, `#overview` anchor location), `tests/prod-fixes.ts` (same anchor). Each
assertion keeps its original guarantee and documents why it moved.

## 3. Routes visited by the reskin

`/`, `/access-denied`, `/co-owner`, `/courses/[id]`, `/dashboard`, `/downloads`,
`/lectures`, `/notifications`, `/offline`, `/owner`, `/owner/ai-operations`,
`/owner/analytics`, `/owner/backup`, `/owner/features`, `/owner/qa`, `/tester`,
`/writing`, `/teachers/[id]`. Recorded as **partial** in
`docs/redesign-status.json` (23 routes), never "complete".

## 4. Verification actually run

| Check | Result |
|---|---|
| `npm test` | 7705 / 7705 pass |
| `npx tsc --noEmit` | clean |
| `npm run lint` | 0 errors, 33 warnings (pinned ceiling) |
| `npm run build` | success |
| `node scripts/design-drift.mjs` | 0 literal colour utilities |
| `node scripts/inventory.mjs` | 80 pages, 101 API routes — matches the tree |

## 5. Not verified, and why

- **No browser inspection at all.** No test accounts exist, so no signed-in page
  could be opened; `/login` was not captured either. Light mode, dark mode, desktop,
  tablet and mobile are therefore **unverified by eye**, and the acceptance list in
  the directive is not claimed.
- **Native shells (Capacitor/Tauri) not exercised.** No simulator or device build was
  run; only the web source changed, and no `capacitor.config.ts` / `src-tauri` file.
- **Owner-only flows** (approve an invitation, revoke a member) need the owner's
  session; the server-side authorization code was not touched.
- **Two spec items still have no infrastructure** and none was invented: user-created
  reminders and a learning-events calendar.
