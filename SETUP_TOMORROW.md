# ScholarshipOS — Setup for Tomorrow

Two parts:

1. Publish today's code to git (2 commits, ~5 min)
2. Wire up deadline reminder emails (~30 min including DNS wait)

When you're done, delete this file or move it into `docs/`.

---

## Part 1 — Publish today's code

Open a terminal and run the following as one block. Both commits should
push cleanly; if either errors out, stop and come back.

```bash
cd /Users/shawn/Documents/Claude/Projects/ScholarshipOS

# --- Commit 1: Homepage rewrite + social share buttons ---
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

# --- Commit 2: Deadline reminder cron infrastructure ---
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

# --- Push both ---
git push
```

Wait for Vercel to finish its deploy (watch the status in the Vercel
dashboard). The reminder cron will start firing daily at 14:00 UTC but
will safely no-op until Part 2 is done.

---

## Part 2 — Wire up reminder emails

### 2.1  Apply migration 008 to prod Supabase

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste the contents of `supabase/migrations/008_sent_reminders.sql`
   from the repo.
3. Click **Run**. Expect "Success. No rows returned."

Verify (optional):

```sql
select count(*) from public.sent_reminders;
```

Should return `0`.

### 2.2  Set up Resend

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

### 2.3  Add env vars to Vercel

In your Vercel project → **Settings → Environment Variables**, add
these for the **Production** environment:

| Key                   | Value                                          |
|-----------------------|------------------------------------------------|
| `RESEND_API_KEY`      | `re_...` from step 2.2                         |
| `EMAIL_FROM`          | `ScholarshipOS <no-reply@scholarshipos.app>`   |
| `NEXT_PUBLIC_APP_URL` | `https://scholarshipos.app` (your prod URL)    |

Confirm `CRON_SECRET` is already set (should exist from the scrape
route). If not, generate one with `openssl rand -hex 32` and add it.

After adding, trigger a redeploy: **Deployments → latest → ... →
Redeploy**. Env vars take effect on the next function invocation but
redeploying ensures the cron hook is registered fresh.

### 2.4  Dry-run the reminder route

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

### 2.5  Live test

Drop `?dryRun=1` and run the route for real:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://YOUR_DOMAIN/api/reminders"
```

All `results` entries should show `"status": "sent"`. Check Avery's
inbox for a digest email with urgency pills and a "Open your pipeline"
button. Verify the dedup table recorded the send:

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

**"RESEND_API_KEY or EMAIL_FROM not configured — reminder run is a
no-op"** — env vars didn't take. Re-check Vercel → Settings →
Environment Variables → **Production** (not Preview/Development).
Redeploy to force a fresh function instance.

**"Unauthorized" 401** — the `Authorization: Bearer $CRON_SECRET`
header doesn't match. Copy the secret fresh from Vercel.

**"relation public.sent_reminders does not exist"** — migration 008
wasn't applied. Re-run step 2.1.

**Email landed in spam** — expected on first sends from a new domain.
Move to inbox once so Gmail/Outlook learn. If it's consistently spam,
DMARC alignment is usually the cause — verify the DKIM record in
Resend is green.

**Vercel cron isn't firing** — custom cron schedules (like
`0 14 * * *`) require Vercel Pro ($20/mo). On Hobby, change the
schedule in `vercel.json` to `"daily"` (midnight UTC) or upgrade.

---

## Rough time estimate

- Part 1 (git): 5 min
- 2.1 migration: 2 min
- 2.2 Resend + DNS: 5 min active work, then wait on propagation
- 2.3 env vars: 3 min
- 2.4 dry-run: 2 min
- 2.5 live test: 5 min

Total: ~25 min active, plus DNS wait.
