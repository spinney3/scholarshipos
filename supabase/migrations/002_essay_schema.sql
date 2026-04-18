-- ScholarshipOS Phase 2: Essay coaching schema
-- Run after 001_initial_schema.sql

-- =====================================================================
-- Add essay_prompt column to scholarships
-- Many scholarships have an essay requirement. We snapshot the prompt
-- onto the essay row when an interview starts, so prompt edits don't
-- retroactively change what a student was answering.
-- =====================================================================
alter table public.scholarships
  add column if not exists essay_prompt text;

-- =====================================================================
-- essays: one row per (application) that has started essay coaching.
-- The interview column is a JSONB array of {role, content} turns
-- recording the Socratic Q&A. status tracks the workflow phase.
-- =====================================================================
create table if not exists public.essays (
  id             uuid primary key default uuid_generate_v4(),
  application_id uuid not null unique references public.applications(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  prompt         text not null,
  interview      jsonb not null default '[]'::jsonb,
  status         text not null default 'interviewing'
                   check (status in ('interviewing','drafting','refining','final')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists essays_user_idx on public.essays (user_id);

drop trigger if exists essays_updated_at on public.essays;
create trigger essays_updated_at
  before update on public.essays
  for each row execute function public.set_updated_at();

-- =====================================================================
-- essay_drafts: versioned drafts for each essay. Source flags whether
-- this version came from Claude (first draft, refinement suggestions)
-- or from the student themselves (manual edit).
-- =====================================================================
create table if not exists public.essay_drafts (
  id          uuid primary key default uuid_generate_v4(),
  essay_id    uuid not null references public.essays(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  version     integer not null,
  outline     text not null default '',
  content     text not null,
  source      text not null default 'claude'
                 check (source in ('claude','user')),
  created_at  timestamptz not null default now(),
  unique (essay_id, version)
);

create index if not exists essay_drafts_essay_idx on public.essay_drafts (essay_id, version desc);

-- =====================================================================
-- Row-Level Security
-- =====================================================================
alter table public.essays        enable row level security;
alter table public.essay_drafts  enable row level security;

-- essays: student can see/modify only their own
drop policy if exists "essays_select_own" on public.essays;
create policy "essays_select_own" on public.essays
  for select using (auth.uid() = user_id);

drop policy if exists "essays_insert_own" on public.essays;
create policy "essays_insert_own" on public.essays
  for insert with check (auth.uid() = user_id);

drop policy if exists "essays_update_own" on public.essays;
create policy "essays_update_own" on public.essays
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "essays_delete_own" on public.essays;
create policy "essays_delete_own" on public.essays
  for delete using (auth.uid() = user_id);

-- essay_drafts: same pattern
drop policy if exists "essay_drafts_select_own" on public.essay_drafts;
create policy "essay_drafts_select_own" on public.essay_drafts
  for select using (auth.uid() = user_id);

drop policy if exists "essay_drafts_insert_own" on public.essay_drafts;
create policy "essay_drafts_insert_own" on public.essay_drafts
  for insert with check (auth.uid() = user_id);

drop policy if exists "essay_drafts_update_own" on public.essay_drafts;
create policy "essay_drafts_update_own" on public.essay_drafts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "essay_drafts_delete_own" on public.essay_drafts;
create policy "essay_drafts_delete_own" on public.essay_drafts
  for delete using (auth.uid() = user_id);

-- =====================================================================
-- Backfill sample essay prompts on seeded scholarships.
-- Keeps prompts roughly aligned with each award's theme so the coach
-- has something meaningful to ask about.
-- =====================================================================
update public.scholarships
set essay_prompt = 'Describe a specific moment when you demonstrated leadership in your school or community. What was the challenge, what did you do, and what did you learn about yourself?'
where title = 'Coca-Cola Scholars Program' and essay_prompt is null;

update public.scholarships
set essay_prompt = 'Tell us about an obstacle you have overcome and how that experience has shaped your goals for the future.'
where title in (
  'Dell Scholars Program',
  'Horatio Alger National Scholarship'
) and essay_prompt is null;

update public.scholarships
set essay_prompt = 'Describe a problem in your community you would like to help solve, and explain how your education will prepare you to address it.'
where title = 'Gates Scholarship' and essay_prompt is null;

update public.scholarships
set essay_prompt = 'Share a formative experience that reveals how you think. Why does this experience matter to you, and what does it say about the kind of student you will be?'
where title = 'Jack Kent Cooke Foundation College Scholarship' and essay_prompt is null;

-- Default prompt for any remaining rows so every scholarship is essay-ready
update public.scholarships
set essay_prompt = 'Tell us about yourself: your background, what you care about, and why this scholarship would matter to you.'
where essay_prompt is null;
