# Owner-Controlled Access — How Sophira's Access System Works

Sophira is a private academic AI network owned by one designated owner.
This document explains the full access-control system: how the owner
account is created, how to identify it, how access revocation and
reinstatement work, and how every enforcement point is server-side.

## Roles

There are four roles, stored in `public.profiles.role` (migration 0048).
The full rules live in **docs/MEMBERSHIP_ROLES_AND_PRESENCE.md**; this is
the summary:

| Role | Meaning |
|---|---|
| `owner` | The single designated owner. The only role that can appoint or demote another Owner, change a Co-Owner into an Owner, suspend or remove a Co-Owner, or edit security settings. |
| `co_owner` | Staff. Sees the member directory, invites people, and suspends or removes Users and Testers. **Cannot** act on an Owner or another Co-Owner, cannot appoint anyone, and cannot promote themselves. |
| `tester` | A member with access to approved testing features plus the normal member workspace. No membership authority. |
| `user` | A regular invited member. Their academic data is private to them — even the Owner and Co-Owners cannot read it. |

Two limits are enforced in the database, not in the interface:

- **The last Owner cannot be demoted.** An installation always keeps one
  Owner, so there is never an installation nobody can administer.
- **Nobody can change their own role.** A User cannot promote themselves,
  and an Owner cannot quietly hand themselves extra rights. Ordinary
  profile edits (name, phone, availability) still work normally.

Every role change is written to `public.membership_audit`: who acted, who
was affected, the old role, the new role, when, and why.

## How the initial owner account is created

Signup is invitation-only at the DATABASE level (migrations 0008 +
0025). The first-owner bootstrap is **in-app and atomic**:

1. With no owner yet, the sign-in screen shows **Create Owner Account**
   (also at `/create-owner`, linked from `/setup`). No database editing
   and no API keys are required.

2. The owner registers with their email and a password they choose. The
   database trigger claims the single owner slot ATOMICALLY
   (`public.owner_bootstrap` is a one-row table with `INSERT ... ON
   CONFLICT DO NOTHING`): exactly one owner can ever exist, simultaneous
   registrations cannot create two owners, and once claimed the window
   closes permanently. Later signups all require valid invitations.

3. An OPTIONAL restriction remains supported: if an operator HAS
   configured `app_config.owner_email`, the claim is restricted to that
   exact address. This is no longer required.

4. No password is hardcoded in source, and the owner claim is invisible
   to every browser (revoked from anon/authenticated, RLS with no client
   policies).

**No plaintext owner password exists anywhere in the codebase.** The
owner sets their password themselves through the normal signup form,
stored only by the configured authentication provider (Supabase Auth).

**Email confirmation (2026-10-07).** If the Supabase project has email
confirmation enabled (the default), a successful registration does NOT
mean the owner is signed in - Supabase returns no session until the
email address is confirmed. `/create-owner` detects this and shows
"Check your email to confirm your account, then sign in." instead of
redirecting to `/owner`. The created owner account is preserved; after
confirming (the link returns to the app via `/auth/callback`) the owner
signs in normally and is routed to `/owner`. If confirmation is
disabled, Supabase returns a session immediately and the owner is taken
straight to `/owner`. Login failures are classified honestly
(`src/lib/auth-errors.ts`): invalid credentials stay generic, an
unconfirmed email gets confirmation guidance, and server configuration
problems are reported as configuration problems - never as "wrong
password".

## Owner setup status diagnostic (/setup)

Operators get a one-page, pre-auth diagnostic at **/setup** (and a
scriptable **GET /api/setup-status**) that answers, honestly and before
any account exists:

- Is the Supabase connection configured?
- Are the database migrations applied (through 0026)? They are applied
  AUTOMATICALLY: the CI Migrations job (one-time `SUPABASE_ACCESS_TOKEN`
  + `SUPABASE_PROJECT_REF` repository secrets) probes the project and
  applies every missing migration on each push - and the /setup page
  offers a one-click "Repair Setup" when the same variables are set in
  the deployment environment. No SQL editor, no manual SQL.

