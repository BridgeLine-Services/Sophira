# Owner-Controlled Access — How Sophira's Access System Works

Sophira is a private academic AI network owned by one designated owner.
This document explains the full access-control system: how the owner
account is created, how to identify it, how access revocation and
reinstatement work, and how every enforcement point is server-side.

## Roles

There are exactly two roles, stored in `public.profiles.role`:

| Role | Meaning |
|---|---|
| `owner` | The single designated owner: manages membership and invitations. The only role that can revoke or reinstate access. |
| `user` | A regular invited member. Their academic data is private to them — even the owner cannot read it. |

No `admin` role exists; the existing architecture never required one,
so none was added.

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

## Owner setup status diagnostic (/setup)

Operators get a one-page, pre-auth diagnostic at **/setup** (and a
scriptable **GET /api/setup-status**) that answers, honestly and before
any account exists:

- Is the Supabase connection configured?
- Are the database migrations applied (through 0020)?
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

1. Verifies the caller is authenticated AND active AND `role = 'owner'`
   (`requireOwner` — no other role can reach this).
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
`requireOwner`, every protected route), and the database (RLS policies +
owner checks in RPCs like `network_stats()`). Migrations: 0001 (roles),
0005 (status + owner management), 0008 (fail-closed owner bootstrap),
0019 (revocation audit trail).
