-- 0057: FLASHCARDS AS A STUDY SYSTEM (2026-11-13, directive Part 6).
--
-- Before this, flashcards existed only as a GENERATED notebook artifact: a
-- notebook_artifacts row of type 'flashcards' holding questions and answers in
-- JSONB. There was no deck, no per-card review state, no schedule and no
-- mastery record, so a student could generate cards and never study them.
--
-- This migration ADDS that state. It does not touch notebook_artifacts, so every
-- existing artifact keeps working exactly as before; a deck may point at the
-- artifact it was created from (source_artifact_id).
--
-- PRIVACY: each table is owned per student (user_id = auth.uid()) with RLS on,
-- matching every other member table. Nothing here is staff-readable and nothing
-- here widens an existing policy.
--
-- SCHEDULING: the columns interval_days/ease/reps/lapses/due_at hold CURRENT
-- state for fast "what is due" reads. flashcard_reviews is an append-only log of
-- every answer, so the state can always be audited or rebuilt and a mistake in
-- the scheduler never destroys history.

create table if not exists public.flashcard_decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  notebook_id uuid references public.notebooks(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  source_artifact_id uuid references public.notebook_artifacts(id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 160),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.flashcard_decks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  front text not null check (length(btrim(front)) > 0),
  back text not null default '',
  citation text not null default '',
  position int not null default 0,
  -- current review state; only src/lib/flashcards/schedule.ts decides it
  interval_days numeric not null default 0 check (interval_days >= 0),
  ease numeric not null default 2.5 check (ease between 1.3 and 2.8),
  reps int not null default 0 check (reps >= 0),
  lapses int not null default 0 check (lapses >= 0),
  due_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  -- retired cards keep their history but never appear in a review queue
  retired boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.flashcards(id) on delete cascade,
  deck_id uuid not null references public.flashcard_decks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating text not null check (rating in ('again', 'hard', 'good', 'easy')),
  reviewed_at timestamptz not null default now(),
  interval_before numeric not null default 0,
  interval_after numeric not null default 0,
  ease_after numeric not null default 2.5,
  due_after timestamptz,
  elapsed_days numeric,
  created_at timestamptz not null default now()
);

create index if not exists flashcard_decks_owner_idx
  on public.flashcard_decks (user_id, updated_at desc);
create index if not exists flashcards_deck_idx
  on public.flashcards (deck_id, position);
create index if not exists flashcards_due_idx
  on public.flashcards (user_id, due_at) where retired = false;
create index if not exists flashcard_reviews_card_idx
  on public.flashcard_reviews (card_id, reviewed_at desc);

alter table public.flashcard_decks enable row level security;
alter table public.flashcards enable row level security;
alter table public.flashcard_reviews enable row level security;

drop policy if exists flashcard_decks_own_all on public.flashcard_decks;
create policy flashcard_decks_own_all on public.flashcard_decks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists flashcards_own_all on public.flashcards;
create policy flashcards_own_all on public.flashcards
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The review log is append-only: a student may insert and read their own rows,
-- and may never rewrite or delete history through the API.
drop policy if exists flashcard_reviews_own_read on public.flashcard_reviews;
create policy flashcard_reviews_own_read on public.flashcard_reviews
  for select to authenticated using (user_id = auth.uid());
drop policy if exists flashcard_reviews_own_insert on public.flashcard_reviews;
create policy flashcard_reviews_own_insert on public.flashcard_reviews
  for insert to authenticated with check (user_id = auth.uid());

drop trigger if exists flashcard_decks_touch on public.flashcard_decks;
create trigger flashcard_decks_touch before update on public.flashcard_decks
  for each row execute procedure public.touch_updated_at();
drop trigger if exists flashcards_touch on public.flashcards;
create trigger flashcards_touch before update on public.flashcards
  for each row execute procedure public.touch_updated_at();

grant select, insert, update, delete on public.flashcard_decks to authenticated;
grant select, insert, update, delete on public.flashcards to authenticated;
grant select, insert on public.flashcard_reviews to authenticated;

comment on table public.flashcards is
  'Per-card review state (interval_days/ease/reps/lapses/due_at). Owner-only via RLS; state is written only by src/lib/flashcards/schedule.ts.';
comment on table public.flashcard_reviews is
  'Append-only log of every review answer. Owner may insert and read, never update or delete.';
