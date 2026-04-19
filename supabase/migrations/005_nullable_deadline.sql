-- ScholarshipOS: make scholarships.deadline nullable
-- Run after 004_scraper.sql
--
-- Community foundation catalog pages commonly name scholarships without
-- publishing a per-award deadline (dates live on the per-scholarship
-- detail pages). Rather than drop those rows during scrape normalization
-- — which would silently discard most of our "local" pipeline — we let
-- deadline be null and render "Deadline varies — see listing" in UI.
--
-- Rule-based matcher (src/lib/matching.ts) treats null deadline as
-- "non-urgent but still surfaced". UI components (KanbanCard, MatchList)
-- render a placeholder and skip the urgency pill. /matches ordering uses
-- `nulls last` so dated awards stay at the top of the list.

alter table public.scholarships
  alter column deadline drop not null;
