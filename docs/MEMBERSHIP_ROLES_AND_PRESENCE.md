# Membership Roles, Account Status and Presence

Written 2026-11-12. Two things this document covers, because the Owner Dashboard
shows both on the same row and they must never be confused:

- **Presence** is *where a member is right now* (Online, Active, Idle, Away, Busy,
  Do Not Disturb, Offline). It comes from heartbeats.
- **Account condition** is *whether the account is allowed to work* (Active,
  Pending invitation, Suspended, Inactive, Locked, Deactivated). It comes from the
  database row.

A suspended account therefore always reads **Offline**, even if a stale session
row still exists. The two columns are separate facts, but they can never
contradict each other.

---

## 1. The four roles

`public.profiles.role` holds one of four values. Migration `0048_membership_roles.sql`
widened the check constraint; no existing row changed.

| Role | Can | Cannot |
|---|---|---|
| `owner` | Everything on the Owner Dashboard: membership, invitations, security, AI providers, integrations, billing-adjacent settings | Read a member's academic content (RLS has no exception for any role) |
| `co_owner` | See the member directory, invite people, decide membership requests, suspend or remove a **User** or **Tester**, change a User to Tester and back | Act on an Owner or another Co-Owner, appoint anyone, promote themselves, change security settings |
| `tester` | The normal member workspace plus approved testing features | Anything at all in the member directory |
| `user` | The normal member workspace | Anything at all in the member directory |

### Where the rules live

One file decides, and everything else asks it:
`src/lib/auth/permissions.ts` (`canManageAccount`, `canManageMemberRole`,
`canManageInvitations`, `canViewMemberDirectory`, `assignableRolesFor`,
`isLastOwner`). The same rules are expressed once for the UI
(`src/lib/roles.ts` → `describeRoleChange`, which tells the owner in plain words
what a person gains and loses) and once in the database (policies using
`public.is_staff()` and `public.is_owner()`).

The frontend is a window, never the boundary: `POST /api/network/roles` re-checks
the acting role against the matrix on the server, and the database re-checks it
again. Hiding a button changes nothing about what a request is allowed to do.

### The two hard limits

1. **The last Owner cannot be demoted.** Attempting it returns a refusal that
   says so; the database rejects it too, so a direct API call cannot do what the
   screen refuses.
2. **Nobody can change their own role.** This closes a real hole in the old
   two-role model, where a member could rewrite their own `profiles.role` row
   through the ordinary profile update path. Ordinary profile fields (display
   name, phone, availability) still update normally; only `role` is held.

### The audit trail

`public.membership_audit` records one row per change: `actor_id`, `target_user_id`,
`old_role`, `new_role`, `reason`, `created_at`. Only staff can read it
(`public.is_staff()`), a member cannot read or write it, and it is deliberately
**excluded** from the member data export because it names the administrator who
acted, which is another person's information.

---

## 2. Presence

### How a state is decided

| State | Meaning | Decided by |
|---|---|---|
| Online | A tab is open and reporting | a heartbeat within the report interval |
| Active | Reporting, and a genuine interaction recently | last interaction within the active threshold |
| Idle | Reporting, but no interaction for a while | silence past the idle threshold |
| Away / Busy / Do Not Disturb | The member chose it | `member_availability` |
| Offline | No valid session | a heartbeat older than the connection timeout, every tab closed, or an account that may not sign in |
| Unknown | Nothing has been reported yet | absence of data, stated as unknown rather than guessed as Offline |

Presence never infers activity from a page view alone: the heartbeat reports the
tab, and only a real interaction (typing, clicking) moves a member from Idle to
Active. Nothing about a member's pages, addresses, or device is stored —
`member_presence` holds a session id, a last-seen time, a last-interaction time
and an optional label.

### Thresholds and why the order matters

