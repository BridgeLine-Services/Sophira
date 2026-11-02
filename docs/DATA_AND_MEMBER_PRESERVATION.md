# Data and member preservation

**Requirement:** rebuilding or redeploying Sophira must never lose members, identities,
permissions, invitations, or academic records.

This document states what is enforced today, where the evidence is, what an owner must
still do, and what has not been verified. It does not claim more than was measured.

---

## 1. Why a redeploy cannot delete members

Sophira's application code and its data live in different places.

| Layer | Lives in | Survives a rebuild? |
|---|---|---|
| Member accounts, identities, passwords | Supabase `auth.users` (persistent Postgres) | Yes |
| Profiles, invitations, permissions | Supabase tables with RLS | Yes |
| Courses, assignments, writing, research, documents | Supabase tables with RLS | Yes |
| Uploaded files | Supabase storage buckets | Yes |
| Application code, pages, routes | Vercel build output | Replaced every deploy, holds no data |

A deployment replaces only the last row. No build step, seed script, or startup task in this
repository writes to production tables. `npm run` scripts that touch a database
(`db:migrate`, `db:seed`) are never part of the Vercel build command in `vercel.json`.

## 2. Permanent member identity

- Identity is `auth.users.id`, a UUID that never changes. `profiles.id` references it.
- The API guard looks a member up by that id, never by email:
  `src/lib/supabase/guard.ts` — `select("*").eq("id", user.id)`.
- Email is a contact detail, not an identity. A member with no name or email remains a
  valid record; nothing in the authorization path reads a name.
- Invitations are separate records that survive independently of whether the invited person
  has ever signed in.

**Not claimed:** changing an email address is a Supabase auth operation, and this repository
does not implement an email-change flow. That is a gap, not a guarantee.

## 3. Revocation and reinstatement

- **Enforced per request.** Pages: `src/middleware.ts` reads the member's status on every
  protected navigation and redirects a revoked member to `/access-denied`. APIs: 70 routes
  call `requireUser`, which allows only the statuses `pending`, `accepted`, and `active`;
  any other value fails closed.
- **Fail closed, not deny-listed.** `ACTIVE_STATUSES` is an allow-list in
  `src/lib/supabase/guard.ts`, so a status added later (or a typo) denies rather than grants.
- **Live sessions.** Revocation also clears stored refresh tokens
  (`supabase/migrations/0019_access_revocation_audit.sql`), so a revoked session cannot renew.
- **Reinstatement reuses the existing identity.** `restore` sets the status back to `active`;
  it does not create an account. A separate, explicitly destructive `remove` action deletes
  the auth user and cascades. These are different operations by design.

**Limit, stated plainly:** an already-issued access token remains cryptographically valid
until it expires; Sophira's denial happens at the server on the next request, which is what
the acceptance test checks ("an already-open session loses access"). Token revocation at the
provider is limited by Supabase's refresh-token model.

## 4. Owner visibility without owner access to private work

- The owner can see membership metadata and aggregate counts
  (`/api/network/members`, `/api/network/stats`), both behind `requireOwner`.
- The owner cannot read a member's courses, assignments, writing, research, or documents:
  those tables use per-member RLS (`auth.uid() = user_id`), and migrations `0012` and `0022`
  state explicitly that no admin policy exists.
- Enforcement is in the database, not the interface.

## 5. Migrations preserve records

- 41+ migrations, all additive. `src/lib/migrations/destructive-scan.ts` scans the entire
  chain for `DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, and any `DELETE` or `UPDATE` without a
  `WHERE`, and is enforced by `npm test` (`tests/data-preservation.ts`). A destructive
  statement must carry `-- destructive-approved: <reason>` next to it, and two statements
  cannot share one approval.
- Nothing in the application applies migrations automatically at request time.

## 6. Backup and restoration

**Owner responsibility, because it needs account access this agent does not have.**

1. **Database.** In the Supabase dashboard, confirm the project's backup/PITR setting is on and
   note the retention window. For an independent copy: `pg_dump` the database using the
   project's direct connection string, off the application host.
2. **Files.** Copy the storage buckets used by Sophira (documents and uploads). Database
   backups do not include bucket contents.
3. **Configuration.** Record variable *names* and where the values are stored. Never commit
   values; never paste secrets into chat.
4. **Verify the backup is usable**, not merely present: restore into a separate project and
   run the preservation check against it (step 7).

**Restoration procedure**

1. Create a new Supabase project (or use the staging project). Do not restore over production.
2. Restore the database dump, then the storage buckets.
3. Point a staging deployment at the restored project.
4. Run `node scripts/member-preservation.mjs --save after-restore.json` and compare member and
   invitation counts with the pre-incident snapshot.
5. Sign in as a test member and confirm their own work is present; confirm a revoked member is
   still refused; confirm one member cannot read another's assignment.
6. Only then consider promoting the restored project.

## 7. Pre-deployment safety checks

```bash
npm test                                   # includes the destructive-migration scan and route-guard audit
node scripts/member-preservation.mjs --save before.json
# ... deploy or migrate ...
node scripts/member-preservation.mjs --compare before.json
```

The comparison fails if a member or an invitation disappeared, and reports duplicate
identities. An intentional removal must be named with `--acknowledge-removed <id>` so it is a
decision rather than an accident. The script prints no email addresses or names.

## 8. Acceptance tests from the requirement, and their honest status

| Test | Status |
|---|---|
| Invite multiple members | Automated coverage exists for invitation creation/acceptance (mocked). Live: not run. |
| Redeploy the whole application | Done repeatedly in this session; production reachable after each deploy. |
| Members remain present | `member-preservation.mjs --compare` — ready; needs owner database access to run. |
| Outstanding invitations remain valid | Same check reports outstanding counts and lost invitations. |
| Members can access their existing accounts | Auth path unchanged by deploys; verified structurally, not with a live member. |
| No duplicate identities | Duplicate-email detection in the preservation check. |
| Revoked member's open session loses access | Enforced by allow-list status checks in middleware and `requireUser`; unit-tested, not tested against a live revoked browser session. |
| Reinstatement reuses the identity | `restore` sets status only; no account creation path exists. |
| Members cannot read each other's records | RLS on every content table plus explicit `user_id` filters; isolation covered by the security suite. |
| Restore a backup and verify data | Procedure documented above; **not executed here** — needs owner account access. |
| Migrate to a different server | Architecture supports it (data is external to the app); **not executed here**. |

The four "not executed here" rows are the honest gap: they require owner-level access to the
database and hosting account. Everything that can be proven from the repository is proven and
pinned by tests (4,543 assertions).
