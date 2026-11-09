-- 0044: MEDIA INGESTION (2026-11-09)
-- Phase 3 video/audio pipeline, step 1: the STORAGE layer only.
--
-- Additive and backward-compatible: four new tables, no existing table,
-- column, policy or grant is altered, and nothing here changes behaviour for
-- members who never upload audio or video.
--
-- Privacy model (identical to the rest of Sophira):
--   * every row belongs to exactly one member (user_id -> auth.users),
--   * RLS is on for ALL operations, and the OWNER IS NOT EXEMPT,
--   * deleting a member's account cascades every media row away with it,
--   * no bucket is created public; originals stay in the existing private
--     storage bucket under a per-member prefix.
--
-- Honesty model: a transcript row records WHICH engine produced it and how
-- much of the recording it actually covers. A segment row is only ever
-- written from text the engine returned - pages/timestamps are never invented.

-- ---------------------------------------------------------------------
-- One uploaded audio/video file.
-- ---------------------------------------------------------------------
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 'video' | 'audio'
  kind text not null check (kind in ('video','audio')),
  original_filename text not null default '',
  mime text not null default '',
  byte_size bigint not null default 0 check (byte_size >= 0),
  duration_sec numeric,
  -- private-bucket object path (member-prefixed); the file itself is never
  -- copied into this table
  storage_path text not null default '',
  -- 'uploaded' | 'extracting' | 'transcribing' | 'ready' | 'failed' | 'partial'
  status text not null default 'uploaded' check (status in ('uploaded','extracting','transcribing','ready','failed','partial')),
  -- machine-readable reason, never member content
  error_code text,
  -- plain-English note shown to the member
  member_note text not null default '',
  frames_sampled int not null default 0 check (frames_sampled >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.media_assets enable row level security;
create policy "media_assets_select_own" on public.media_assets for select using (user_id = auth.uid());
create policy "media_assets_insert_own" on public.media_assets for insert with check (user_id = auth.uid());
create policy "media_assets_update_own" on public.media_assets for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "media_assets_delete_own" on public.media_assets for delete using (user_id = auth.uid());
create index if not exists media_assets_user_created_idx on public.media_assets (user_id, created_at desc);
create index if not exists media_assets_status_idx on public.media_assets (status) where status in ('uploaded','extracting','transcribing');

-- ---------------------------------------------------------------------
-- One transcription run of one asset (re-running produces a NEW row so a
-- previous attempt is never overwritten).
-- ---------------------------------------------------------------------
create table if not exists public.media_transcripts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- which engine really produced this: 'whisper-selfhost' etc.
  engine text not null default '',
  model text not null default '',
  language text,
  -- share of the recording covered by returned speech, 0..1
  coverage numeric check (coverage is null or (coverage >= 0 and coverage <= 1)),
  -- 'high' | 'medium' | 'low' | 'failed' - reuses Sophira's confidence words
  confidence text not null default 'low' check (confidence in ('high','medium','low','failed')),
  member_note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.media_transcripts enable row level security;
create policy "media_transcripts_select_own" on public.media_transcripts for select using (user_id = auth.uid());
create policy "media_transcripts_insert_own" on public.media_transcripts for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.media_assets a where a.id = asset_id and a.user_id = auth.uid())
);
create policy "media_transcripts_delete_own" on public.media_transcripts for delete using (user_id = auth.uid());
create index if not exists media_transcripts_asset_idx on public.media_transcripts (asset_id, created_at desc);
create index if not exists media_transcripts_user_idx on public.media_transcripts (user_id);

-- ---------------------------------------------------------------------
-- Timed speech segments. The timestamp is what makes a quotation citable
-- ("at 12:34 the lecturer says ..."), so both bounds are required.
-- ---------------------------------------------------------------------
create table if not exists public.media_segments (
  id uuid primary key default gen_random_uuid(),
  transcript_id uuid not null references public.media_transcripts(id) on delete cascade,
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  start_sec numeric not null check (start_sec >= 0),
  end_sec numeric not null check (end_sec >= start_sec),
  text text not null default '',
  -- only when the engine reported a speaker; never guessed
  speaker text,
  -- sampled frame nearest this moment, when one exists
  frame_sec numeric,
  created_at timestamptz not null default now()
);
alter table public.media_segments enable row level security;
create policy "media_segments_select_own" on public.media_segments for select using (user_id = auth.uid());
create policy "media_segments_insert_own" on public.media_segments for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.media_assets a where a.id = asset_id and a.user_id = auth.uid())
);
create policy "media_segments_delete_own" on public.media_segments for delete using (user_id = auth.uid());
create index if not exists media_segments_transcript_time_idx on public.media_segments (transcript_id, start_sec);
create index if not exists media_segments_asset_idx on public.media_segments (asset_id);

-- ---------------------------------------------------------------------
-- Sampled frames and what was actually recognised in them.
-- ---------------------------------------------------------------------
create table if not exists public.media_frames (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.media_assets(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  at_sec numeric not null check (at_sec >= 0),
  storage_path text not null default '',
  -- text the vision/OCR step actually returned for this frame
  recognised_text text not null default '',
  -- 'slide' | 'diagram' | 'chart' | 'table' | 'scene' | 'unknown'
  frame_kind text not null default 'unknown' check (frame_kind in ('slide','diagram','chart','table','scene','unknown')),
  confidence text not null default 'low' check (confidence in ('high','medium','low','failed')),
  member_note text not null default '',
  created_at timestamptz not null default now()
);
alter table public.media_frames enable row level security;
create policy "media_frames_select_own" on public.media_frames for select using (user_id = auth.uid());
create policy "media_frames_insert_own" on public.media_frames for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.media_assets a where a.id = asset_id and a.user_id = auth.uid())
);
create policy "media_frames_delete_own" on public.media_frames for delete using (user_id = auth.uid());
create index if not exists media_frames_asset_time_idx on public.media_frames (asset_id, at_sec);

-- ---------------------------------------------------------------------
-- member_note / recognised_text are MEMBER CONTENT: the backup inventory
-- marks these tables sensitive, so their text is never printed in reports.
-- ---------------------------------------------------------------------
