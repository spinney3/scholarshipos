# Security Analysis — Public GitHub Repo

Last updated: 2026-04-19

## TL;DR

Making the ScholarshipOS repo public carries **low direct risk** to the running app and **moderate competitive risk** to the business. The operational risks are all already mitigated (secrets live in environment variables, not code; Supabase RLS enforces per-user data isolation at the database layer). The competitive risk is real but also realistic — someone who wants to clone this could clone Fastweb's public site just as easily. The *moat* is the local scraper + counselor relationships + Philly data, none of which is in the repo.

## What's in the repo that matters

A public repo publishes:
- All application source code (Next.js routes, React components, business logic)
- All prompts sent to Claude (coaching prompts, extraction prompts, adapter prompts)
- The Supabase schema (migrations/)
- The scraper source list (`src/lib/scraper/sources/local.ts`)
- Documentation (design notes, cost analysis, this file)

A public repo does NOT publish:
- Any `.env` values (API keys, DB credentials, service-role tokens)
- Any data in Supabase (scholarship rows, user rows, essay drafts)
- Any Vercel environment variables
- Any Anthropic API keys
- The scraped output CSV/SQL dumps (kept in local-only working dirs)

**Confirm before going public:** `git log --all --full-history --source -- '*.env*'` returns nothing, and no API key string appears in any commit. If either fails, rotate the exposed key BEFORE making the repo public — git history is forever.

## Direct attack surfaces

Going public doesn't *create* these, but it makes them easier to study. Each is already mitigated:

### 1. Supabase Row-Level Security (RLS)
All user-scoped tables (`applications`, `essay_drafts`, `essay_building_blocks`, `claude_usage_events`) require `auth.uid() = user_id` to read or write. A stranger reading the source sees the schema — they still can't read your users' data without an authenticated session.

**Verify:** run `select tablename, rowsecurity from pg_tables where schemaname = 'public';` in Supabase SQL editor. Every user-data table must show `rowsecurity = t`.

### 2. Service-role key exposure
The admin Supabase client uses the service-role key (bypasses RLS). It's only used in server-side API routes. The key itself is in Vercel env vars, not in the code. Public repo shows `createAdminClient()` call sites — which is fine; knowing the code uses an admin client doesn't let an attacker impersonate it.

**Watch for:** any future commit that accidentally hardcodes a key. Add a pre-commit hook (`gitleaks` or `detect-secrets`) to catch this.

### 3. Anthropic key exposure
Same story — server-side only, lives in env vars. The code reveals *which model* we call and *which prompts* we send, neither of which is an attack vector.

### 4. Rate limiting bypass
The limits in `src/lib/rateLimits.ts` are visible. A motivated attacker who signed up legitimately could study the caps and craft inputs right at the boundary. Mitigation: caps are generous (30 coaching turns/day is well above normal use), and the daily cap is a hard wall — there's no bypass to find in the code.

**Minor improvement:** the `CHARS_PER_TOKEN = 4` heuristic is a slight undercount. An attacker could optimize a 3999-char input to consume ~1100 real tokens. Currently not worth caring about; revisit if we see abuse.

### 5. Prompt injection via user inputs
Every Claude call accepts untrusted user text (scholarship URLs, pasted text, essay answers). The prompts all use clear delimiters and "extract fields only" instructions, but a user could theoretically try to get the extractor to emit unrelated content or exfiltrate the system prompt.

**Mitigation in place:** all Claude responses are parsed as JSON with fallback to placeholder data. The worst case is a degraded extraction, not a system compromise. The coaching routes return free-text back to the user who submitted the input — so "exfiltrating the system prompt" just shows them our system prompt, which is public in the repo anyway. No escalation path.

### 6. Scraper source list
Community-foundation sites we scrape are public-facing. Listing them in the code doesn't materially change their exposure — anyone can find them via Google "[city] community foundation scholarships." The list is useful for someone cloning the app; it's not a vulnerability.

## Competitive / theft risk

"Can someone clone this and launch a competitor?"

**Yes, technically.** A reasonably skilled developer could fork the repo, stand up their own Supabase + Vercel + Anthropic accounts, and have a working copy in a few hours. Every open-source SaaS lives with this tension.

**What they'd lack:**
- **The Philly scholarship data.** The scraped rows are in our Supabase, not the repo. They'd have to re-run the scraper (we'd still be ahead by however long we've been collecting).
- **Counselor relationships.** The counselor portal is a workflow, not a pile of code. Getting actual counselors to adopt it is the hard part.
- **Brand / domain / SEO.** Students Google "philadelphia local scholarships," not "scholarshipos." By the time a clone ranks, we own the keyword.
- **Iteration speed.** A clone is frozen at whatever commit they forked from. We keep shipping.

**What the moat actually is:** the local data pipeline + the counselor workflow + the two years of compounding Philly coverage — none of which is in the repo.

**What to consider if this becomes a real concern:**
1. **Dual-license**: code under AGPL (anyone who runs a modified version must publish their changes), scholarship data under a separate commercial license.
2. **Make the scraper proprietary**: move `src/lib/scraper/sources/*` and the playwright runner into a separate private repo, keep the product code public. Preserves open-source goodwill while gating the moat.
3. **Don't worry about it until someone actually clones.** This is probably the right answer for now. "My open-source app got stolen" is a high-quality problem to have at 10,000 users. At 10 users, it's a non-issue.

## Recommended actions

**Now (before making public):**
- [ ] Run `git log -p -- '**/.env*'` and confirm no env files were ever committed.
- [ ] Search commit history for obvious secrets: `git log -p | grep -iE 'sk-|supabase.*service_role|anthropic.*key'`.
- [ ] Confirm RLS is enabled on `applications`, `essay_drafts`, `essay_building_blocks`, `claude_usage_events` tables in the Supabase dashboard.
- [ ] Add `.env*` to `.gitignore` (probably already there — verify).

**Soon (first week of public):**
- [ ] Add `gitleaks` as a pre-commit hook to catch accidentally committed keys.
- [ ] Enable GitHub Dependabot security alerts.
- [ ] Add a `SECURITY.md` to the repo with a disclosure email for vulnerability reports.

**Eventually (if growing):**
- [ ] Write a LICENSE file — MIT is the friendly default; AGPL is the "I want clones to publish their changes" option.
- [ ] Consider moving the scraper source list to a private sibling repo if the catalog becomes a meaningful moat.
- [ ] Add a bug-bounty program or `SECURITY.md` with disclosure policy once you have real users.

## One thing worth saying out loud

Public repos are a net positive for solo-founder tools like this. Counselors and schools are more likely to trust software they can inspect. "Here's exactly what the AI coach prompts" is a feature, not a weakness, in a market that's allergic to AI-essay-generator snake oil. Lean into it.
