-- Migration 006 — Social + outreach profile fields.
--
-- Adds three new columns to profiles:
--   intended_college         text, nullable — free-text college name the
--                            student is planning to attend. Nullable because
--                            many students are still deciding at onboarding.
--   intended_major           text, nullable — free-text major. Same logic.
--   allow_marketing_emails   bool, default true — consent for product and
--                            marketing emails (scholarship digests, upgrade
--                            news). Default true is acceptable here because
--                            (a) the onboarding UI presents a clearly worded,
--                            pre-checked opt-out checkbox rather than a
--                            silent default, and (b) users who never reach
--                            onboarding won't receive email anyway since
--                            outreach is gated on `onboarded = true`.
--
-- Why now: Phase-3 pivot away from live per-student scraping toward a
-- catalog-driven model means Shawn needs a way to reach signed-up students
-- when new local scholarships land in the catalog. Also lays groundwork
-- for a future "peers heading to the same college" social view.
--
-- Safe to run on existing prod — all additions are nullable or have
-- defaults, so existing rows keep working without backfill.

alter table public.profiles
  add column if not exists intended_college text,
  add column if not exists intended_major   text,
  add column if not exists allow_marketing_emails boolean not null default true;

-- Light index on intended_college so a future peers view can cheaply find
-- "other students heading to Penn State." Kept case-insensitive via lower()
-- because students type "penn state", "Penn State", "PSU", etc.
create index if not exists profiles_intended_college_lower_idx
  on public.profiles (lower(intended_college))
  where intended_college is not null;
