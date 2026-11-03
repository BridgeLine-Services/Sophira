# Turning the latest work on in production

Written 2026-11-03. Updated whenever a step is genuinely completed — not when code is pushed.

## Where things stand today

| Thing | State | Evidence |
|---|---|---|
| Application deployed | **LIVE** at commit `c10a769` | `node scripts/production-verification.mjs` → Application PASS |
| Private file storage | **WORKING** | same run → Private storage PASS (a real read succeeded) |
| Signing in | **WORKING** | same run → Signing in PASS |
| Closed to strangers | **WORKING** | `/api/notifications` returns 401 without a session |
| Notification page reachable | **WORKING** (redirects to sign-in) | `/notifications` returns 307, route exists |
| Notification **list** | **NOT LIVE** | migration `0042` has not been applied; the page has no table to read |
| Live privacy tests (RLS, isolation) | **NOT RUN** | no test-project credentials in this environment |
| GitHub branch head readable | **BLOCKED** | repository token is not available to the checking environment |

The single thing standing between the dashboard work and being genuinely live is one
migration. Everything else is either already working or waiting on credentials only you hold.

## Is applying it safe?

Yes, and this was checked rather than assumed. `0042_member_notifications.sql` contains
**zero** destructive statements (no `drop`, `truncate`, or `delete`). With `if not exists`
guards throughout it creates:

- `member_notifications` and `notification_preferences` tables
- one index for unread counts
- four row-level policies, all scoped to the signed-in member

No existing table is altered. Applied twice, it does nothing the second time.

## Owner steps

1. **Get the service key.** In Supabase, open your project, then Settings → API, and copy the
   key labelled `service_role`. Treat it like a master key: it bypasses every privacy rule,
   so it goes into your hosting settings, never into a browser, chat, or document.
2. **Put it where the app runs.** In Vercel, open the project, then Settings → Environment
   Variables, and add `SUPABASE_SERVICE_ROLE_KEY` for Production. Also confirm `SUPABASE_URL`
   is present.
3. **Apply the migration.** Run `npm run db:migrate` from a machine holding that key. It
   applies only migrations not already recorded, so it will run `0042` and nothing more.
4. **Check it took.** Sign in and open Notifications. Before this step the page cannot list
   anything; afterwards it shows your real notifications, and the bell shows an unread count.
5. **Re-run the checks.** `node scripts/production-verification.mjs` should now report
   Notifications as live rather than partial, and `node scripts/release-gate.mjs` should lose
   one BLOCKED row.

## How to know it worked

- Notifications lists items, and marking one read survives a page reload.
- A second member sees only their own notifications. This is the privacy rule that matters;
  check it with two accounts before telling anyone the feature is on.
- `npm test` still passes (4,734 assertions), because none of this changes application logic.

## If something goes wrong

The migration is additive, so the safe retreat is: redeploy the previous commit, which
ignores the new tables. Dropping them is only safe while they are empty; once members have
read notifications, dropping them destroys real data. Application rollback and database
rollback are separate operations — see `docs/BACKUP_RECOVERY.md`.

## Still blocked, and by whom

| Check | Blocked on |
|---|---|
| Live RLS and member-isolation matrices | `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY` for a **separate test project** |
| GitHub branch-head comparison | a repository token available to the verification environment |
| PWA on real phones | a physical Android and iPhone |
| Native build | `SOPHIRA_APP_URL` for a release APK |

None of these are code problems. Each needs one credential or one device from you.
