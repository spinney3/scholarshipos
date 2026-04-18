# ScholarshipOS

Phases 1 + 2 of ScholarshipOS — a scholarship discovery, pipeline-tracking, and AI essay coaching app for high school students. Built with **Next.js 14 (App Router)**, **Tailwind CSS**, **Supabase** (Postgres + Auth + RLS), and the **Claude API** (`claude-sonnet-4-6`).

## What's in Phase 1

- Email/password authentication via Supabase Auth.
- A 4-step onboarding wizard (name, GPA, ZIP, interests, financial need).
- A seeded scholarship catalog (24 records — national and ZIP-scoped).
- A rule-based matching page that filters and ranks scholarships against the student's profile.
- A drag-and-drop Kanban pipeline with six columns: Discovered → Eligible → In Progress → Submitted → Won → Lost, backed by `@dnd-kit`.
- Row-Level Security on every table — students can only read/write their own rows.

## What's in Phase 2

- **Socratic essay coach.** Clicking **Essay →** on any Kanban card opens `/essay/[applicationId]`. Claude conducts a 3–5 question Socratic interview, asking one targeted question at a time about the student's lived experience relevant to that scholarship's essay prompt.
- **First-draft generation in the student's voice.** Once the interview is done, Claude produces an outline plus a ~500-word first-person draft using *only* the student's own words and specifics — the system prompt explicitly forbids fabricating details, which is how these essays avoid getting flagged.
- **Inline draft refinement with version history.** Students edit the draft in place and save as new versions; every Claude-generated and student-edited version is kept in `essay_drafts` so the history is never lost. A **Regenerate from interview** button reruns the draft pass without discarding prior versions.
- **Full persistence.** Interviews, prompts, statuses, and every draft version are stored in Supabase and locked down with the same RLS pattern as Phase 1 — students only see their own rows.

## Project structure

```
src/
  app/
    api/essay/         Phase 2 route handlers: start, answer, draft, refine
    essay/[applicationId]/page.tsx   Essay coaching page (server-rendered shell)
    ...                Landing, login, signup, onboarding, matches, kanban, auth callback
  components/          Navbar, OnboardingWizard, MatchList, KanbanBoard, KanbanColumn, KanbanCard, EssayCoach
  lib/
    matching.ts        Rule-based scholarship matcher
    types.ts           Shared TypeScript types + constants
    anthropic.ts       Server-only Anthropic SDK client (Phase 2)
    essayPrompts.ts    System prompts + transcript adapters for the coach (Phase 2)
    supabase/
      client.ts        Browser Supabase client
      server.ts        Server Component / Route Handler client
      middleware.ts    Session refresh + auth guard
  middleware.ts        Next middleware entry (wraps lib/supabase/middleware.ts)
supabase/
  migrations/001_initial_schema.sql   Phase 1 schema, triggers, RLS
  migrations/002_essay_schema.sql     Phase 2: essays + essay_drafts tables, RLS, prompt backfill
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
4. Paste the contents of `supabase/migrations/002_essay_schema.sql` and run it (this adds the essay tables and backfills sample essay prompts on the seeded scholarships).

Or with the [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
supabase db push
psql "$DATABASE_URL" -f supabase/seed.sql
```

### 3a. Add an Anthropic API key

The essay coach requires `ANTHROPIC_API_KEY` in `.env.local`. Get one from <https://console.anthropic.com/>. The key is read server-side only (no `NEXT_PUBLIC_` prefix) and never exposed to the browser — all Claude calls go through `/api/essay/*`.

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
3. Add these environment variables under **Settings → Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY` (mark as **not** exposed to the browser — no `NEXT_PUBLIC_` prefix)
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

## How the essay coach works

`src/lib/essayPrompts.ts` holds the two system prompts that govern the flow:

1. **Interviewer system prompt** — instructs Claude to ask exactly one specific question per turn, drilling into concrete moments and avoiding generic "what are you passionate about" prompts. It's explicitly forbidden from writing prose for the student. Once it has enough material (target: 3–5 substantive answers), it emits the literal token `[READY_TO_DRAFT]`, which the `/api/essay/answer` route detects to flip `essays.status` from `interviewing` to `drafting`.
2. **Drafter system prompt** — handed the full transcript, asked to return a JSON object `{outline, draft}` inside a fenced block. The hard rule is *use only material the student actually said* — no invented names, dates, or feelings. The route parses the JSON, persists v1 in `essay_drafts`, and flips status to `refining`.

Inline edits go through `/api/essay/refine`, which never calls Claude — student edits are saved verbatim as a new `source: "user"` version. **Regenerate from interview** reruns the drafter without discarding prior versions; it just inserts a new Claude version with the next version number.

## Roadmap

- **Phase 2.5** (next): essay vault with reusable building blocks tagged by prompt type; AI-ranked match scoring using win-probability signals.
- **Phase 3**: Playwright scraper targeting community-foundation sites by ZIP, nightly dedup cron, email digest parser.
- **Phase 4**: Counselor portal — roster view, essay-draft approvals, deadline notifications.
