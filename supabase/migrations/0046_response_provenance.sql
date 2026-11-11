-- ---------------------------------------------------------------------
-- responses.provider_used (2026-11-11)
--
-- The answer record claimed `model_used = SOPHIRA_MODEL || "gpt-4o-mini"`,
-- a guess made BEFORE the model was chosen: an answer written on the member's
-- own inference server was filed under a cloud model name, and the owner's
-- "nothing leaves your machines" claim could not be checked against the data.
-- The provider that actually answered is now recorded, so an answer can say
-- honestly where it came from.
--
-- Nullable on purpose: every existing row predates the record and must not be
-- back-filled with a guess. NULL means "not recorded", never "cloud".
-- ---------------------------------------------------------------------
alter table public.responses
  add column if not exists provider_used text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'responses_provider_used_check'
      and conrelid = 'public.responses'::regclass
  ) then
    alter table public.responses
      add constraint responses_provider_used_check
      check (provider_used is null or provider_used in ('selfhost', 'gemini', 'openai', 'local'));
  end if;
end $$;

comment on column public.responses.provider_used is
  'Which engine actually wrote this answer: selfhost = the member''s own inference server, local = on-device, gemini/openai = a cloud service. NULL = not recorded (rows written before 2026-11-11).';
