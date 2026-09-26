-- =====================================================================
-- SOPHIRA migration 0006 — invitation expiry (workflow §5)
--
-- Invitation tokens must be single-use, tied to the invited email, AND
-- expirable/revocable. Revocation existed (0001); this adds EXPIRY:
--   - every invitation gets expires_at (default: 14 days after creation)
--   - the security-definer token lookup refuses expired invitations, so
--     expiry is enforced at the DATABASE level, not just hidden in the UI
--   - the accept route independently re-checks expiry (defense in depth)
-- =====================================================================

alter table public.invitations
  add column if not exists expires_at timestamptz not null default (now() + interval '14 days');

-- Existing pending invitations keep a full 14-day window from migration time.
-- (Adding a NOT NULL column with a default backfills every existing row.)

create or replace function public.get_invitation_by_token(p_token text)
returns public.invitations
language sql
security definer set search_path = public
as $$
  select * from public.invitations
  where token = p_token
    and status = 'pending'
    and expires_at > now();
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;
