-- 0055: ANNOUNCEMENTS (2026-11-12). Staff-authored network-wide messages.
-- Staff author/publish/retract; every signed-in member reads PUBLISHED rows only.
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references auth.users(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null default '',
  status text not null default 'draft' check (status in ('draft', 'published')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists announcements_published_idx
  on public.announcements (published_at desc) where status = 'published';
alter table public.announcements enable row level security;
drop policy if exists announcements_member_read on public.announcements;
create policy announcements_member_read on public.announcements
  for select to authenticated using (auth.uid() is not null and status = 'published');
drop policy if exists announcements_staff_read on public.announcements;
create policy announcements_staff_read on public.announcements
  for select to authenticated using (public.is_staff());
drop policy if exists announcements_staff_write on public.announcements;
create policy announcements_staff_write on public.announcements
  for insert to authenticated with check (public.is_staff() and author_id = auth.uid());
drop policy if exists announcements_staff_update on public.announcements;
create policy announcements_staff_update on public.announcements
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists announcements_staff_delete on public.announcements;
create policy announcements_staff_delete on public.announcements
  for delete to authenticated using (public.is_staff());
drop trigger if exists announcements_touch on public.announcements;
create trigger announcements_touch before update on public.announcements
  for each row execute procedure public.touch_updated_at();
grant select, insert, update, delete on public.announcements to authenticated;
