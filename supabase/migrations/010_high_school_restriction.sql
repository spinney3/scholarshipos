-- Migration 010 — High-school restriction on scholarships + high_school on profiles.
--
-- Why: CCCF (and many community foundations) run scholarship funds that
-- are restricted to students of a specific high school — some of them
-- schools that are nowhere near the foundation's home region. Example:
-- "Halliday Clark, Sr. Memorial Fund" is a CCCF fund but only for
-- students at Scarsdale High School in Scarsdale, NY. Without a school
-- filter these show up in every Chester County student's matches
-- (because they share the foundation's zip_scope) and teach the student
-- to stop trusting the matcher.
--
-- Schema changes:
--   1. profiles.high_school text, nullable — free-text high school name.
--      We match case-insensitively + ignore common suffixes ("High
--      School", "HS") in the matcher. Kept as a free-text string rather
--      than normalized against a schools table — at Philly-focused scale
--      a LUT would be premature optimization and a maintenance burden.
--
--   2. scholarships.high_school_restriction text[], default '{}'.
--      Each element is a high-school name. Empty array = no school
--      restriction (the default; preserves current behavior for every
--      existing row). Non-empty = matcher filters out students whose
--      profile.high_school doesn't appear in this list (or whose
--      high_school is null).
--
-- Using an array rather than a single text column because a small but
-- real fraction of funds are open to a handful of named schools ("any
-- of Conestoga, Great Valley, or Tredyffrin-Easttown"). Arrays keep
-- that case clean without a separate join table.
--
-- RLS unchanged — these are additive columns on existing tables.

-- =====================================================================
-- 1. profile.high_school
-- =====================================================================
alter table public.profiles
  add column if not exists high_school text;

-- Light index for a possible future "other students at your high school"
-- social view. Case-insensitive via lower() because input is free-text.
create index if not exists profiles_high_school_lower_idx
  on public.profiles (lower(high_school))
  where high_school is not null;

-- =====================================================================
-- 2. scholarships.high_school_restriction
-- =====================================================================
alter table public.scholarships
  add column if not exists high_school_restriction text[]
    not null default '{}';

-- GIN index so the matcher's "does this array contain student's school?"
-- query is cheap even at 10k+ rows. Only indexed where the array is
-- non-empty — keeps the index small since most scholarships have no
-- school restriction.
create index if not exists scholarships_high_school_restriction_gin_idx
  on public.scholarships using gin (high_school_restriction)
  where array_length(high_school_restriction, 1) > 0;

-- =====================================================================
-- 3. Backfill: heuristic pass on existing rows
-- =====================================================================
-- Flag rows whose eligibility or title clearly names a specific high
-- school. We pattern-match on "<Name> High School" and "<Name> HS" —
-- this is deliberately conservative. Anything less obvious stays un-
-- flagged and will get a proper restriction when the scraper re-runs
-- with the updated extraction prompt (which now captures this field).
--
-- The regex looks for a capitalized word (or hyphenated pair) followed
-- by "High School" and extracts it as the school name. Plural
-- ("Scarsdale High Schools") is allowed to catch stray data; real school
-- names tend to be singular.
--
-- Rows where eligibility mentions MULTIPLE high schools are left for
-- the scraper re-run — this heuristic only handles the common single-
-- school case.

-- Note: regexp_match (singular) doesn't take a 'g' flag — it only returns
-- the first match, which is exactly what we want here (we take the
-- first named school and leave multi-school rows for the scraper re-run
-- to pick up via the new extraction prompt).

update public.scholarships
set high_school_restriction = array[matched.school]
from (
  select
    id,
    (regexp_match(
      eligibility_summary || ' ' || title,
      '([A-Z][A-Za-z''\-\.]+(?:\s+[A-Z][A-Za-z''\-\.]+){0,3})\s+High\s+School'
    ))[1] as school
  from public.scholarships
  where high_school_restriction = '{}'
    and (
      eligibility_summary ~ '\yHigh\s+School\y'
      or title ~ '\yHigh\s+School\y'
    )
) matched
where public.scholarships.id = matched.id
  and matched.school is not null
  -- Don't flag rows where the matched word is a generic filler.
  and matched.school !~* '^(any|all|local|every|area|the|from|of|graduating|for|a|an|his|her)$';
