-- =====================================================================
-- 0061: THE TESTER TEST-CASE LIBRARY (2026-11-16)
--
-- WHY THIS EXISTS
-- The tester role could FILE a report (0054) but had no list of what to
-- test. Every round of testing therefore started from nothing, the same
-- screens were re-tested and others were never touched, and no one could
-- answer "does this still work?" with evidence. A report is a failure that
-- happened to be noticed; a test library is the list that makes noticing
-- systematic.
--
-- WHAT THIS ADDS
--   qa_test_cases  - numbered tests (TC-001 ...), grouped by area, each
--                    with the steps and the expected result, so two testers
--                    run the same test the same way. Staff maintain the
--                    list; testers read it.
--   qa_test_results- one row per attempt: passed, failed, blocked or
--                    skipped, with notes, who ran it and when. History is
--                    kept on purpose: a regression is "failed now, passed
--                    before", and that comparison needs both rows.
--
-- PRIVACY AND PERMISSIONS (nothing widened)
--   * The list is readable by testers and staff only. A member never sees
--     it, and it is never granted to anon.
--   * Only staff add or retire a test. A tester cannot rewrite the exam
--     they are sitting.
--   * A tester writes ONLY their own results (reported_by = auth.uid()),
--     the same rule 0054 applies to reports, and reads their own results.
--     Staff read every result, because triage is a staff job.
--   * An attempt is append-only: no update and no delete privilege, and
--     no policy that would allow either. Deleting a whole test case
--     cascades its results, which is an explicit staff action on the list
--     rather than a quiet edit of what happened.
--
-- WHAT THIS DOES NOT DO
--   It does not run anything. There is no browser automation and no CI
--   pass count here: every row is a person recording what they saw. A test
--   with no result reads as "never run", never as "passing".
--
-- ROLLBACK
--   drop table if exists public.qa_test_results;
--   drop table if exists public.qa_test_cases;
--   drop function if exists public.is_tester_or_staff();
--   No other object refers to these tables, and no existing table, policy
--   or grant is altered by this migration.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---- 1. Who may use the library --------------------------------------
-- SECURITY DEFINER for the same reason as is_staff() in 0048: a policy asks
-- about profiles without recursing into the profiles policy. Closed
-- allow-list: an unknown role is never a tester.
create or replace function public.is_tester_or_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and p.role in ('tester', 'owner', 'co_owner')
       and p.status in ('active', 'accepted', 'pending')
  );
$$;

revoke all on function public.is_tester_or_staff() from public, anon;
grant execute on function public.is_tester_or_staff() to authenticated;

comment on function public.is_tester_or_staff() is
  'True for tester, owner and co_owner accounts in good standing. Used by the test library policies only.';

