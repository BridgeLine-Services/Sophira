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
- Role filtering uses the `minimum` declared on each entry, which mirrors the server checks in
  `src/lib/auth/permissions.ts`. A Co-Owner sees `co_owner` and `tester` entries only.
- Each statistic has one authoritative loader in `src/lib/owner/`. Summaries on `/owner` call
  the same loaders as the detail pages; no figure is computed twice.
- Unreadable data renders as "cannot be read right now", never as zero.

## Remaining consolidation work

1. Fold the duplicate member-count and invitation-count reads on `/owner` into `loadOwnerRoster`
   where they currently re-query.
2. Move the AI providers summary on `/owner` behind the same guard as `/owner/ai-providers`
   so the two cannot disagree.
3. Plain-language sweep of the remaining technical strings on health and status pages.
