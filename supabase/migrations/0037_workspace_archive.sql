-- =====================================================================
-- SOPHIRA migration 0037 — workspace archive lifecycle (2026-10-13)
--
-- ACTIVE -> ARCHIVED -> (separate, explicit) PERMANENT DELETION.
--
--   * archived_at IS NULL means ACTIVE (the default for every existing
--     row; nothing is archived by this migration, no data is rewritten).
--   * archived_at NOT NULL means REMOVED FROM THE ACTIVE WORKSPACE: the
--     row stays owned, intact, and restorable. Active lists, counts, and
--     AI retrieval exclude it (enforced server-side, not just in the UI).
--
-- Non-destructive: "add column if not exists" only. No table is dropped,
-- no RLS policy changes (ownership policies already scope every row to
-- its user), and restoring simply sets archived_at back to NULL.
-- =====================================================================

alter table public.notebooks        add column if not exists archived_at timestamptz;
alter table public.notebook_sources add column if not exists archived_at timestamptz;
alter table public.notebook_notes   add column if not exists archived_at timestamptz;
alter table public.notebook_questions add column if not exists archived_at timestamptz;
alter table public.notebook_evidence  add column if not exists archived_at timestamptz;
alter table public.notebook_artifacts add column if not exists archived_at timestamptz;

-- The archive view scans a user's rows by owner + state.
create index if not exists notebooks_active_idx on public.notebooks (user_id, archived_at);
create index if not exists notebook_sources_active_idx on public.notebook_sources (notebook_id, archived_at);
create index if not exists notebook_notes_active_idx on public.notebook_notes (notebook_id, archived_at);
create index if not exists notebook_questions_active_idx on public.notebook_questions (notebook_id, archived_at);
create index if not exists notebook_evidence_active_idx on public.notebook_evidence (notebook_id, archived_at);
create index if not exists notebook_artifacts_active_idx on public.notebook_artifacts (notebook_id, archived_at);
