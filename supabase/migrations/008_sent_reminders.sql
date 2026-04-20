-- Migration 008 — Deadline reminder dedup table.
--
-- Backs the daily /api/cron/reminders job. For each (application, threshold)
-- pair (where threshold ∈ {7, 3, 1} days before deadline), we insert exactly
-- one row the day the reminder is sent. The unique constraint guarantees
-- the cron is idempotent — re-running the job on the same day is a no-op.
--
-- Why not `applications.last_reminder_sent_at`?
--   A timestamp on the application row would only remember the most recent
--   threshold. We'd lose the ability to say "we already warned this student
--   at 7 days, don't warn again at 6." A side table with a composite unique
--   key is the cleanest way to express "each threshold fires at most once."
--
-- RLS: enabled with zero policies. Only the service-role cron inserts here
--      and no user-facing UI needs to read it, so deny-by-default is correct.
--
-- Safe to run on existing prod: table is brand-new, no backfill needed.

create table if not exists public.sent_reminders (
  id                       uuid primary key default uuid_generate_v4(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  application_id           uuid not null references public.applications(id) on delete cascade,
  -- Which "N days before deadline" threshold this row represents.
  -- Constrained to the three thresholds the cron job emits so a bug that
  -- tries to write day-100 can't silently pollute the dedup index.
  days_before_deadline     integer not null check (days_before_deadline in (7, 3, 1)),
  sent_at                  timestamptz not null default now(),
  unique (application_id, days_before_deadline)
);

create index if not exists sent_reminders_user_idx
  on public.sent_reminders (user_id);

alter table public.sent_reminders enable row level security;
-- No policies defined → deny by default for client (anon + authenticated).
-- Service-role bypasses RLS so the cron can still read/write.
