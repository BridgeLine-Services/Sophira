-- =====================================================================
-- 0042: MEMBER NOTIFICATION CENTRE (2026-11-02)
--
-- Stage 5 reported notifications as PARTIAL: in-app toasts and email digests
-- exist, but nothing persisted, so a student who closed the tab lost the
-- message. This adds a durable, per-member list.
--
-- Additive and reversible: two new tables, no existing table touched, no data
-- moved. Dropping these tables loses only the notification list itself.
--
-- Privacy: each row belongs to exactly one member. RLS lets a member read and
-- update ONLY their own rows, and there is deliberately NO admin policy, so the
-- owner cannot read a member's notifications. Rows are written by server code
-- through the service role, never by the browser.
--
-- Duplicate prevention: (user_id, dedupe_key) is unique, so re-running a sync or
-- a retry after a failure cannot produce the same notice twice.
-- =====================================================================

create table if not exists public.member_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The category is what the member actually controls in preferences; kind is
  -- the specific event, kept so the wording can stay precise.
  category text not null check (category in (
    'canvas', 'deadlines', 'research', 'documents', 'account', 'system'
  )),
  kind text not null,
  title text not null,
  body text not null default '',
  -- Relative in-app path only ('/assignments/<id>'). Never an absolute URL:
  -- a notification is not a redirect.
  link text,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create index if not exists member_notifications_unread_idx
  on public.member_notifications (user_id, created_at desc)
  where read_at is null;

create table if not exists public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- Category -> boolean. Absent means "on": a new category must never silently
  -- stop notifying somebody, and a member who never opened settings still gets
  -- their own due-date reminders.
  categories jsonb not null default '{}'::jsonb,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.member_notifications enable row level security;
alter table public.notification_preferences enable row level security;

-- Members read their own notifications. No admin/owner policy exists: the owner
-- is a member of their own workspace, not a reader of anyone else's notices.
drop policy if exists "member_notifications own read" on public.member_notifications;
create policy "member_notifications own read" on public.member_notifications
  for select using (auth.uid() = user_id);

-- A member may mark their own notice read. Deletion is not offered, so history
-- stays intact after a redeploy.
drop policy if exists "member_notifications own update" on public.member_notifications;
create policy "member_notifications own update" on public.member_notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "notification_preferences own read" on public.notification_preferences;
create policy "notification_preferences own read" on public.notification_preferences
  for select using (auth.uid() = user_id);

drop policy if exists "notification_preferences own write" on public.notification_preferences;
create policy "notification_preferences own write" on public.notification_preferences
  for insert with check (auth.uid() = user_id);

drop policy if exists "notification_preferences own update" on public.notification_preferences;
create policy "notification_preferences own update" on public.notification_preferences
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

comment on table public.member_notifications is
  'Per-member durable notices. RLS: own rows only, no admin policy. Written by server code only.';
