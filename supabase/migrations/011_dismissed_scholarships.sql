-- Migration 011 — Per-user dismissals for matched scholarships.
--
-- Why: match results include a long tail of rows the matcher can't
-- confidently disqualify but the student knows don't apply to them
-- ("not interested", "wrong field", "already applied elsewhere").
-- Without a way to hide them, the /matches view gets cluttered and
-- students start ignoring the page. The applications table isn't the
-- right home for these — joining the pipeline implies intent to apply,
-- and we don't want dismissals polluting Kanban or win-rate analytics.
--
-- Design:
--   * Separate table, composite PK (user_id, scholarship_id).
--   * Append-only from the app's perspective — users restore by DELETE,
--     not by flipping a boolean. Keeps the table small and query shape
--     obvious.
--   * RLS: users can read/write only their own rows. No shared state
--     (counselors don't see student dismissals — those are personal).
--
-- Trade-off considered: storing dismissed_ids as a text[] on profiles
-- would be simpler but makes the "restore" path a fetch-mutate-write
-- race on a hot row. Separate table wins for correctness at near-zero
-- cost.

create table if not exists public.dismissed_scholarships (
  user_id uuid not null references auth.users(id) on delete cascade,
  scholarship_id uuid not null references public.scholarships(id) on delete cascade,
  dismissed_at timestamptz not null default now(),
  primary key (user_id, scholarship_id)
);

-- Index for the /matches lookup ("what has this user dismissed").
-- PK already covers (user_id, scholarship_id) so a pure user_id lookup
-- hits the leftmost prefix. No second index needed.

alter table public.dismissed_scholarships enable row level security;

-- Users can see only their own dismissals.
create policy "dismissed_scholarships_select_own"
  on public.dismissed_scholarships
  for select
  using (auth.uid() = user_id);

-- Users can insert rows only for themselves.
create policy "dismissed_scholarships_insert_own"
  on public.dismissed_scholarships
  for insert
  with check (auth.uid() = user_id);

-- Users can delete only their own dismissals (restore action).
create policy "dismissed_scholarships_delete_own"
  on public.dismissed_scholarships
  for delete
  using (auth.uid() = user_id);

-- No update policy intentionally — nothing on the row is mutable;
-- restore = delete + re-insert if the user dismisses again later.
