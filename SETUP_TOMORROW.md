# ScholarshipOS — Setup for Tomorrow

Three parts:

1. Publish today's + overnight code to git (4 commits, ~10 min)
2. Apply Supabase migrations 008 and 009 to prod (~5 min)
3. Wire up deadline reminder emails — Resend + env vars (~25 min incl. DNS wait)

When you're done, delete this file or move it into `docs/`.

> New since last check-in: multi-format manual upload (URL/PDF/DOCX/paste),
> the cost-protection rate-limit system (migration 009 + `src/lib/rateLimits.ts`
> wired into every Claude-backed route), four design docs in `docs/`, and a
> friendlier /matches empty-state. Details below.

---

## Part 1 — Publish overnight work to git

Open a terminal and run these commits one at a time. If any fails, stop
and come back — don't force-push through an error.

```bash
cd /Users/shawn/Documents/Claude/Projects/ScholarshipOS
```

### Commit 1 — Homepage rewrite + social share (from earlier session)

```bash
git add src/app/page.tsx src/components/SocialShare.tsx
git commit -m "landing: 'operating system' hero + walled-garden section + social share

Reposition the home page around the scholarship-OS framing:
- Hero leads with 'The operating system for winning scholarship money'
- New section pitches the walled-garden pivot: upload any URL/PDF and
  Claude parses it straight into the pipeline (private per-student)
- Feature strip expanded to 4 cards led by 'Upload anything'
- Stats tile softened: 'Growing' local index (avoid overclaiming)
- How-it-works step 2 now mentions the upload escape hatch

New SocialShare client component:
- One-click share buttons for X, Facebook, LinkedIn, WhatsApp
- Copy-link button with 2s 'Copied' confirmation
- Share URL derived from window.location at click-time so preview
  deploys and local dev share the correct origin"
```

### Commit 2 — Deadline reminder cron (from earlier session)

```bash
git add supabase/migrations/008_sent_reminders.sql \
        src/lib/reminders \
        src/app/api/reminders \
        src/lib/supabase/admin.ts \
        vercel.json \
        .env.example
git commit -m "reminders: daily deadline digest via Resend + Vercel cron

New pipeline:
- Migration 008 adds sent_reminders dedup table with unique
  (application_id, days_before_deadline). Three thresholds: 7, 3, 1.
- /api/reminders route gated by CRON_SECRET (same secret as /api/scrape).
- src/lib/reminders/send.ts pulls active apps with matching deadlines,
  drops anything already-sent, groups by user, and sends one digest per
  student via Resend's REST API (no SDK dep).
- src/lib/reminders/email.ts renders an inline-styled HTML digest with
  urgency pills (red/amber/indigo) + plain text fallback.
- vercel.json adds a daily cron at 14:00 UTC (9-10am ET depending on DST).
- Respects profiles.allow_marketing_emails opt-out and profiles.onboarded.
- Early-exits as a no-op if RESEND_API_KEY or EMAIL_FROM aren't set, so
  the cron can ship safely before ops setup is complete.

Idempotent: sent_reminders unique constraint means re-running the cron
on the same day is a no-op. Per-user error handling so one failed send
doesn't abort the batch."
```

### Commit 3 — Multi-format manual upload (URL / PDF / DOCX / TXT / paste)

```bash
git add package.json package-lock.json \
        src/lib/manual/extractText.ts \
        src/lib/manual/extractOne.ts \
        src/lib/manual/fetchUrl.ts \
        src/app/api/scholarships/import/route.ts \
        src/components/ManualAddForm.tsx
git commit -m "manual-add: multi-format extract (URL, PDF, DOCX, TXT, paste)

Rework the student's manual 'add a scholarship' flow into a 3-tab
surface with real cost discipline:

- ManualAddForm now has 'Paste a URL' / 'Upload a file' / 'Paste text'
  tabs. Paste mode is the cheapest path — no fetch, no parse, no OCR.
- New src/lib/manual/extractText.ts dispatches by format:
  pdf -> pdf-parse, docx -> mammoth, txt/md -> native UTF-8 decode,
  paste -> identity. All paths normalize whitespace, dedup page
  boilerplate (lines seen >=3x, 'Page X of Y', lone page numbers)
  then run a scholarship-keyword gate. Non-matches short-circuit
  with a friendly 'not_scholarship' error BEFORE we burn a Haiku call.
- Import route accepts mode=url|upload|paste with 5MB cap on uploads
  and a 5M-char ceiling on paste. URL path also runs the result
  through the keyword gate (a URL that loads but isn't about a
  scholarship is a real case).
- extractOne now returns real token counts from Anthropic's usage
  field so the rate limiter records honest numbers.

Adds mammoth@^1.12.0 for DOCX parsing. pdf-parse was already in tree."
```

### Commit 4 — Cost-protection rate-limit system + /matches copy + docs

