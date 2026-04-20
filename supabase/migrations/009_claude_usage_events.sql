-- Migration 009 — Claude API usage log for rate limiting + cost telemetry.
--
-- Event-sourced: one row per Claude-calling route invocation. Supports
-- rolling-window queries for rate limits ("how many coach turns has this
-- user made in the last 24h?") and per-user cost attribution ("which
-- student is racking up my Anthropic bill?") without a separate counter
-- table that can drift out of sync.
--
-- Writers: all /api/essay/* routes, /api/scholarships/import (manual add),
-- and the scrape cron. Each route inserts after a successful Claude call,
-- with the real token counts from response.usage — not estimates. Failed
-- calls do NOT record usage (we only got charged on successful responses).
--
-- Readers:
--   - src/lib/rateLimits.ts (pre-call gate): counts recent events per user
--     per kind to enforce daily caps and new-account burst limits.
--   - Future ops dashboard: sum(tokens_in * $1/M + tokens_out * $5/M)
--     per user to see who's expensive.
--
-- RLS: users can select their own events (for a future "your Claude usage"
-- UI), but cannot insert — all writes go through server-side route handlers
-- that use either the user-session client (which RLS trusts because
-- auth.uid() matches user_id) or the admin client (bypasses RLS).
--
-- Retention: not trimmed here. A nightly prune job can delete rows older
-- than 90 days when/if this table gets big. At Shawn's daughter's scale
-- (single-digit students) the table will have <1000 rows/year.

create table if not exists public.claude_usage_events (
  id                 uuid primary key default uuid_generate_v4(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  -- What surface the call came from. Constrained so typos can't create
  -- invisible new "kinds" that the rate limiter won't count.
  kind               text not null check (kind in (
    'coach_interview_start',
    'coach_interview_turn',
    'coach_draft',
    'coach_refine',
    'essay_adapt',
    'manual_add',
    'scrape_extract'
  )),
  -- Actual token counts from response.usage. NULL on legacy rows inserted
  -- before the column existed; always set going forward.
  tokens_in          integer,
  tokens_out         integer,
  -- Optional pointer to the entity the call was for (essay_id, application_id,
  -- scholarship_id). Not a FK because it spans multiple tables; kept as a
  -- free-form uuid for observability only.
  subject_id         uuid,
  created_at         timestamptz not null default now()
);

-- Primary access pattern: "events for user X of kind Y in last N hours".
-- Composite index makes rate-limit checks a fast index scan.
create index if not exists claude_usage_events_user_kind_created_idx
  on public.claude_usage_events (user_id, kind, created_at desc);

-- Secondary index for cost-per-user aggregations (future ops dashboard).
create index if not exists claude_usage_events_user_created_idx
  on public.claude_usage_events (user_id, created_at desc);

alter table public.claude_usage_events enable row level security;

-- Users can see their own usage. Supports a future "your AI usage this
-- month" UI. No need to surface other users' rows.
drop policy if exists "claude_usage_select_own" on public.claude_usage_events;
create policy "claude_usage_select_own" on public.claude_usage_events
  for select using (user_id = auth.uid());

-- No insert/update/delete policies → client writes deny by default.
-- The rate limiter inserts via the user-session client (where auth.uid()
-- matches user_id we're inserting) only if we add an insert policy; for
-- safety we go through the admin client instead, which bypasses RLS.
-- This avoids any scenario where a student could forge low usage counts
-- by tampering with inserts.
