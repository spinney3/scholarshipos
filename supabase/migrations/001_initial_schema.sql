-- ScholarshipOS initial schema
-- Run this in the Supabase SQL editor (or via `supabase db push`) once per project.

-- =====================================================================
-- Extensions
-- =====================================================================
create extension if not exists "uuid-ossp";

-- =====================================================================
-- Enums
-- =====================================================================
do $$ begin
  create type application_status as enum (
    'discovered',
    'eligible',
    'in_progress',
    'submitted',
    'won',
    'lost'
  );
exception when duplicate_object then null; end $$;

-- =====================================================================
-- profiles: one row per auth user (student)
-- =====================================================================
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text        not null default '',
  gpa          numeric(3,2),
  zip_code     text,
  interests    text[]      not null default '{}',
  financial_need text       check (financial_need in ('low','medium','high') or financial_need is null),
  onboarded    boolean     not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- =====================================================================
-- scholarships: public catalog, readable by all authenticated users
-- =====================================================================
create table if not exists public.scholarships (
  id                   uuid primary key default uuid_generate_v4(),
  title                text        not null,
  provider             text        not null,
  amount               integer     not null,
  deadline             date        not null,
  description          text        not null,
  eligibility_summary  text        not null default '',
  min_gpa              numeric(3,2),
  interests            text[]      not null default '{}',
  zip_scope            text        not null default 'national', -- 'national' | 'state:CA' | 'zip:94110' etc.
  url                  text        not null,
  created_at           timestamptz not null default now()
);

-- =====================================================================
-- applications: student's pipeline entries
-- =====================================================================
create table if not exists public.applications (
  id             uuid primary key default uuid_generate_v4(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  scholarship_id uuid not null references public.scholarships(id) on delete cascade,
  status         application_status not null default 'discovered',
  position       integer not null default 0,
  notes          text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, scholarship_id)
);

create index if not exists applications_user_status_idx
  on public.applications (user_id, status);

-- =====================================================================
-- Updated-at trigger
-- =====================================================================
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists applications_updated_at on public.applications;
create trigger applications_updated_at
  before update on public.applications
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Auto-create a profile row when a new auth user signs up
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Row-Level Security
-- =====================================================================
alter table public.profiles      enable row level security;
alter table public.scholarships  enable row level security;
alter table public.applications  enable row level security;

-- profiles: users can only see/modify their own row
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- scholarships: readable by any authenticated user, not writable from client
drop policy if exists "scholarships_select_all" on public.scholarships;
create policy "scholarships_select_all" on public.scholarships
  for select using (auth.role() = 'authenticated');

-- applications: users can only see/modify their own rows
drop policy if exists "applications_select_own" on public.applications;
create policy "applications_select_own" on public.applications
  for select using (auth.uid() = user_id);

drop policy if exists "applications_insert_own" on public.applications;
create policy "applications_insert_own" on public.applications
  for insert with check (auth.uid() = user_id);

drop policy if exists "applications_update_own" on public.applications;
create policy "applications_update_own" on public.applications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "applications_delete_own" on public.applications;
create policy "applications_delete_own" on public.applications
  for delete using (auth.uid() = user_id);
