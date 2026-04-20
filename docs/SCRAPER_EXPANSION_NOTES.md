# Scraper Expansion Notes — What Running Locally Actually Unlocks

Last updated: 2026-04-19

## The framing that matters

Earlier I was going to write this doc as "now that we're running the scraper from a home IP, we can go after the 'borderline illegal' sources we had to skip when the scraper lived on Vercel." That framing is wrong. It conflates three distinct reasons we'd disabled sources, and lumping them together would lead us into decisions we'd regret.

The sources we've passed on break into three real categories:

1. **Technical dead ends** — no public catalog exists to scrape, or the one that exists is behind an auth wall (Salesforce, Foundant GrantInterface). Running the scraper locally does not unlock these; the data isn't on the public web to begin with.
2. **Deprioritized-but-working sources** — verified scrapers for other metros that were shelved when the project narrowed to Philly. These are fine to re-enable if and when we expand beyond PA.
3. **ToS-ambiguous aggregators** — Fastweb, Niche, BigFuture. These have public catalogs and aggressive bot protection (Cloudflare). Running from a residential IP *does* change what's technically possible here, but the ToS question doesn't move with the IP address.

Mixing these three together is how a solo founder ends up with a cease-and-desist. Keep them separate.

## Category 1 — Technical dead ends (skip permanently)

These are listed in `DISABLED_SOURCES` inside `src/lib/scraper/sources.ts` and they are NOT unlocked by running locally:

- **Philadelphia Foundation (philafound.my.site.com)** — Applications gated behind Salesforce Experience Cloud login. There is no public scholarship catalog to scrape; the foundation genuinely does not publish one. A residential IP doesn't unlock data that isn't published.
- **Berks County Community Foundation (BCCF)** — Uses Foundant GrantInterface, login-gated. Their `/scholarships/` page is marketing copy with no scholarship namespace. Same as above.
- **PHEAA state programs** — Not a catalog, it's single-program FAFSA-driven aid. Better modeled as a handful of seed.sql entries than a scraper target.
- **studentscholarships.org RSS** — Feed URL 404s after a redirect chain. Would need a different endpoint; none found.

**Action:** leave these disabled. Revisit annually to see if any of them publish a public catalog.

## Category 2 — Working-but-deprioritized (enable when we expand)

These scrapers worked during Phase 3 multi-metro exploration and were shelved only because the project narrowed to Philly per the project_audience memory. They are not ToS-risky, they are not login-gated — they just serve the wrong metros for our current user base.

Sources worth remembering (check git history for the URLs we verified):

- **Silicon Valley Community Foundation (svcf)** — /find-scholarships/svcf-managed-scholarships worked, yielded ~23 rows.
- **Seattle Foundation (seattle)**
- **The Denver Foundation / Daniels Fund (denver)** — we had a working sub-page URL
- **Chicago Community Trust (cct)**
- **Cleveland Foundation (cleveland)**
- **The Boston Foundation (tbf)**
- **New York Community Trust (nyct)**
- **Community Foundation for Greater Atlanta (cfga)**
- **Communities Foundation of Texas (cftexas)**
- **Greater Kansas City Community Foundation (gkccf)**

**Action:** when ScholarshipOS goes beyond PA (launch, waitlist hits critical mass in another metro, or we sign a counselor partnership in another city), restore these in one sprint. The scraper pipeline is metro-agnostic; just add the ScrapeSource entries and a zipMapping row.

**Do not** restore them now "because we can." That puts 100x the catalog weight on Supabase Free without 100x the users (see SCALABILITY_STUDY.md — DB storage is our tightest ceiling).

## Category 3 — ToS-ambiguous aggregators (the real conversation)

This is the category that the "I'm running locally now, so…" thinking actually applies to. And it's also where we need to be careful.

### What changes with a residential IP
- **Fastweb, Niche, BigFuture, ScholarshipOwl, Going Merry** use Cloudflare + bot-detection heuristics that block datacenter IPs and headless browsers. From Vercel, the scraper gets a challenge page and fails. From a residential IP with Playwright in non-headless mode, it probably succeeds.
- So yes: **running locally is technically what it takes to scrape these.** That part of the earlier intuition was right.

### What does NOT change with a residential IP
- **Their Terms of Service.** Fastweb's ToS explicitly prohibits automated access and scraping. Niche's does too. BigFuture is College Board, and they have a dedicated legal team for exactly this.
- **Robots.txt.** Fastweb and Niche disallow most crawlers on everything past their root page.
- **The fact that your scraping happens on your device, not on Vercel, is invisible to them.** The server receives the same requests either way. If they flag behavior, they flag it the same way.

### What to do about it

I've been back-and-forth on this. The honest version of the advice:

**Do not scrape Fastweb, Niche, or BigFuture as a standing part of the pipeline.**
- It violates their ToS.
- A CFAA / computer-fraud-and-abuse claim has been argued (and sometimes won) against scrapers of ToS-protected sites even when the data was public. *hiQ v. LinkedIn* narrowed this in 2022 but did not kill it, and you are not a well-funded startup with LinkedIn-scale litigation appetite.
- If ScholarshipOS ever wants a partnership with a school district, an enterprise sale, or a legal review, having "we scrape Fastweb" in the codebase is an instant blocker.

**What's fine instead:**
- Scrape the **primary sources** — community foundations, school district bulletins, Rotary chapters, church youth programs. These are where our moat lives anyway. Nobody else is aggregating them carefully.
- For national-catalog parity, **use Fastweb/Niche's public search as a human-in-the-loop tool**, not as a scraper target. If a user shares a scholarship URL, our manual-add pipeline handles it (and the ToS question is moot — one-shot user-initiated requests are not "automated access").
- If we genuinely need national aggregator data, **partner or license** — the College Scholarship Service (CSS) and some foundation consortiums publish feeds under commercial agreements. Worth checking before scraping.

### One nuance worth calling out
The "we're running locally" framing is seductive because it feels like the difference between getting caught and not getting caught. That's not actually what the legal/ethics line is about. The line is whether you're *entitled* to the data, not whether you can sneak past the door. A residential IP lets us sneak past; the door is still closed.

## What to do next

- [ ] Leave `SCRAPE_SOURCES` at the current PA-focused two entries (CCCF + PCHF) until we have a reason to expand.
- [ ] When the daughter (primary user) finds the Spring-Ford SD scholarship bulletin URL, promote the `spring-ford-sd` entry out of `CANDIDATE_SOURCES` — that's the single highest-value addition we can make right now.
- [ ] When Phoenixville Community Education Foundation (PCEF) confirms its scholarship catalog URL, promote `pcef` similarly.
- [ ] If we pick up a user in another metro with a reasonable foundation catalog, restore the relevant Category 2 source in a single PR.
- [ ] Do not add Fastweb, Niche, or BigFuture to `SCRAPE_SOURCES`. If there's ever a compelling reason to reconsider, it's a conversation that starts with legal review, not code.

## The principle for future decisions

> Residential IP changes what I *can* scrape. It does not change what I *should* scrape. When those two diverge, the "should" is the one that matters.
