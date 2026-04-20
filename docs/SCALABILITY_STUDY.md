# Scalability Study — Vercel Hobby + Supabase Free

Last updated: 2026-04-19

## TL;DR

On the current free-tier stack (Vercel Hobby + Supabase Free + Anthropic pay-per-use), ScholarshipOS can comfortably support **roughly 200–400 active student accounts** before hitting a hard ceiling. The binding constraint is **Supabase Free (500MB database + 5GB egress + 50k monthly active auth users)**, followed by **Vercel's Hobby function-invocation budget**. Anthropic costs are pay-per-token and scale linearly — they're a margin question, not a ceiling question.

"Active" here means a student who logs in at least once a month, adds a handful of scholarships, and runs a coaching session or two. Waitlist signups who never come back don't count against most of these limits.

## Per-platform limits

### Vercel Hobby
- **Function invocations:** 100,000 per month. A typical active student triggers ~50–80 function calls/month (page loads, kanban updates, coaching turns, extract calls). Ceiling lands around **1,200–2,000 monthly active students** on invocations alone.
- **Function execution time:** 10-second default per invocation (we've set `maxDuration = 30` on the scrape and import routes, but Hobby caps those at 10s, so anything above will silently truncate on prod). The nightly scraper runs locally, so this is fine — but any future long-running server cron will hit this.
- **Cron jobs:** Hobby allows 2 cron jobs with daily-only frequency. We currently run zero server-side crons (scraper is local).
- **Bandwidth:** 100GB/month. Next.js static assets + API JSON is small; realistic usage is ~100MB per active student per year, so bandwidth is not a near-term concern.
- **Build minutes:** 6000/month on Hobby — unlikely to hit unless we set up per-commit preview deploys.

**Vercel ceiling estimate:** ~1,500 active students. Pro ($20/mo) removes these limits.

### Supabase Free
- **Database storage: 500MB.** This is the real pinch point. Row counts to watch:
  - `scholarships` table: a populated national catalog is ~500k rows × ~500 bytes = 250MB just for the catalog. **This alone can blow the limit if we grow the catalog nationally.** Philly-only keeps us at ~2k rows = 1MB, trivially fine.
  - `applications` table: one row per student per scholarship they track. 300 students × 30 saved scholarships = 9k rows × 200 bytes ≈ 2MB.
  - `essay_*` tables (drafts, building blocks, transcripts): a typical student's essay workspace is ~10–50KB. 300 students ≈ 15MB.
  - `claude_usage_events`: event-sourced log, ~200 bytes/row. 300 students × 100 events/year ≈ 6MB/year. Prune quarterly to stay under 20MB.
- **Egress bandwidth: 5GB/month.** Page loads are light; the only heavy read is the scholarship catalog on /matches. 300 active students × 50 page loads × 100KB avg = 1.5GB/month. Room to grow, but logged scraper output downloads could blow this if exposed to users.
- **Auth MAUs: 50,000.** Effectively unlimited for our scale.
- **Realtime connections: 200 concurrent.** We don't currently use realtime; no concern.
- **Edge function invocations: 500k/month.** We use Supabase client-side, not edge functions. No concern.

**Supabase ceiling estimate:** ~300–400 active students, assuming we keep the catalog scoped to Philly/PA. National catalog growth blows DB storage well before we hit user count.

### Anthropic (Claude Haiku 4.5)
Pay-per-token, so there's no "ceiling" in the free-tier sense — only a cost-per-student. Assuming the rate limits in `src/lib/rateLimits.ts` hold:
- Typical active student: ~$0.10–0.30/month in Claude costs (a few coaching sessions + a few manual adds).
- Heavy student who hits daily caps: ~$1.50/month.
- 300 active students, mixed usage: **~$60–90/month** in Claude API cost.

With $49/year tier pricing (see HAIKU_COST_ANALYSIS.md), Claude cost is ~4–6% of revenue. Not a scaling concern.

## Where the ceiling actually is

Ranked by which limit bites first for a Philly-focused launch:

1. **Supabase DB storage (500MB)** — ~300 active students before `claude_usage_events` + essays + applications start squeezing. Mitigated cheaply by pruning events quarterly.
2. **Vercel function invocations (100k/month)** — ~1,500 active students at realistic traffic. Effectively "upgrade to Pro" is the answer.
3. **Supabase egress (5GB/month)** — depends on page-load patterns; likely safe to 500+.
4. **Anthropic spend** — not a ceiling, a margin line. Scales with pricing tier.

## Upgrade paths

When we hit ~250 active students, plan the following in order:

1. **Prune `claude_usage_events` to last 90 days** via a Supabase scheduled function. Keeps the free tier alive an extra 6 months.
2. **Move to Supabase Pro ($25/mo)** — 8GB DB, 250GB egress, no MAU cap. Single biggest headroom unlock.
3. **Move to Vercel Pro ($20/mo)** — lifts function invocations and enables custom crons (so we can stop running the scraper on your laptop).
4. **Add a Redis rate-limit cache** (Upstash free tier) — currently rate limiting hits Supabase on every Claude call. Fine at 300 users, but at 1k+ the `claude_usage_events` COUNT query becomes a noticeable latency tax. Redis counter with sliding window fixes it.

Total upgrade cost to support ~5,000 active students: **$45/month** of infra + linear Anthropic spend.

## What to watch in metrics

Set up monthly checks on:
- Supabase dashboard → Settings → Usage → Database size (alert at 400MB)
- Supabase dashboard → Settings → Usage → Egress (alert at 4GB)
- Vercel dashboard → Usage → Function Invocations (alert at 80k)
- Anthropic console → Usage → daily spend (alert at $5/day)

A single dashboard with all four would be cleaner — worth building once we're past 100 users.
