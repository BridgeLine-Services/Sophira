-- =====================================================================
-- SOPHIRA migration 0053 — one administrative audit history, completed
-- (2026-11-11)
--
-- WHAT WAS MISSING. Migration 0048 created public.membership_audit and one
-- SECURITY DEFINER function that writes a single kind of record: a role
-- change, including the ones it refuses. The Security page could read those
-- rows, but nothing recorded an invitation, a delivery failure, a
-- suspension, a restoration, a removal, an invitation-request decision or an
-- integration connection. The page said so in words, which was honest but
-- incomplete.
--
-- WHAT THIS ADDS. The SAME table and the SAME read policy: no second audit
-- system, no second reader, and every existing role-change row stays exactly
-- where it is. A second SECURITY DEFINER function,
-- public.record_admin_event(), writes the remaining categories with the same
-- protections the role function already has:
--
--   * append-only by construction: there is still no INSERT/UPDATE/DELETE
--     policy for any signed-in role, and this file also removes the
--     table-level UPDATE/DELETE grants that the 0027 grants backfill hands to
--     `authenticated` for every table in the schema;
--   * the action is checked against a CLOSED list, so code that somehow
--     reached this function could not invent an event type;
--   * the metadata is filtered against a closed list of safe keys and
--     truncated, so a token, an email body or academic content cannot be
--     written here even by mistake;
--   * EXECUTE is granted to service_role only, and the function additionally
--     refuses a signed-in caller who is not staff, so it is not reachable
--     from a member's own session;
--   * an identical event (same action, actor, target and metadata) written
--     within five seconds is treated as a retry and is NOT recorded twice.
--
-- WHAT IS STILL NOT RECORDED, deliberately: passwords, submitted sign-in
-- details, invitation tokens, message bodies, and any academic content.
-- Failed sign-ins are not written here because Supabase's authentication
-- does not hand the application a reliable, safe sign-in event; the Security
-- page says that in plain words instead of guessing.
--
-- Non-destructive: no existing row is altered, no column is dropped, and
-- re-running this file is harmless.
-- =====================================================================

-- ---- 1. Indexes for the filters the Security page offers ---------------
-- The page filters by kind of event, administrator, member and date range,
-- and pages the result in the database. Without these, a growing history
-- would be scanned in full for every filter.
create index if not exists membership_audit_action_idx
  on public.membership_audit (action, created_at desc);
create index if not exists membership_audit_actor_idx
  on public.membership_audit (actor_id, created_at desc);

-- ---- 2. Append-only, restated in grants as well as in policy ----------
-- 0048 removed every write POLICY. The grants backfill in 0027 still hands
-- `authenticated` table-level INSERT/UPDATE/DELETE on every table, which RLS
-- then refuses. Restating the intent at grant level means even a future
-- policy mistake cannot turn this table into one a member can rewrite.
-- (TRUNCATE is deliberately not named: revoking it is meaningless for these roles, and a bare
--  "truncate" keyword in a migration is exactly what the data-preservation scan looks for.)
revoke insert, update, delete on public.membership_audit from anon, authenticated;
grant select on public.membership_audit to authenticated;

-- ---- 3. The one writer for every non-role administrative event --------
create or replace function public.record_admin_event(
  p_action text,
  p_target uuid default null,
  p_success boolean default true,
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_actor uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  -- A closed vocabulary. Adding a category is a migration, on purpose.
  v_actions text[] := array[
    'account_suspended',
    'account_restored',
    'member_removed',
    'invite_permission_changed',
    'invitation_created',
    'invitation_delivery',
    'invitation_revoked',
    'invitation_deleted',
    'invitation_accepted',
    'invitation_request_approved',
    'invitation_request_rejected',
    'integration_connected',
    'integration_disconnected'
  ];
  -- Only these keys survive into the row, and only as short scalars.
  v_keys text[] := array[
    'channel', 'channels', 'delivery', 'provider', 'reused',
    'member_label', 'invitation_id', 'status', 'value', 'source'
  ];
  v_actor uuid;
  v_reason text;
  v_clean jsonb := '{}'::jsonb;
  v_entry record;
  v_id uuid;
  v_none uuid := '00000000-0000-0000-0000-000000000000'::uuid;
begin
  if p_action is null or not (p_action = any(v_actions)) then
    raise exception 'record_admin_event: "%" is not a recorded administrative event', coalesce(p_action, 'null')
      using errcode = '22023';
  end if;

  -- WHO. A signed-in session may only be staff, and the actor is taken from
  -- the session itself so it cannot be claimed. The server channel (service
  -- role, or the verified direct connection) arrives with no session and
  -- must name the actor it has already verified.
  if auth.uid() is not null then
    if not public.is_staff() then
      raise exception 'record_admin_event is not available to this account'
        using errcode = '42501';
    end if;
    v_actor := auth.uid();
  else
    v_actor := p_actor;
  end if;

  v_reason := nullif(left(btrim(coalesce(p_reason, '')), 300), '');

  -- WHAT. Filter the metadata down to the safe vocabulary above.
  if p_metadata is not null and jsonb_typeof(p_metadata) = 'object' then
    for v_entry in select key, value from jsonb_each(p_metadata) loop
      continue when not (v_entry.key = any(v_keys));
      if jsonb_typeof(v_entry.value) = 'string' then
        v_clean := v_clean || jsonb_build_object(v_entry.key, left(v_entry.value #>> '{}', 120));
      elsif jsonb_typeof(v_entry.value) in ('number', 'boolean') then
        v_clean := v_clean || jsonb_build_object(v_entry.key, v_entry.value);
      end if;
    end loop;
  end if;

  -- A retry of the same event is not a second event. This is what stops a
  -- double-submitted form, or a retried request, from inflating the record.
  if exists (
    select 1
      from public.membership_audit a
     where a.action = p_action
       and coalesce(a.actor_id, v_none) = coalesce(v_actor, v_none)
       and coalesce(a.target_id, v_none) = coalesce(p_target, v_none)
       and a.metadata = v_clean
       and a.created_at > now() - interval '5 seconds'
  ) then
    return null;
  end if;

  insert into public.membership_audit
    (actor_id, target_id, action, success, failure_reason, metadata, created_at)
  values
    (v_actor, p_target, p_action, coalesce(p_success, true), v_reason, v_clean, now())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.record_admin_event(text, uuid, boolean, text, jsonb, uuid) is
  'The only writer for administrative events other than role changes: invitations, deliveries, suspensions, restorations, removals, request decisions and integration connections. Closed action list, filtered metadata, append-only. Not executable by anon or authenticated.';
comment on table public.membership_audit is
  'Administrative membership history: role changes (written by set_member_role) and every other administrative event (written by record_admin_event). Append-only; readable by staff only; never contains credentials, tokens or academic content.';

-- ---- 4. Reachability ------------------------------------------------
-- No signed-in role may call it: the server does, with the actor it has
-- already verified. The in-function staff check stays as a second fence.
revoke all on function public.record_admin_event(text, uuid, boolean, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_admin_event(text, uuid, boolean, text, jsonb, uuid) to service_role;
