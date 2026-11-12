# Owner administrative routes: inventory and target grouping

Engineering directive, Phase 1.1-1.2. Counted from `src/app/owner/*/page.tsx`, not from memory.

## The actual routes (18 total: overview + 17 sub-pages)

| Route | Target group |
| --- | --- |
| `/owner` | A. Executive overview |
| `/owner/members` | B. People and access |
| `/owner/invitations` | B. People and access |
| `/owner/requests` | B. People and access |
| `/owner/announcements` | B. People and access |
| `/owner/qa` | B. People and access |
| `/owner/health` | C. Platform operations |
| `/owner/status` | C. Platform operations |
| `/owner/features` | C. Platform operations |
| `/owner/ai-operations` | C. Platform operations |
| `/owner/integrations` | C. Platform operations |
| `/owner/security` | D. Security and protection |
| `/owner/activity` | D. Security and protection |
| `/owner/analytics` | E. Business and network intelligence |
| `/owner/backup` | F. Reliability and release |
| `/owner/release-readiness` | F. Reliability and release |
| `/owner/database` | F. Reliability and release |
| `/owner/ai-providers` | Owner-exclusive (C, no Co-Owner link) |

## Rules applied to the consolidation

- No page is deleted and no URL changes, so every bookmark and direct link keeps working.
- `/owner` links to each group from ONE grid (`OwnerAreaGrid`), fed by `OWNER_NAV_GROUPS` in
  `AppShell.tsx`: the sidebar and the dashboard read the same list, so they cannot drift.
- Role filtering uses the audience declared on each entry - `minimum` (a rank floor), `roles`
  (an exact audience) or neither (Owner-only) - which mirrors the server checks in
  `src/lib/auth/permissions.ts` and `src/lib/owner/page-context.ts`. A Co-Owner sees their own
  dashboard, the member-facing pages and QA triage, and nothing else.
- Each statistic has one authoritative loader in `src/lib/owner/`. Summaries on `/owner` call
  the same loaders as the detail pages; no figure is computed twice.
- Unreadable data renders as "cannot be read right now", never as zero.

## Remaining consolidation work

1. Fold the duplicate member-count and invitation-count reads on `/owner` into `loadOwnerRoster`
   where they currently re-query.
2. Move the AI providers summary on `/owner` behind the same guard as `/owner/ai-providers`
   so the two cannot disagree.
3. Plain-language sweep of the remaining technical strings on health and status pages.

## The four ranks and where each one lands (2026-11-12)

One resolver answers this for the whole application: `src/lib/navigation/role-home.ts`. The
sidebar, the tablet row, the phone drawer, the bottom bar, the logo link and the "back" button all
read it, so they cannot disagree.

| Rank | Dashboard (menu entry) | Route | Environment |
| --- | --- | --- | --- |
| Owner | Owner Dashboard | `/owner` | administrative |
| Co-Owner | Co-Owner Dashboard | `/co-owner` | administrative |
| Tester | Tester Dashboard | `/tester` | academic workspace |
| Member | none - their home is `/dashboard` | - | academic workspace |

- Nobody is shown another rank's dashboard. An unknown or unreadable rank gets **no** dashboard
  entry, and the side panel prints no rank label rather than guessing one.
- The side panel names the rank ("Signed in as Co-Owner").
- A visible link is never the security boundary: every route refuses an unauthorised rank on the
  server (`requireOwnerPage`, `requireStaffPage`, `canUseTesterFeatures`, or an explicit
  `profile.role` check in the page).
- The Co-Owner's staff menu is: Co-Owner Dashboard, Announcements, Members, Invitations, Requests,
  QA triage, My Workspace. Network analytics, activity, AI operations, security, database, backup,
  release readiness, AI providers and integrations stay Owner-only, and are therefore not offered
  to a Co-Owner at all - a link that bounces you back is worse than no link.