```bash
git add supabase/migrations/009_claude_usage_events.sql \
        src/lib/rateLimits.ts \
        src/components/RateLimitBanner.tsx \
        src/components/EssayCoach.tsx \
        src/app/api/essay/start/route.ts \
        src/app/api/essay/answer/route.ts \
        src/app/api/essay/draft/route.ts \
        src/app/api/vault/adapt/route.ts \
        src/app/matches/page.tsx \
        docs/HAIKU_COST_ANALYSIS.md \
        docs/SCALABILITY_STUDY.md \
        docs/SECURITY_ANALYSIS.md \
        docs/SCRAPER_EXPANSION_NOTES.md
git commit -m "cost-protection: per-user daily caps + burst limits on all Claude routes

Four-part cost ceiling so a single student or bad actor can't run up a
Haiku bill overnight:

- Migration 009 creates claude_usage_events, an event-sourced log of
  every Claude call (user_id, kind, tokens_in, tokens_out, created_at).
  RLS: select-own only; writes go through the admin client.
- src/lib/rateLimits.ts provides checkRateLimit() and recordUsage():
    * Rolling 24h daily cap per kind (30 coaching turns, 5 drafts, 50
      manual-adds, 20 refines, 10 vault adapts, 5 interview starts).
    * 4000-token per-request input cap (rose banner: 'too much text').
    * New-account burst limit: 5 Claude calls in first 10 min after
      signup, to kill sign-up-and-spam attacks before they start.
- RateLimitBanner + EssayCoach render amber-tone 'wait a bit' UX with
  reset-time labels; input_too_large renders rose-tone 'fix your input'.
- Wired into /api/essay/{start,answer,draft}, /api/vault/adapt, and
  /api/scholarships/import. Scrape extract runs server-side under
  CRON_SECRET and doesn't need the per-user gate.

Also in this commit:
- /matches empty-state no longer tells the user to 'run npm run
  scrape:local' (dev copy that leaked into the student surface).
  Replaced with 'No local scholarships to show just yet — new ones
  are added as we find them' + the manual-add CTA.
- docs/ adds four studies written overnight:
    HAIKU_COST_ANALYSIS.md    - per-session cost model + pricing tier
    SCALABILITY_STUDY.md      - Vercel Hobby + Supabase Free ceilings
    SECURITY_ANALYSIS.md      - public-repo theft/exposure review
    SCRAPER_EXPANSION_NOTES.md - what running locally does/doesn't unlock"
```

### Push all four

```bash
git push
```

Wait for Vercel to finish deploying (watch it in the Vercel dashboard).
The reminder cron will start firing daily at 14:00 UTC but will safely
no-op until Part 3 is done.

---

## Part 2 — Apply Supabase migrations to prod

Two migrations need to run in prod for the new code to work end-to-end.
**Run them in order (008 first, then 009).** Each is idempotent-ish
(uses `create table if not exists`), so re-running a migration that
already applied is harmless.

### 2.1 Migration 008 — `sent_reminders`

Required for the deadline reminder cron (Part 3).

1. Open Supabase project → **SQL Editor** → **New query**.
2. Paste the contents of `supabase/migrations/008_sent_reminders.sql`.
3. Click **Run**. Expect "Success. No rows returned."

Verify:

```sql
select count(*) from public.sent_reminders;
```

Should return `0`.

### 2.2 Migration 009 — `claude_usage_events`

Required for the rate-limit system to work. **Skipping this will cause
every Claude-backed route to error** because `checkRateLimit()` queries
this table on every call.

1. SQL Editor → New query.
2. Paste the contents of `supabase/migrations/009_claude_usage_events.sql`.
3. Click **Run**.

Verify:

```sql
select count(*) from public.claude_usage_events;
```

Should return `0`. Also verify RLS is on:

```sql
select rowsecurity from pg_tables
where schemaname='public' and tablename='claude_usage_events';
```

Should return `t`.

### 2.3 Smoke-test the Claude-backed routes

After the deploy is live:

- Open the app, start an essay coaching session.
- Confirm the first Claude turn returns normally (no 500).
- In Supabase → Table editor → `claude_usage_events`, confirm a row
  appeared with `kind='coach_interview_start'` and non-zero token
  counts.

If the call errors with anything that mentions `claude_usage_events`,
migration 009 didn't apply. Re-run step 2.2.

---

## Part 3 — Wire up reminder emails

### 3.1 Set up Resend

1. Sign up at https://resend.com (free tier is enough to start).
2. **Domains → Add Domain** → enter your production domain
   (e.g. `scholarshipos.app`).
3. Resend shows 3–4 DNS records (SPF, DKIM, DMARC). Add them as TXT
   records at your DNS provider (Vercel DNS, Cloudflare, Namecheap…).
4. Wait 5–15 min, then click **Verify DNS** in Resend. Can take a few
   hours in worst case.
5. Once verified: **API Keys → Create API Key**. Name it
   `scholarshipos-prod`, scope "Full access", copy the key (starts
   with `re_...`).