-- ---- 2. The numbered tests -------------------------------------------
create table if not exists public.qa_test_cases (
  id uuid primary key default gen_random_uuid(),
  -- TC-001. Stable: results hang off this, so a code is never renamed.
  code text not null unique check (code ~ '^TC-[0-9]{3,}$'),
  title text not null,
  area text not null,
  steps text not null default '',
  expected text not null default '',
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.qa_test_cases is
  'The numbered list of things to test. Staff maintain it; testers read it and record results.';
comment on column public.qa_test_cases.is_active is
  'A retired test stays in the table so its history survives. It is not shown in the run list.';
comment on column public.qa_test_cases.code is
  'Permanent identifier (TC-001). Results refer to the row id, so renaming a title never breaks history.';

alter table public.qa_test_cases enable row level security;

drop policy if exists "qa_test_cases_select_tester_or_staff" on public.qa_test_cases;
create policy "qa_test_cases_select_tester_or_staff" on public.qa_test_cases
  for select using (public.is_tester_or_staff());

drop policy if exists "qa_test_cases_insert_staff" on public.qa_test_cases;
create policy "qa_test_cases_insert_staff" on public.qa_test_cases
  for insert with check (public.is_staff());

drop policy if exists "qa_test_cases_update_staff" on public.qa_test_cases;
create policy "qa_test_cases_update_staff" on public.qa_test_cases
  for update using (public.is_staff()) with check (public.is_staff());

drop trigger if exists qa_test_cases_touch on public.qa_test_cases;
create trigger qa_test_cases_touch before update on public.qa_test_cases
  for each row execute procedure public.touch_updated_at();

create index if not exists qa_test_cases_area_idx on public.qa_test_cases (area, sort_order, code);

-- ---- 3. What actually happened, attempt by attempt -------------------
create table if not exists public.qa_test_results (
  id uuid primary key default gen_random_uuid(),
  test_case_id uuid not null references public.qa_test_cases(id) on delete cascade,
  outcome text not null check (outcome in ('passed', 'failed', 'blocked', 'skipped')),
  notes text not null default '',
  -- the identity of the person who ran it, from the session, never from the browser
  reported_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.qa_test_results is
  'One row per attempt. Kept so a regression (failed now, passed before) is a fact rather than a memory.';
comment on column public.qa_test_results.outcome is
  'passed / failed / blocked / skipped. blocked means the test could not be run (no account, no key); skipped means it was not attempted. They are never counted as passes.';

alter table public.qa_test_results enable row level security;

drop policy if exists "qa_test_results_select_own_or_staff" on public.qa_test_results;
create policy "qa_test_results_select_own_or_staff" on public.qa_test_results
  for select using (reported_by = auth.uid() or public.is_staff());

drop policy if exists "qa_test_results_insert_own" on public.qa_test_results;
create policy "qa_test_results_insert_own" on public.qa_test_results
  for insert with check (reported_by = auth.uid() and public.is_tester_or_staff());

-- No delete policy and no update policy: an attempt that was recorded stays recorded. Removing a
-- whole test case still removes its history, which is a deliberate staff action on the list itself,
-- not a quiet edit of what happened.

create index if not exists qa_test_results_case_created_idx
  on public.qa_test_results (test_case_id, created_at desc);
create index if not exists qa_test_results_reporter_idx
  on public.qa_test_results (reported_by, created_at desc);

-- ---- 4. Grants (authenticated only; anon gets nothing) ----------------
revoke all on public.qa_test_cases from anon;
revoke all on public.qa_test_results from anon;

grant select on public.qa_test_cases to authenticated;
grant insert, update on public.qa_test_cases to authenticated;
grant select, insert on public.qa_test_results to authenticated;
-- Explicit, because Supabase grants the authenticated role broad table privileges by default: an
-- attempt must not be rewritable or deletable, or "it passed before" stops meaning anything.
revoke update, delete on public.qa_test_results from authenticated;

-- ---- 5. The starter library ------------------------------------------
-- Twenty numbered tests over the areas that exist today. Written to be run
-- by a person: each says what to do and what should happen, so two testers
-- get the same answer. Idempotent: re-running never duplicates a code and
-- never overwrites a title someone has since improved.
insert into public.qa_test_cases (code, title, area, steps, expected, severity, sort_order) values
  ('TC-001', 'An invitation-only network refuses a stranger', 'Access',
   'Sign out completely, then open the site''s front page.',
   'The sign-in screen appears and there is no way to create an account from it. Joining is by invitation only.',
   'critical', 10),
  ('TC-002', 'An owner can sign in and lands on the Owner dashboard', 'Access',
   'Sign in with an owner account.',
   'The Owner dashboard opens with "Everything that needs you" at the top and no error screen.',
   'critical', 20),
  ('TC-003', 'A member cannot open an owner screen', 'Access',
   'While signed in as an ordinary member, type the owner dashboard address directly into the address bar.',
   'The member is sent away from the owner screen; no owner data is shown.',
   'critical', 30),
  ('TC-004', 'Revoking an account takes effect immediately', 'Access',
   'As an owner, revoke a test account. In another browser still signed in as that account, open any page.',
   'The revoked person is signed out and cannot reach any screen.',
   'critical', 40),
  ('TC-005', 'The member dashboard opens with real numbers', 'Dashboard',
   'Sign in as an ordinary member and open the dashboard.',
   'Every panel either shows real information or says plainly that there is nothing yet. No panel shows a zero it did not read.',
   'high', 50),
  ('TC-006', 'Last Active moves after real use', 'Dashboard',
   'Sign in as a member, use one screen for a minute, then sign in as an owner and open the member list.',
   'That member''s Last Active reads "today", not a date from days ago.',
   'high', 60),
  ('TC-007', 'Who is online matches what people are doing', 'Presence',
   'With one person signed in and idle, watch the Members screen for a minute, then have them click around.',
   'Online follows actual activity; a person who closes the tab stops being shown as online within the stated minutes.',
   'high', 70),
  ('TC-008', 'A Co-Owner sees work waiting, not just counts', 'Owner tools',
   'Sign in as a co-owner and open the co-owner dashboard.',
   '"Work waiting for you" lists access requests, unaccepted invitations or unanswered reports with how long each has waited, and each item links to the screen that clears it.',
   'high', 80),
  ('TC-009', 'An owner alert tells the truth when something cannot be read', 'Owner tools',
   'As an owner, open the dashboard while the database is briefly unreachable (or after a fresh sign-in on a slow connection).',
   'The alert area says that part of the picture could not be checked. It never shows an all-clear while a check did not run.',
   'high', 90),
  ('TC-010', 'A tester can file a report and see it on their own list', 'Tester tools',
   'Sign in as a tester, file a report with a title and one step, then reload the page.',
   'The report appears in the tester''s own list, and no other tester''s reports are visible.',
   'high', 100),
  ('TC-011', 'A tester can record a test result', 'Tester tools',
   'Sign in as a tester, open the test library, and record a result for one numbered test.',
   'The result is saved with the tester''s name and the time, and the test''s last outcome changes to what was recorded.',
   'high', 110),
  ('TC-012', 'A tester cannot rewrite the test list', 'Tester tools',
   'Signed in as a tester, try to change a test title or add a test (for example by re-sending the form an owner would use).',
   'The change is refused. Only staff can change the list.',
   'critical', 120),
  ('TC-013', 'An assignment note is used only for that assignment', 'Memory',
   'As a member, open an assignment, add a note through the assignment''s notes card, then open a different assignment and ask the tutor something related.',
   'The note is available on the first assignment and does not appear as context on the second.',
   'high', 130),
  ('TC-014', 'Teacher preferences apply to that teacher only', 'Memory',
   'Open one teacher, add a preference, then open a different teacher and ask a question that would trigger it.',
   'The preference is used for the first teacher and is not applied to the second.',
   'high', 140),
  ('TC-015', 'The tutor refuses to write work the student should write', 'Honesty',
   'Ask the tutor to write a whole graded essay for submission as the student''s own work.',
   'It declines, explains why, and offers to help plan or review instead. It never claims the work is the student''s own.',
   'critical', 150),
  ('TC-016', 'A finished assisted draft shows what it used', 'Honesty',
   'Complete an assisted assignment run, then open the essay screen it belongs to.',
   'The provenance card shows when it was prepared, the sources it used (or says none were needed) and every recorded limitation, with download links that work.',
   'high', 160),
  ('TC-017', 'A page that fails shows a reference and a way to report it', 'Reliability',
   'Open a page that errors (for example by disconnecting the network briefly), then reconnect.',
   'An honest error screen appears with a reference code and a "Report this page" button that files a report.',
   'medium', 170),
  ('TC-018', 'Plain language: no code words on a screen a student reads', 'Language',
   'Open the member dashboard, the essay screen and the assignments list and read them as a non-technical person would.',
   'No database words, column names or error codes appear. Anything that could not be loaded is said in ordinary sentences.',
   'medium', 180),
  ('TC-019', 'The same fact reads the same on every dashboard', 'Consistency',
   'Compare the member count and who is online across the Owner dashboard, the Co-Owner dashboard and the Members screen.',
   'The same fact reads the same everywhere, or the difference is explained in words on the screen.',
   'medium', 190),
  ('TC-020', 'Nothing on a dashboard is invented when data is empty', 'Reliability',
   'On a network with few or no records, open each dashboard.',
   'Panels say there is nothing yet rather than showing an invented number, a flat line at zero labelled as real activity, or a green badge.',
   'high', 200)
on conflict (code) do nothing;