`presence_settings` holds six numbers, editable by the Owner on the Members page
(the box headed "How quickly members look active or offline"), served by
`GET`/`PUT /api/network/presence-settings`. That route is Owner-only — a Co-Owner
manages people but does not retune the clock everyone is measured against — and the
database refuses a non-Owner write as well. The form shows each allowed range next to
its field and then displays only what the server stored, so it can never show a
setting that was not actually saved. The six numbers are the heartbeat interval,
connection timeout, active threshold, idle threshold, session expiration, and the
presence update interval, all in seconds, each with a floor and a ceiling that the
database CHECKs as well. `repairThresholdOrder` in
`src/lib/presence/thresholds.ts` enforces the only ordering that produces a stable
picture, and `validateThresholds` refuses the values that would make members
flicker: a connection timeout shorter than the report interval, an idle threshold
shorter than the active one, or a session expiry shorter than the timeout. The
Owner is told the reason in a sentence, not handed a constraint name.

### Endpoints

| Route | What it does |
|---|---|
| `POST /api/network/presence` | Heartbeat. `action: "heartbeat"` records a tab; `action: "availability"` sets the member's own choice; `action: "close"` ends the tab. Only ever touches the caller's own rows. |
| `GET /api/network/presence` | The caller's own presence and availability, so Settings can show what was recorded. |
| `PUT /api/network/presence-settings` | The Owner retunes the six thresholds. Owner-only at the route, in the matrix, and in RLS. |
| `GET /api/network/presence-settings` | The current thresholds with their bounds, so the form states each range instead of letting the Owner discover it by failing. |
| `GET /api/network/stats` | The Owner Dashboard counts, computed from the same rules. |

Two browser hooks drive this: `use-presence-reporter.ts` sends the heartbeat (fast
while the tab is visible, slower while hidden, and one close on unload) and
`use-presence-feed.ts` reads the current picture for the dashboard. Both are silent
on failure — a dropped heartbeat must never interrupt a member's work.

---

## 3. What the Owner Dashboard now shows

The Members page lists one row per member with: display name (the member's chosen
nickname, then their email, then an honest "Name not set"), email, verified phone,
role, presence with its reason, account condition, joined date, and last activity.
Summary counts sit above the table, and both presence and condition have their own
filter, so "who is online right now" and "whose account is suspended" are separate
questions with separate answers.

Dates never print "Invalid Date": a missing timestamp reads "Never active",
"Unavailable", "yesterday" or "12 days ago" as the facts allow
(`src/lib/format.ts`).

Changing a role opens a dialog that states, in plain words, what the person gains
and what they lose, requires a reason, and reports the audit entry afterwards. A
demotion from Co-Owner reads as a loss of the member directory (an earlier version
reported it backwards; `describeRoleChange` is the only place that logic lives now).

---

## 4. Applying this to the live database

The three migrations are additive, but they still have to reach the real database.
Until they do, `network_directory()` does not exist, so `loadOwnerRoster` falls back
to `network_stats()` and the Members page states that presence is unavailable rather
than showing every member as Offline. The thresholds box likewise says the tables are
missing and changes nothing. This was written deliberately: the code ships before the
database, so a deployment can never display an invented presence state.

To apply it: sign in as Owner, open **/owner/database**, and press **Update database**.
It only adds what is missing, reports "N of N pieces are in place", and members can
keep working while it runs. The owner-facing wording is in
docs/WHAT_I_NEED_TO_DO_NEXT.md.

## 5. What this work did not change

- No member account was deleted or recreated, and no existing role, profile field
  or academic record was modified by any migration. All three migrations are
  additive.
- No row-level security policy was weakened. The new policies are scoped to the
  member's own rows (`user_id = auth.uid()`) or to `public.is_staff()` /
  `public.is_owner()`, and those helpers are `security definer`, bound to
  `auth.uid()`, closed to `anon`, and pinned to `public, pg_temp`.
- No member's academic content became visible to an Owner or Co-Owner. The privacy
  matrix in `tests/security/rls-regression.mjs` is untouched.
- Invitation-only registration, revocation, session invalidation and permanent
  removal all behave exactly as before; they now additionally refuse to let the
  last Owner remove themselves.
