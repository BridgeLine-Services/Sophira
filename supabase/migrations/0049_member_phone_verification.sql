-- =====================================================================
-- 0049: PHONE NUMBER HONESTY (2026-11-12)
--
-- Migration 0043 gave the owner a phone directory, but every number read the
-- same whether the authentication provider had confirmed it or the member had
-- simply typed it into a form. "We have a number" and "this number is proven to
-- reach that person" are different facts, and a non-technical owner making a
-- call needs to know which one they have.
--
-- ADDITIVE ONLY: profiles.phone is untouched, no number is invented, nothing is
-- overwritten. The function keeps its name and its first two columns, so the
-- existing member directory keeps working unchanged; `verified` is new.
--
-- A number is verified ONLY when the auth provider confirmed it
-- (auth.users.phone_confirmed_at) AND it is the same number the member supplied.
-- A different confirmed number belongs to the login identity, not to this column,
-- so it is reported as unverified rather than silently substituted.
-- =====================================================================

drop function if exists public.network_member_phones();

create or replace function public.network_member_phones()
returns table (user_id uuid, phone text, verified boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Owner and Co-Owner only. Ordinary members and Testers never see a directory.
  if not public.is_staff() then
    raise exception 'owner or co-owner only' using errcode = '42501';
  end if;

  return query
    select
      p.id::uuid,
      coalesce(nullif(trim(p.phone), ''), nullif(trim(au.phone), ''))::text as phone,
      (
        au.phone_confirmed_at is not null
        and au.phone is not null
        and coalesce(trim(p.phone), '') <> ''
        and regexp_replace(coalesce(p.phone, ''), '\D', '', 'g')
            = regexp_replace(au.phone, '\D', '', 'g')
      )::boolean as verified
    from public.profiles p
    join auth.users au on au.id = p.id
   where coalesce(nullif(trim(p.phone), ''), nullif(trim(au.phone), '')) is not null;
end;
$$;

revoke all on function public.network_member_phones() from public, anon;
grant execute on function public.network_member_phones() to authenticated;

comment on function public.network_member_phones() is
  'Owner/Co-Owner phone directory: the number the member supplied plus whether the auth provider confirmed that same number. Never exposes auth.users itself.';
