-- ---------------------------------------------------------------------
-- responses.updated_at (Phase 6, 2026-11-10)
--
-- The member can now correct a draft answer in place. Revision-aware saving
-- needs a version column on the row, and `responses` never had one: it was
-- append-only (created_at only). Adding the column keeps the old rows valid
-- (they inherit created_at) and lets a stale editor be refused instead of
-- overwriting newer text from another device.
-- ---------------------------------------------------------------------
alter table public.responses
  add column if not exists updated_at timestamptz not null default now();

update public.responses
  set updated_at = created_at
  where updated_at is distinct from created_at
    and updated_at > created_at;

create index if not exists responses_assignment_updated_idx
  on public.responses (assignment_id, updated_at desc);
