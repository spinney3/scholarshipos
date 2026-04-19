-- Migration 007 — Student-added scholarships (URL paste + PDF upload).
--
-- Lets a student submit a scholarship they found on their own — a teacher's
-- forwarded email, a paper PTA flyer scanned to PDF, a niche community award
-- that isn't in the catalog. Claude extracts structured fields, we write
-- the row with source='user_added' and created_by=user.id, and it shows up
-- only in that student's matches and pipeline — never in anyone else's.
--
-- Schema changes:
--   1. scholarships.source check constraint expanded to allow 'user_added'.
--   2. scholarships.created_by nullable FK to auth.users. NULL = catalog
--      row (seed/local/api); NOT NULL = student upload.
--   3. scholarships.url allowed to be empty string for PDF uploads (the
--      student may not have a public URL — they uploaded a flyer). We keep
--      NOT NULL and default '' so downstream code doesn't need null guards
--      everywhere; components render a "View details" link only when url
--      is non-empty.
--   4. The global `scholarships_url_key` unique constraint is replaced with
--      a partial unique index that only applies to catalog rows. Student
--      uploads can share URLs (two students might upload the same PTA
--      flyer) without collision, while the scraper still can't insert
--      catalog duplicates.
--   5. RLS rewritten: any authenticated user can read catalog rows; a
--      user can additionally read, insert, update, or delete their OWN
--      user_added rows. The server-side import route uses the service role
--      client (same as the scraper) and so bypasses RLS, but the INSERT
--      policy below is what would kick in if we ever move the write path
--      to the user's own client.

-- =====================================================================
-- 1. Expand source check constraint
-- =====================================================================
-- Drop and re-add since there's no IF EXISTS for check constraints that
-- also accepts a modified definition.
do $$
declare
  cons_name text;
begin
  select conname into cons_name
  from pg_constraint
  where conrelid = 'public.scholarships'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%source%seed%local%api%';

  if cons_name is not null then
    execute format('alter table public.scholarships drop constraint %I', cons_name);
  end if;
end $$;

alter table public.scholarships
  add constraint scholarships_source_check
  check (source in ('seed','local','api','user_added'));

-- =====================================================================
-- 2. created_by column
-- =====================================================================
alter table public.scholarships
  add column if not exists created_by uuid
    references auth.users(id) on delete cascade;

create index if not exists scholarships_created_by_idx
  on public.scholarships (created_by)
  where created_by is not null;

-- =====================================================================
-- 3. Relax url NOT NULL to default '' so PDF uploads without a public URL
--    can still be inserted. Existing seed/local rows are unaffected.
-- =====================================================================
alter table public.scholarships
  alter column url set default '';

-- =====================================================================
-- 4. Replace global url unique constraint with a catalog-only partial
-- =====================================================================
alter table public.scholarships
  drop constraint if exists scholarships_url_key;

-- Partial unique: only enforce URL uniqueness for catalog rows. Student
-- uploads (created_by IS NOT NULL) are allowed to share URLs.
create unique index if not exists scholarships_catalog_url_idx
  on public.scholarships (url)
  where created_by is null;

-- =====================================================================
-- 5. RLS — scoped visibility
-- =====================================================================
-- Drop the old "everyone sees everything" policy; replace with one that
-- allows catalog + own-uploads only.
drop policy if exists "scholarships_select_all" on public.scholarships;

drop policy if exists "scholarships_select_catalog_or_own" on public.scholarships;
create policy "scholarships_select_catalog_or_own" on public.scholarships
  for select using (
    created_by is null
    or created_by = auth.uid()
  );

-- A student can insert their own user_added rows. Catalog rows
-- (created_by is null) must come through the service-role client.
drop policy if exists "scholarships_insert_own_user_added" on public.scholarships;
create policy "scholarships_insert_own_user_added" on public.scholarships
  for insert with check (
    created_by = auth.uid()
    and source = 'user_added'
  );

drop policy if exists "scholarships_update_own_user_added" on public.scholarships;
create policy "scholarships_update_own_user_added" on public.scholarships
  for update using (
    created_by = auth.uid()
    and source = 'user_added'
  ) with check (
    created_by = auth.uid()
    and source = 'user_added'
  );

drop policy if exists "scholarships_delete_own_user_added" on public.scholarships;
create policy "scholarships_delete_own_user_added" on public.scholarships
  for delete using (
    created_by = auth.uid()
    and source = 'user_added'
  );
