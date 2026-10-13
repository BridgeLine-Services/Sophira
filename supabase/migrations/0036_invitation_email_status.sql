-- =====================================================================
-- SOPHIRA migration 0036 — invitation email delivery status (2026-10-13)
--
-- The invitation lifecycle now sends the email through a configured
-- provider and records the HONEST outcome. The owner-only dashboard shows
-- this status; nothing here is a fabricated success:
--   email_status     'sent' | 'not_configured' | 'failed' | null (legacy rows)
--   email_error      safe-to-display reason when a send failed
--   email_sent_at    provider-accepted send time
-- Non-destructive: add column if not exists; legacy rows stay NULL.
-- =====================================================================

alter table public.invitations
  add column if not exists email_status text check (email_status in ('sent', 'not_configured', 'failed')),
  add column if not exists email_error text,
  add column if not exists email_sent_at timestamptz;
