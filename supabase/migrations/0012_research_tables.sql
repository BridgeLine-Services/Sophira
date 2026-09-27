-- =====================================================================
-- SOPHIRA migration 0012 — verified web research (spec §§7-14)
--
-- RLS-critical: ALL research records belong to the authenticated user.
-- The owner can never browse another member's research: every policy is
-- user_id = auth.uid(). No service-role reads in app code.
-- =====================================================================

create table if not exists public.research_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  assignment_id uuid references public.assignments(id) on delete set null,
  topic text not null,
  research_spec jsonb not null default '{}',   -- {academic_level, source_type, min_sources, date_range, citation_style, teacher_requirements, question}
  status text not null default 'searching'
    check (status in ('planning','searching','verified','writing','complete','failed')),
  failure_reason text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.research_projects enable row level security;
create policy "research_projects_own_all" on public.research_projects
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.research_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.research_projects(id) on delete cascade,
  query text not null,
  provider text not null default '',
  status text not null default 'pending'
    check (status in ('pending','ok','failed')),
  created_at timestamptz not null default now()
);

alter table public.research_queries enable row level security;
create policy "research_queries_own_all" on public.research_queries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.research_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.research_projects(id) on delete cascade,
  query_id uuid references public.research_queries(id) on delete set null,
  original_url text not null,
  final_url text not null default '',           -- URL after following redirects
  canonical_url text not null default '',      -- <link rel=canonical> when present
  domain text not null default '',
  title text not null default '',               -- page <title>, verified
  listed_title text not null default '',        -- title the search provider showed
  author text,                                  -- only when actually found (never invented)
  publisher text,
  publication_date date,                        -- only when actually found
  retrieval_date timestamptz not null default now(),
  source_type text not null default 'web',
  doi text,
  http_status int,
  redirect_count int not null default 0,
  verification_status text not null default 'unverified'
    check (verification_status in ('verified','partially_verified','unverified','failed','inaccessible')),
  verification_notes text not null default '',
  content_extract text not null default '',     -- retrieved text evidence (trusted only as data)
  content_chars int not null default 0,
  integrity_hash text not null default '',       -- sha256 of content at retrieval
  approval text not null default 'pending'
    check (approval in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

alter table public.research_sources enable row level security;
create policy "research_sources_own_all" on public.research_sources
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists research_sources_project_idx
  on public.research_sources (project_id, verification_status);

create table if not exists public.research_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.research_projects(id) on delete cascade,
  response_id uuid references public.responses(id) on delete set null,
  claim text not null,
  source_id uuid references public.research_sources(id) on delete set null,
  evidence text not null default '',           -- exact extracted supporting text
  quote text,                                  -- verbatim quote from retrieved content
  location text,                               -- only when actually known (never invented)
  status text not null default 'missing'
    check (status in ('supported','partially_supported','unsupported','missing')),
  created_at timestamptz not null default now()
);

alter table public.research_claims enable row level security;
create policy "research_claims_own_all" on public.research_claims
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.research_citations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.research_projects(id) on delete cascade,
  response_id uuid references public.responses(id) on delete set null,
  source_id uuid not null references public.research_sources(id) on delete cascade,
  style text not null default 'generic',
  formatted_citation text not null,             -- generated from the SOURCE RECORD, never by the LLM
  created_at timestamptz not null default now()
);

alter table public.research_citations enable row level security;
create policy "research_citations_own_all" on public.research_citations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.research_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_id uuid not null references public.research_sources(id) on delete cascade,
  checked_at timestamptz not null default now(),
  http_status int,
  final_url text not null default '',
  reachable boolean not null default false,
  content_chars int not null default 0,
  title_match boolean not null default false,
  notes text not null default '',
  status text not null default 'unverified'
    check (status in ('verified','partially_verified','unverified','failed','inaccessible'))
);

alter table public.research_verifications enable row level security;
create policy "research_verifications_own_all" on public.research_verifications
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create index if not exists research_verifications_source_idx
  on public.research_verifications (source_id, checked_at desc);
