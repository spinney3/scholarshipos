# ScholarshipOS

Phase 1 of ScholarshipOS — a scholarship discovery and pipeline-tracking app for high school students. Built with **Next.js 14 (App Router)**, **Tailwind CSS**, and **Supabase** (Postgres + Auth + RLS).

## What's in Phase 1

- Email/password authentication via Supabase Auth.
- A 4-step onboarding wizard (name, GPA, ZIP, interests, financial need).
- A seeded scholarship catalog (24 records — national and ZIP-scoped).
- A rule-based matching page that filters and ranks scholarships against the student's profile.
- A drag-and-drop Kanban pipeline with six columns: Discovered → Eligible → In Progress → Submitted → Won → Lost, backed by `@dnd-kit`.
- Row-Level Security on every table — students can only read/write their own rows.

## Project structure

```
src/
  app/                 App Router routes (landing, login, signup, onboarding, matches, kanban, auth callback)
  components/          React components (Navbar, OnboardingWizard, MatchList, KanbanBoard, KanbanColumn, KanbanCard)
  lib/
    matching.ts        Rule-based scholarship matcher
    types.ts           Shared TypeScript types + constants
    supabase/
      client.ts        Browser Supabase client
      server.ts        Server Component / Route Handler client
      middleware.ts    Session refresh + auth guard
  middleware.ts        Next middleware entry (wraps lib/supabase/middleware.ts)
supabase/
  migrations/001_initial_schema.sql   Schema, triggers, RLS policies
  seed.sql                            24 sample scholarships
```

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Sign up at <https://supabase.com> and create a new project.
2. In the project dashboard, go to **Project Settings → API** and copy:
   - `Project URL`
   - `anon public` key
3. Copy `.env.example` to `.env.local` and paste in those values:
   ```bash
   cp .env.example .env.local
   ```

### 3. Apply the schema and seed data

The easiest path is the Supabase SQL editor:

1. Open **SQL Editor** in your Supabase dashboard.
2. Paste the contents of `supabase/migrations/001_initial_schema.sql` and run it.
3. Paste the contents of `supabase/seed.sql` and run it.

Or with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql
```

### 4. Configure email auth

In the Supabase dashboard:

1. Go to **Authentication → Providers** and make sure **Email** is enabled.
2. Under **Authentication → URL Configuration**, set:
   - **Site URL**: `http://localhost:3000` (for local dev) or your deployed URL
   - **Redirect URLs**: add `http://localhost:3000/auth/callback` and `https://<your-vercel-domain>/auth/callback`
3. Optional: under **Authentication → Email Templates**, disable email confirmation in dev if you'd like instant sign-in.

### 5. Run locally

```bash
npm run dev
```

Open <http://localhost:3000>. Sign up, complete onboarding, then you'll land on `/matches`.

## Deploying to Vercel

1. Push this repo to GitHub.
2. Go to <https://vercel.com/new>, import the repo, keep the default Next.js framework settings.
3. Add the two environment variables under **Settings → Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. After the first deploy, return to Supabase → Authentication → URL Configuration and add your Vercel URL + its `/auth/callback` to the redirect allow-list.

## How the matcher works

`src/lib/matching.ts` is intentionally simple for Phase 1:

1. **Hard filters** (any failure disqualifies):
   - Deadline must be in the future.
   - Student GPA must meet the scholarship's `min_gpa`.
   - If a scholarship has `zip_scope = 'zip:XXXXX'`, the student's ZIP must share the first 3 digits.
2. **Score** (for ordering eligible matches):
   - +10 per overlapping interest tag (capped at +40).
   - +5 if the student's GPA is at least 0.5 above the required minimum.
   - +5 for awards of $20,000 or more.
   - Reasons and urgency (≤60 days to deadline) are surfaced as chips on each card.

Phase 2 will replace this with a Claude-ranked matcher using win-probability signals.

## How RLS is enforced

- `profiles`: users can `select`/`insert`/`update` only their own row (`auth.uid() = id`).
- `scholarships`: any authenticated user can `select`; no client-side writes.
- `applications`: users can `select`/`insert`/`update`/`delete` only rows where `user_id = auth.uid()`.

A `handle_new_user` trigger auto-creates a blank `profiles` row whenever a new auth user is created, so the onboarding wizard always has a row to update.

## Roadmap

- **Phase 2**: Claude-powered essay coaching (Socratic Q&A → draft → refine), essay vault with reusable building blocks, AI-ranked match scoring.
- **Phase 3**: Playwright scraper targeting community-foundation sites by ZIP, nightly dedup cron, email digest parser.
- **Phase 4**: Counselor portal — roster view, essay-draft approvals, deadline notifications.
