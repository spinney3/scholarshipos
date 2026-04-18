-- ScholarshipOS Phase 2: Essay Vault
-- Adds a library of completed/reusable essays tagged by prompt type,
-- plus an optional M:N link to applications. Complementary to the coach
-- tables (essays/essay_drafts) introduced in 002_essay_schema.sql:
--   * essays/essay_drafts  -> one-off per-application Socratic interview
--                             + versioned drafting.
--   * vault_essays         -> student's personal library of finished
--                             essays they can adapt for future prompts.
-- Run after 002_essay_schema.sql.

-- =====================================================================
-- Enum: vault essay prompt types
-- =====================================================================
-- Kept as an enum (rather than free text) so we can cheaply do
-- same-prompt-type similarity boosts and filter the vault UI.
do $$ begin
  create type vault_prompt_type as enum (
    'leadership',
    'community_service',
    'financial_need',
    'stem',
    'academic',
    'personal_story',
    'career_goals',
    'diversity',
    'overcoming_adversity',
    'first_generation',
    'creative',
    'other'
  );
exception when duplicate_object then null; end $$;

-- =====================================================================
-- vault_essays: one row per stored reusable essay
-- =====================================================================
create table if not exists public.vault_essays (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null default 'Untitled essay',
  prompt_type     vault_prompt_type not null default 'other',
  prompt_text     text not null default '',
  content         text not null default '',
  word_count      integer not null default 0,
  -- source_essay_id lets us track "this essay was forked from that one"
  -- so win-rate intelligence (Phase 2) can measure reuse success.
  source_essay_id uuid references public.vault_essays(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists vault_essays_user_idx
  on public.vault_essays (user_id, updated_at desc);

create index if not exists vault_essays_user_type_idx
  on public.vault_essays (user_id, prompt_type);

-- =====================================================================
-- vault_essay_applications: optional M:N link. An essay can be reused
-- across scholarships; an application can reference multiple vault
-- essays (e.g. long + short variants).
-- =====================================================================
create table if not exists public.vault_essay_applications (
  vault_essay_id  uuid not null references public.vault_essays(id) on delete cascade,
  application_id  uuid not null references public.applications(id) on delete cascade,
  linked_at       timestamptz not null default now(),
  primary key (vault_essay_id, application_id)
);

create index if not exists vault_essay_applications_app_idx
  on public.vault_essay_applications (application_id);

-- =====================================================================
-- Updated-at trigger (reuses the shared public.set_updated_at() func
-- installed by 001_initial_schema.sql)
-- =====================================================================
drop trigger if exists vault_essays_updated_at on public.vault_essays;
create trigger vault_essays_updated_at
  before update on public.vault_essays
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Row-Level Security
-- =====================================================================
alter table public.vault_essays             enable row level security;
alter table public.vault_essay_applications enable row level security;

-- vault_essays: owner-only
drop policy if exists "vault_essays_select_own" on public.vault_essays;
create policy "vault_essays_select_own" on public.vault_essays
  for select using (auth.uid() = user_id);

drop policy if exists "vault_essays_insert_own" on public.vault_essays;
create policy "vault_essays_insert_own" on public.vault_essays
  for insert with check (auth.uid() = user_id);

drop policy if exists "vault_essays_update_own" on public.vault_essays;
create policy "vault_essays_update_own" on public.vault_essays
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "vault_essays_delete_own" on public.vault_essays;
create policy "vault_essays_delete_own" on public.vault_essays
  for delete using (auth.uid() = user_id);

-- vault_essay_applications: owner-of-essay AND owner-of-application.
drop policy if exists "vault_essay_apps_select_own" on public.vault_essay_applications;
create policy "vault_essay_apps_select_own" on public.vault_essay_applications
  for select using (
    exists (
      select 1 from public.vault_essays e
      where e.id = vault_essay_applications.vault_essay_id
        and e.user_id = auth.uid()
    )
  );

drop policy if exists "vault_essay_apps_insert_own" on public.vault_essay_applications;
create policy "vault_essay_apps_insert_own" on public.vault_essay_applications
  for insert with check (
    exists (
      select 1 from public.vault_essays e
      where e.id = vault_essay_applications.vault_essay_id
        and e.user_id = auth.uid()
    )
    and exists (
      select 1 from public.applications a
      where a.id = vault_essay_applications.application_id
        and a.user_id = auth.uid()
    )
  );

drop policy if exists "vault_essay_apps_delete_own" on public.vault_essay_applications;
create policy "vault_essay_apps_delete_own" on public.vault_essay_applications
  for delete using (
    exists (
      select 1 from public.vault_essays e
      where e.id = vault_essay_applications.vault_essay_id
        and e.user_id = auth.uid()
    )
  );