**Stale-account recovery (2026-10-07).** If an earlier failed attempt
left a real Supabase Auth account without its profile row, Sophira
recovers it automatically: signing in with that account completes it
into the first owner through the database's race-safe claim
(`complete_first_owner`, migration 0026 - only while no owner exists,
only for the signed-in user's own account). If the email cannot be
confirmed anymore, `/create-owner` offers a single "Remove the
incomplete account" action (safe only before the first owner exists).
- Is the optional owner-email restriction configured? (existence only -
  the email value is NEVER displayed; since migration 0025 it is optional)
- Does an owner account exist, and is it active?
- Is owner creation still available (`ownerCreation.possible` - the same
  server-side status that drives the sign-in screen CTA and /create-owner)?
- Is the AI provider configured?

If no owner is initialized, the page leads with **Create Owner Account**
(taking the owner to `/create-owner`, where they choose their own
password — there is no predefined/default owner password). If an owner
already exists, it states the owner account is initialized without
exposing any credential, and links the existing password-reset flow
(`/reset-password`) for recovery.

The diagnostic is public BY DESIGN (the operator must be able to check
bootstrap readiness before any account exists) and reports categorical
booleans only - never keys, tokens, emails, or passwords. It changes no
access control: the bootstrap stays fail-closed, users still cannot
promote themselves, modify their own role, or restore revoked access.

## How the owner logs in

Exactly like any member: `/login` with email + password through Supabase
Auth. The owner has no special login path — their authority comes from
`profiles.role = 'owner'`, checked server-side on every owner action.

## Where the owner role is stored

`public.profiles.role` in your Supabase database — one row per user,
keyed to `auth.users(id)`. To identify the owner account from the
database console:

```sql
select id, display_name, created_at from public.profiles where role = 'owner';
```

In the app, the owner page is `/owner` (redirects non-owners to
`/dashboard` server-side).

## Recovering / changing the owner's credentials

Credentials live with the authentication provider, not in the app:

- **Owner changes their own password:** `/reset-password` (standard
  Supabase Auth reset flow), or Supabase Dashboard → Authentication →
  Users if the owner is locked out of email.
- **Owner email change:** Supabase Dashboard → Authentication → Users →
  the owner row → change email. (Also update `app_config.owner_email` so
  the record stays accurate, though it is only read at bootstrap.)
- **Locked out entirely:** a person with Supabase project access can
  reset the owner's password from the Supabase Dashboard. This is by
  design: the operator/deployer is the trust root.

## How access revocation works

The owner does it from `/owner` → Members → **Revoke access** (or by
calling `POST /api/network/members` with `{"action":"revoke"}`). The
server then:

1. Verifies the caller is authenticated AND active AND is staff
   (`requireStaff` + the shared permission matrix). A Co-Owner may suspend
   a User or Tester; suspending an Owner or another Co-Owner needs the
   Owner. The last remaining Owner cannot be revoked, by anyone.
2. Sets `profiles.status = 'revoked'` and records
   `profiles.access_revoked_at = now()` in the database.
3. Calls the admin sign-out API for that user: ALL their refresh tokens
   are revoked, killing every active session server-side.

From that instant the revoked user is blocked EVERYWHERE, even if they
have the app installed, a session open, or a previously issued token:

- **Middleware** checks `profiles.status` on every protected page
  request and redirects revoked users to `/access-denied`.
- **Every protected API route** independently re-verifies
  authenticated → active access (and role where applicable) via the
  server-side guard BEFORE touching data or AI. This includes direct
  API calls with an old token: the check reads the live database, so a
  token minted before revocation fails the status check.
- Frontend UI hiding is cosmetic only — it is never the security
  boundary. Refreshing, reinstalling, editing client storage, or
  manipulating frontend state changes nothing: authorization state
  (`profiles.status`) lives in the database and is re-checked on every
  server request.

Refresh-token revocation means an old session cannot even refresh
itself; short-lived access tokens expire within the hour, and both
enforcement layers reject revoked users immediately regardless of token
validity.

## How access reinstatement works

Only the owner can do it: `/owner` → Members → **Restore** (or
`POST /api/network/members` with `{"action":"restore"}`). This sets
`status = 'active'` and clears `access_revoked_at`. The member then
signs in again normally. No one else — including the member themselves —
can restore access.

## Permanent removal

The owner can permanently delete a member (Members → trash icon →
confirm). This deletes the auth user, which cascades to ALL their data.
It is irreversible; revocation is the reversible alternative.

## What the owner can and cannot see

The owner manages MEMBERSHIP only. `/owner` shows each member's name,
email, role, access status, date granted, date revoked (if applicable),
and permitted AGGREGATE activity (counts). It never shows another
member's academic content — essays, assignments, writing samples,
feedback, research, files — which remain visible only to their owner.
This boundary is enforced by the database (RLS) and machine-tested by the
security regression suites (`tests/security/rls-regression.mjs`).

## Server-side enforcement chain

Every sensitive operation verifies, in order:

```
authenticated user → active access (profiles.status) → appropriate role → requested resource
```

Applied at: middleware (pages), the API guard (`requireUser` /
`requireOwner` / `requireStaff`, every protected route), and the database (RLS policies +
owner checks in RPCs like `network_stats()`). Migrations: 0001 (roles),
0005 (status + owner management), 0008 (fail-closed owner bootstrap),
0019 (revocation audit trail).

## 2026-10-27: setup diagnostic no longer blocks owner creation

Symptom seen live on Vercel: the app worked (/login, /create-owner, /install
all loaded) but /setup and /api/setup-status said "cannot be fully checked",
database "unreachable", and offered no owner-creation action.

Cause: probeOwnerSetup() in src/lib/owner-setup.ts used the DIRECT Postgres
channel as primary and RETURNED when it failed. Vercel cannot reach
Supabase's IPv6-only direct port, so it never fell back to the service-role
PostgREST queries the app actually uses.

Fix: a failed direct probe now sets directProbeFailed and falls through to
REST. Status reports probeChannel ("direct" | "rest"), keeps migration REPAIR
honestly marked unavailable, and explains the situation in plain language.
Owner creation, sign-in and normal use need nothing else.

To enable automatic migration repair later, reconnect the Supabase
integration in Vercel or provide a pooled connection string (port 6543).
Regression pins live in tests/run.ts (REST-checked + no owner -> /create-owner;
both channels down -> honest null; direct-failure never short-circuits).

## 2026-11-12: one honest list of what needs the Owner

The dashboard's "Needs attention" area could only speak about the two things the page happened to
have loaded: invitation requests and provider keys. Three situations that genuinely need the
Owner were invisible, because nothing on that page could see them:

- a database that has not received its newest update, so presence and the role history are simply
  missing;
- members whose account is suspended, and therefore cannot sign in;
- a member list Sophira could not read at all.

All of them now come from one pure function, `buildActionItems()` in
`src/lib/owner/action-items.ts`, which the page renders and the tests exercise directly. Two rules
shape it. First, unknown is never zero: a count that could not be read produces a plain statement
that it could not be read, never a cheerful "nothing to do" and never a fabricated number.
Second, "your database is behind" and "your database could not be reached" are different facts
(`isMissingDatabasePiece`), because telling the Owner to press an update button when the connection
is down is a dead end that wastes their time.

Every item is written for someone who has never opened a terminal: what happened, what it means
for the people using Sophira, and one link to the page where they can act. A test asserts that no
item contains migration, SQL, or database-error vocabulary. Urgent items are grouped above
informational ones, and the section header counts them.

When every check answers as expected the page says so, and it says what it did not check, rather
than implying the whole system is healthy.
