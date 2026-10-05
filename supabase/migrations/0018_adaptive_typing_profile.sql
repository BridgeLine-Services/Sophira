-- =====================================================================
-- SOPHIRA migration 0018 — OPTIONAL ADAPTIVE TYPING PROFILE
-- (2026-10-05)
--
-- Upgrades the typing-speed system (0009: canonical passages, server-side
-- timing, WPM/accuracy/net-WPM, suspicious-attempt detection, user-selected
-- baseline, retesting — ALL unchanged) with an OPTIONAL adaptive profile.
--
-- Pacing NEVER changes automatically unless auto_adjust_enabled is true.
-- The user can keep the baseline fixed, enable adaptive pacing, retake
-- calibration, or manually select a preferred pace at any time.
--
-- Only VALID, unflagged attempts become observations: suspicious or
-- invalid timing data cannot corrupt the profile (filtered by the pure
-- engine src/lib/typing-profile.ts and never inserted as observations).
--
-- Strict per-user RLS, same as typing_attempts.
-- =====================================================================

create table if not exists public.typing_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  baseline_wpm numeric not null check (baseline_wpm > 0),
  recent_average_wpm numeric not null check (recent_average_wpm >= 0),
  recommended_wpm numeric not null check (recommended_wpm > 0),
  confidence text not null check (confidence in ('LOW', 'MEDIUM', 'HIGH')),
  sample_count int not null default 0 check (sample_count >= 0),
  last_calibration_at timestamptz,
  auto_adjust_enabled boolean not null default false,
  manual_wpm numeric check (manual_wpm is null or (manual_wpm > 0 and manual_wpm <= 220)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.typing_profiles enable row level security;

create policy "typing_profiles_own_all"
  on public.typing_profiles for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- One profile per user, enforced structurally.
create unique index if not exists typing_profiles_one_per_user
  on public.typing_profiles (user_id);
