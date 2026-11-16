-- =====================================================================
-- 0060: MEANINGFUL ACTIVITY REACHES THE ACCOUNT RECORD (2026-11-15)
--
-- WHAT WAS WRONG. Sophira kept two separate signals of life and only one of
-- them was being fed.
--
--   public.member_presence          -> "is someone at their screen right now?"
--   public.profiles.last_active_at  -> "when did this person last actually
--                                      use Sophira?"
--
-- The presence heartbeat (0050) wrote the first on every signed-in screen, for
-- every role, but nothing wrote the second except one line on the student
-- dashboard. The result was the Owner's own report: presence said Active, the
-- heartbeat was demonstrably running, and Last Active still said four days
-- ago. Both statements were true of different columns, which is exactly why it
-- looked like a lie.
--
-- WHAT THIS DOES. The existing authenticated heartbeat now also records
-- MEANINGFUL ACTIVITY against the caller's own profile row, throttled to at
-- most once per member per minute. It changes no table, adds no table, widens
-- no policy and grants nothing new: it replaces ONE function with a compatible
-- superset of itself.
--
-- WHY THE HEARTBEAT AND NOT A NEW ENDPOINT. The heartbeat is already the one
-- call every role makes on every authenticated screen, already authenticated
-- server-side, already refused for suspended accounts, and already carries the
-- p_interacted signal that means "a person did something". A second endpoint
-- would be a second way to be present, which is how two disagreeing answers
-- happen.
--
-- WHAT COUNTS AS MEANINGFUL. Only p_interacted = true, which the browser sets
-- from a genuine pointer, key, scroll or focus event, from returning to a tab,
-- or from arriving on an authenticated screen. A hidden tab does not beat at
-- all. A visible but untouched tab beats with p_interacted = false and does not
-- move the timestamp. Background polling, realtime refreshes and reconnects are
-- never sent as interactions.
--
-- THROTTLING is the WHERE clause itself, so it is atomic under concurrency: the
-- row is only touched when its stored value is genuinely older than the window.
-- Eight tabs open at once cannot produce eight writes; the first wins and the
-- rest find the row already fresh.
--
-- WHAT IT REFUSES TO DO.
--   * It never takes a user id from the caller. The identity is auth.uid(),
--     read inside a SECURITY DEFINER function, so a browser cannot name
--     somebody else's profile.
--   * It never invents a timestamp. On any error the stored value is left
--     exactly as it was and the function reports activity 'failed' rather than
--     claiming a write that did not happen.
--   * It never merges presence into account activity, or the reverse. Both
--     columns remain, both are returned, and the directory keeps showing both.
--
-- ROLLBACK (safe, no data loss):
--   Re-run the create or replace for public.presence_heartbeat exactly as it is
--   published in supabase/migrations/0050_member_presence.sql, then re-apply
--   the two grant lines that follow it there. No column, row, policy or grant
--   created here needs undoing, because this migration adds none.
--   last_active_at then keeps whatever value it last held, which is a correct
--   "last meaningful activity" for that older behaviour too.
--
-- ADDITIVE ONLY. 0050 and 0051 are applied and are not edited.
-- =====================================================================

-- ---- 1. The heartbeat, with the account record kept in step -----------
-- Every branch, refusal, expiry calculation, session upsert and grant below is
-- the behaviour published in 0050. The only addition is the throttled profile
-- update and the honest word describing what happened to it.
create or replace function public.presence_heartbeat(
  p_session_id text,
  p_interacted boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_expiry integer;
  v_sessions integer;
  -- 'idle'      : no meaningful interaction claimed, so nothing was written
  -- 'recorded'  : the account record advanced
  -- 'throttled' : an interaction, but the stored value is still fresh; no write needed
  -- 'failed'    : an interaction was claimed and the update did not happen
  v_activity text := 'idle';
  -- The window is deliberately a literal here rather than owner-tunable: it
  -- describes how often a database row may be touched, not how presence looks,
  -- and it is mirrored in src/lib/presence/activity.ts so code and database
  -- cannot disagree.
  v_window interval := interval '60 seconds';
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not authenticated');
  end if;
  if p_session_id is null or length(trim(p_session_id)) < 8 or length(p_session_id) > 64 then
    return jsonb_build_object('ok', false, 'error', 'invalid session');
  end if;

  select status into v_status from public.profiles where id = v_uid;
  if v_status is null then
    return jsonb_build_object('ok', false, 'error', 'no profile');
  end if;
  if v_status not in ('active', 'accepted', 'pending') then
    -- Delete whatever is left so a suspended account cannot look connected.
    delete from public.member_presence where user_id = v_uid;
    return jsonb_build_object('ok', false, 'error', 'account not permitted', 'state', 'offline');
  end if;

  select session_expiration_seconds into v_expiry from public.presence_settings where id = 1;
  v_expiry := coalesce(v_expiry, 3600);

  insert into public.member_presence
    (user_id, session_id, connection_state, last_heartbeat, last_interaction, expires_at)
  values (
    v_uid, p_session_id, 'connected', now(),
    case when coalesce(p_interacted, false) then now() else null end,
    now() + make_interval(secs => v_expiry)
  )
  on conflict (user_id, session_id) do update
    set connection_state = 'connected',
        last_heartbeat = now(),
        last_interaction = case when coalesce(p_interacted, false) then now()
                                else public.member_presence.last_interaction end,
        expires_at = now() + make_interval(secs => v_expiry),
        updated_at = now();

  select count(*) into v_sessions
    from public.member_presence
   where user_id = v_uid and expires_at > now();

  -- The account record. Isolated so a failure here can never cost the member
  -- their presence, their session or their academic work: the session above is
  -- already written, and the stored activity value is simply left untouched.
  if coalesce(p_interacted, false) then
    begin
      update public.profiles
         set last_active_at = now()
       where id = v_uid
         and (last_active_at is null or last_active_at <= now() - v_window);
      if found then
        v_activity := 'recorded';
      else
        v_activity := 'throttled';
      end if;
    exception when others then
      v_activity := 'failed';
      -- Visible in the database's own function log for an administrator, and
      -- stated to the caller instead of being reported as a success.
      raise warning 'presence_heartbeat: last_active_at not recorded for %: %', v_uid, sqlerrm;
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'state', 'connected',
    'sessions', v_sessions,
    'activity', v_activity
  );
end;
$$;

revoke all on function public.presence_heartbeat(text, boolean) from public, anon;
grant execute on function public.presence_heartbeat(text, boolean) to authenticated;

comment on function public.presence_heartbeat(text, boolean) is
  'Authenticated presence beat. Writes this member''s session, and (at most once per minute, only on a meaningful interaction) this member''s own last_active_at. Presence and account activity stay separate columns; a suspended account is refused and its sessions are cleared.';

-- ---- 2. The account record is readable exactly where it already was ---
-- No policy change: 0001 and 0027 already let a member read and update their
-- own profile row, and staff read the directory through the SECURITY DEFINER
-- functions in 0050/0051. Stated here only so nobody later "fixes" a supposed
-- missing grant by widening one.
comment on column public.profiles.last_active_at is
  'Last MEANINGFUL interaction, written by presence_heartbeat (0060) at most once per minute, and by the student dashboard as a compatible fallback. Distinct from live presence in public.member_presence; never derived from a page load alone.';