**Shortcut if you don't want to wait on DNS:** use Resend's sandbox
address `onboarding@resend.dev` as `EMAIL_FROM` below. It only
delivers to the account-owner email, but that's enough to verify the
pipeline works. Finish DNS verification later.

### 3.2 Add env vars to Vercel

In your Vercel project → **Settings → Environment Variables**, add
these for the **Production** environment:

| Key                   | Value                                          |
|-----------------------|------------------------------------------------|
| `RESEND_API_KEY`      | `re_...` from step 3.1                         |
| `EMAIL_FROM`          | `ScholarshipOS <no-reply@scholarshipos.app>`   |
| `NEXT_PUBLIC_APP_URL` | `https://scholarshipos.app` (your prod URL)    |

Confirm `CRON_SECRET` is already set (should exist from the scrape
route). If not, generate one with `openssl rand -hex 32` and add it.

After adding, trigger a redeploy: **Deployments → latest → ... →
Redeploy**. Env vars take effect on the next function invocation but
redeploying ensures the cron hook is registered fresh.

### 3.3 Dry-run the reminder route

Grab your `CRON_SECRET` from Vercel and run (replace the two
placeholders):

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://YOUR_DOMAIN/api/reminders?dryRun=1"
```

You'll get JSON back like:

```json
{
  "candidates": 2,
  "after_dedup": 2,
  "users_notified": 1,
  "results": [
    { "user_id": "...", "email": "avery@...", "items": 2, "status": "sent" }
  ]
}
```

- `candidates`       → apps with a deadline 7 / 3 / 1 days out
- `after_dedup`      → candidates minus any already emailed about
- `users_notified`   → students who'd get an email

If `candidates: 0`, no student currently has an application with a
deadline in that window. To test the flow end-to-end, temporarily edit
a scholarship row in Supabase (`update public.scholarships set deadline
= current_date + 7 where id = '...';`) and re-run the dry-run.

### 3.4 Live test

Drop `?dryRun=1` and run the route for real:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://YOUR_DOMAIN/api/reminders"
```

All `results` entries should show `"status": "sent"`. Check the test
student's inbox for a digest email with urgency pills and a "Open your
pipeline" button. Verify the dedup table recorded the send:

```sql
select user_id, application_id, days_before_deadline, sent_at
from public.sent_reminders
order by sent_at desc
limit 10;
```

From here the Vercel cron runs the same code daily at 14:00 UTC
without you lifting a finger.

---

## Troubleshooting

**Claude routes error with "claude_usage_events does not exist"** —
migration 009 wasn't applied. See step 2.2.

**"RESEND_API_KEY or EMAIL_FROM not configured — reminder run is a
no-op"** — env vars didn't take. Re-check Vercel → Settings →
Environment Variables → **Production** (not Preview/Development).
Redeploy to force a fresh function instance.

**"Unauthorized" 401 on /api/reminders** — the
`Authorization: Bearer $CRON_SECRET` header doesn't match. Copy the
secret fresh from Vercel.

**"relation public.sent_reminders does not exist"** — migration 008
wasn't applied. Re-run step 2.1.

**Rate-limit banner appears immediately on first Claude call** —
usually a clock-drift issue with the rolling-24h window. Check
`claude_usage_events` for rows you don't recognize. If it's a bad-
actor signup, check the new-account burst limiter is firing as
intended (5 calls in 10 min for <10-min-old accounts).

**Email landed in spam** — expected on first sends from a new domain.
Move to inbox once so Gmail/Outlook learn. If it's consistently spam,
DMARC alignment is usually the cause — verify the DKIM record in
Resend is green.

**Vercel cron isn't firing** — custom cron schedules (like
`0 14 * * *`) require Vercel Pro ($20/mo). On Hobby, change the
schedule in `vercel.json` to `"daily"` (midnight UTC) or upgrade.

---

## Rough time estimate

- Part 1 (git, 4 commits):           ~10 min
- Part 2.1 + 2.2 migrations:         ~5 min
- Part 2.3 smoke-test:               ~3 min
- Part 3.1 Resend + DNS:             ~5 min active, then wait on propagation
- Part 3.2 env vars:                 ~3 min
- Part 3.3 dry-run:                  ~2 min
- Part 3.4 live test:                ~5 min

Total: ~35 min active, plus DNS wait on Resend.

---

## Where the new design docs live

Four studies were written overnight and live in `docs/`:

- `docs/HAIKU_COST_ANALYSIS.md` — per-session Haiku cost model; justifies the $49/year pricing tier.
- `docs/SCALABILITY_STUDY.md` — Vercel Hobby + Supabase Free ceilings; where the 300-active-user limit comes from.
- `docs/SECURITY_ANALYSIS.md` — public-GitHub theft/exposure review; pre-publication checklist + where the real moat lives.
- `docs/SCRAPER_EXPANSION_NOTES.md` — what running scrapers locally actually unlocks (TL;DR: not as much as it feels); Fastweb/Niche/BigFuture stay off the target list regardless of IP.

Read them when you have coffee. None require action; they're context for future calls.
