# Delegation architecture: permission matrix (design only, no migration)

Engineering directive, Phase 3.1-3.2. **Nothing here is implemented yet.** The database
migration is deliberately NOT written: the directive requires this matrix to be reviewed and
approved by the Owner before any grant table is created.

## 1. What exists today (verified)

Authority lives in `src/lib/auth/permissions.ts` and is enforced server-side by
`src/lib/supabase/guard.ts` (`requireUser`, `requireStaff`, `requireOwner`) and by RLS in
migrations 0048 (roles + guard trigger), 0051 (directory privacy, staff invitations) and 0053
(administrative audit writer).

Helpers: `canViewMemberDirectory`, `canViewMemberContact`, `canViewPresence`,
`canManageInvitations`, `canAccessOwnerSecurity`, `canAccessAdminMonitoring`,
`canUseTesterFeatures`, `canManageAccount`, `canManageMemberRole`, `assignableRolesFor`,
`canTransferOwnership`.

Four roles: user, tester, co_owner, owner (rank order). Roles move only through the audited
SECURITY DEFINER function; a trigger refuses role/status/permission writes from a browser
session.

## 2. Permission classes

**O1 Owner-exclusive, non-delegatable.** Ownership transfer; appointing or removing an Owner or
Co-Owner; billing and zero-cost protection; AI provider keys, models and self-hosted config;
database migration execution and schema updates; backup/restore execution; release gating;
global permission administration; secret storage.

**C Co-Owner baseline (role-granted, not individually granted).** Member directory and contact
details; presence; invitations and invitation requests; role changes within limits
(`assignableRolesFor`); suspend/reinstate/remove user and tester; QA triage; operational
monitoring; announcements.

**D Delegatable capabilities (the new part).** Each is a baseline Co-Owner power that the Owner
may additionally grant to a *lower* role, or narrow for a specific Co-Owner:

| Key | Allows | Never allows |
| --- | --- | --- |
| `members.view` | Read the member directory and contact details | Changing anything |
| `members.suspend` | Suspend or reinstate a user or tester | Touching an Owner or Co-Owner |
| `members.remove` | Permanently remove a user or tester | Removing staff |
| `invitations.manage` | Create, revoke, re-send invitations | Granting staff roles |
| `requests.decide` | Approve or reject access requests | Expanding its own access |
| `roles.assign_user` | Move someone between user and tester | Any staff role |
| `qa.triage` | Move tester reports through their statuses | Reading member coursework |
| `announcements.publish` | Publish or retract announcements | Editing member records |
| `analytics.view` | Operational aggregates | Identifying a member's coursework |

**M Member-only.** Own academic content, own profile, own notifications.

**T Tester-only.** File and follow own QA reports.

## 3. Grant rules (non-negotiable)

1. Only an Owner may grant; a grant never elevates the granter.
2. A grant can never exceed what the Co-Owner baseline already allows (`D ⊂ C`), so no grant
   can escalate toward Owner.
3. Closed allowlist of keys; an unrecognised key denies.
4. **CORRECTED after Owner review (2026-11-12).** The original rule here read `role authority AND (baseline OR active grant)`. That is wrong: it would make every grant useless to a User or Tester, whose role authority for a delegated key is zero. The evaluator runs four INDEPENDENT tests instead: (a) **eligibility** - may this role receive this key at all (user: narrow allowlist; tester: QA-scoped keys; staff: the delegatable set)? (b) **ceiling** - is the key inside the Co-Owner authority ceiling (`D ⊂ C`)? (c) **active grant** - a grant issued to this person for this key that is neither revoked nor expired, read server-side from the authenticated identity, never from the request? (d) **effective** = `role baseline OR (eligible AND within ceiling AND active grant)`. A grant therefore ADDS authority to a lower role without ever exceeding the ceiling, and can never bypass eligibility.

## Owner decisions (2026-11-12) - these bind the implementation

**D1. Testers and Users may receive grants, under a strict allowlist.** Testers: QA-scoped
responsibilities only. Users: a narrow, justified set. Membership administration, account
removal, role assignment and security administration are NEVER grantable below Co-Owner.
No grant may exceed the Co-Owner ceiling.

**D2. Grants expire after 90 days by default.** The Owner may shorten this, or explicitly
choose no expiry. Expiry is enforced server-side at read time (not by a cleanup job), and the
Owner sees a clear indication of expiring grants.

**D3. Grant visibility is role-scoped.** Owner sees all grants; a Co-Owner sees only their own;
Users and Testers see only their own. Co-Owners cannot see, modify or revoke anyone else's
grants.

**Gate:** no migration is written until this corrected evaluator is covered by the security
tests listed in section 3.8 of the directive.
5. Grant expiry and revocation take effect immediately; every check reads live rows.
6. Duplicate active grants for the same (user, key) are prevented by a partial unique index.
7. History is append-only: revoking sets `revoked_at`, nothing is deleted.
8. The browser never writes the grant table; all writes go through Owner-gated server code.
9. Permission decisions use the authenticated server identity only; no client-supplied role
   or key is trusted.
10. Every grant, revocation and refusal is written to the existing administrative audit
    (0053 vocabulary extended, not replaced).

## 4. Proposed schema (additive, pending approval)

`staff_permission_grants`: `id`, `user_id`, `permission_key`, `granted_by`, `created_at`,
`expires_at`, `revoked_at`, `revoked_by`, `reason`. RLS: staff may read their own grants;
Owner reads all; INSERT/UPDATE only through a SECURITY DEFINER function that re-checks the
caller is an Owner. Partial unique index on `(user_id, permission_key) where revoked_at is null`.

## 5. Evaluator design

One module (`src/lib/auth/delegation.ts`) exposing `effectivePermissions(actor)` and
`can(actor, key)`, consumed by guards, API routes and page contexts. No endpoint may compare
role strings for a delegatable capability. Default deny on any read failure — an unreadable
grant table must never mean "allowed".

## 6. Test plan (written before implementation)

Owner grants; Owner revokes; Co-Owner receives permitted access; Co-Owner exceeds authority;
user and tester attempts; expired grant; revoked grant; forged payload; direct table write;
concurrent grant/revoke; unreadable grants deny. Each is a server-side assertion against the
route, not a UI check.

## 7. Open questions for the Owner

1. May a grant be given to a **Tester** or **User** (e.g. `qa.triage` to a trusted user), or
   only to a Co-Owner?
2. Do grants expire by default (suggested: 90 days) or only when the Owner sets a date?
3. Should a second Co-Owner be able to *see* another's grants (visibility only, never change)?
