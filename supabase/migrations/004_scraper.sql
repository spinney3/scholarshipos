-- ScholarshipOS Phase 3: Local scraper schema
-- Run after 003_essay_vault.sql
--
-- Adds:
--   * scholarships.source         — 'seed' | 'local' | 'api'
--   * unique constraint on URL    — enforces dedup at the DB layer so upserts
--                                    from the nightly cron are safe
--   * scrape_runs table           — observability row per cron run so we can
--                                    see which sources yielded new rows and
--                                    which ones broke
--
-- Rationale for `source`: the Kanban / matches UI needs to visually distinguish
-- "local" community-foundation scholarships from national seed data so students
-- can see the higher-ROI small/local awards explicitly (per project framework).

-- =====================================================================
-- scholarships.source + url uniqueness
-- =====================================================================
alter table public.scholarships
  add column if not exists source text not null default 'seed'
    check (source in ('seed','local','api'));

create index if not exists scholarships_source_idx
  on public.scholarships (source);

-- Enforce url uniqueness so the nightly scraper can safely `on conflict (url)
-- do update`. If a past seed ran with duplicate URLs this will fail; the
-- existing seed.sql has no duplicates so this is safe.
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'scholarships_url_key'
  ) then
    alter table public.scholarships
      add constraint scholarships_url_key unique (url);
  end if;
end $$;

-- =====================================================================
-- scrape_runs: one row per cron invocation (observability)
-- =====================================================================
create table if not exists public.scrape_runs (
  id             uuid primary key default uuid_generate_v4(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text        not null default 'running'
                   check (status in ('running','success','partial','failed')),
  sources_total  integer     not null default 0,
  sources_ok     integer     not null default 0,
  scholarships_found     integer not null default 0,
  scholarships_inserted  integer not null default 0,
  scholarships_updated   integer not null default 0,
  -- per-source results: [{ source_id, url, ok, count, error? }, ...]
  results        jsonb       not null default '[]'::jsonb,
  error          text
);

create index if not exists scrape_runs_started_idx
  on public.scrape_runs (started_at desc);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.scrape_runs enable row level security;

-- scrape_runs are server-only; no client policies. The service-role key used
-- by /api/scrape bypasses RLS, so we don't need to grant anything here.
-- Explicitly deny select for authenticated users (default-deny, but documented).
drop policy if exists "scrape_runs_no_client_access" on public.scrape_runs;
create policy "scrape_runs_no_client_access" on public.scrape_runs
  for select using (false);
