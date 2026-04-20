# Haiku cost analysis & pricing floor

_Last updated: 2026-04-19. Re-verify pricing before baking numbers into
marketing copy or contracts — Anthropic's list prices can change._

## Model in use

- **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`)
- Used by: single-scholarship extractor (`extractOneScholarship`), future
  essay coach, future Claude-ranked match scoring.
- Public list price (as of this writing):
  - **$1.00 per 1M input tokens**
  - **$5.00 per 1M output tokens**
  - **$0.10 per 1M cached input tokens** (prompt caching — 10× discount on
    the biggest cost driver for multi-turn conversations)

---

## Essay coaching session — cost model

A Socratic essay coach is a multi-turn conversation with a growing
context. Realistic session shape:

| Phase                              | Turns        | Input per turn          | Output per turn |
|------------------------------------|--------------|-------------------------|-----------------|
| System prompt (persona + rules)    | 1 (cached)   | ~1,500 tokens cached    | —               |
| Student context (profile, prompt)  | —            | ~1,000 tokens           | —               |
| Discovery Q&A (extract anecdotes)  | 8 turns      | +200 user msg + history | ~250            |
| Outline feedback                   | 3 turns      | full context (~5k)      | ~400            |
| Draft critique + line edits        | 4 turns      | full context (~7k)      | ~600            |

### Three scenarios

**Naive (no caching, resend full context each turn)**

- Input: ~15 turns × avg ~4,000 tokens = **~60,000 input tokens**
- Output: (250×8) + (400×3) + (600×4) = **~5,600 output tokens**
- Cost: (60k × $1.00/M) + (5.6k × $5.00/M) = $0.060 + $0.028 ≈ **$0.09 / session**

**With prompt caching (recommended default)**

- Cached reads: 14 turns × 2,500 = 35k cached input → 35k × $0.10/M = $0.0035
- Fresh input (history growth): ~25,000 tokens → $0.025
- Output: ~5,600 tokens → $0.028
- Cost: ≈ **$0.06 / session**

**Best case (aggressive caching, short common-app style essay)**

- ≈ **$0.03 / session**

### Per-student-per-year (essay coaching only)

Realistic senior-year shape:

- 4 unique essays drafted
- 3 coaching sessions per essay (first pass + 2 revision rounds) = 12 sessions
- ~10 shorter one-off "tighten this paragraph" turns (~$0.01 each)

**Essay-coach cost per student per year: ≈ $0.85.** Round to **$1**.

---

## Other Claude costs already live

| Surface                          | Trigger                           | Approx cost             |
|----------------------------------|-----------------------------------|-------------------------|
| Manual-add scholarship extractor | Each manual-add submission        | ~$0.02 per add          |
| Scholarship scrape (CCCF etc.)   | Nightly cron, ~70 rows            | ~$0.01 per scrape run   |
| Claude-ranked match scoring      | (Phase 2 — not yet live)          | ~$0.02 / student / month if built |

**All-in Claude cost per active student per year: ~$1.50 baseline, ~$3
if the student is an enthusiastic essay reviser.**

---

## Pricing recommendation

Plenty of headroom. Options from conservative to aggressive:

### 1. Freemium — $9.99/month

- Free tier: 3 essay sessions / month (covers ~$0.18 cost)
- Paid tier: unlimited sessions
- Gross margin on paid: **~95%**
- Competitive: Fastweb Premium is $25/mo, Going Merry Plus is in the same
  ballpark. ScholarshipOS at $9.99 undercuts and differentiates on local
  scope + coaching quality.

### 2. Annual flat — $49/year (RECOMMENDED)

- Covers the senior application window
- Gross margin: **94–97%** at expected usage
- Simpler billing, no month-to-month churn risk
- Good mental frame for parents: "one-time back-to-school cost"

### 3. One-time senior-year — $99

- Position alongside SAT prep. Parents pay this without blinking for
  anything college-adjacent.
- 97%+ margin
- Weaker recurring revenue story; stronger for pure paid-acquisition play.

### 4. Counselor / school license — $500–$2,000 / counselor / year

- 100–300 students per counselor
- At 200 students × $3 Claude cost = $600 against $1,500–$2,000 revenue
  = **60–70% margin**
- B2B stickiness: counselors don't churn monthly. This is the real
  scalable channel past ~10k students.

**My call:** ship **$49/year** (or $9.99/mo) for parents with a 3-session
free tier. Build the counselor channel quietly in parallel — that's the
engine for meaningful scale.

---

## Operational guardrails

Wire these up before any pricing goes public:

1. **Cap `max_tokens` on every Claude call.** Without a ceiling, a rambly
   response can 5× a turn's cost. Current caps:
   - `extractOneScholarship`: `max_tokens: 1024` ✅
   - Future essay coach: target `max_tokens: 1500` on coaching turns
   - Future match scorer: `max_tokens: 512` is plenty

2. **Daily per-student turn cap (~30 coaching turns/day).** Enough for
   any legitimate user, prevents shared-account or automation abuse from
   racking up $50 overnight.

3. **Server-side session boundary.** Start a new cached prompt context
   per essay, not one giant rolling context forever. Caching breaks down
   past ~50 turns anyway.

4. **Pricing volatility clause.** Don't hard-code $49 into a year-long
   contract. Quote "subject to adjustment at renewal" and revisit when
   Anthropic moves prices.

5. **Instrument cost per student.** Log input/output tokens per Claude
   call with user_id attached. Then a weekly `select user_id, sum(cost)
   from claude_usage` catches outliers before they become a bill.

---

## Quick lookup table

| Action                                     | Approx Claude cost |
|--------------------------------------------|--------------------|
| One manual-add extraction                  | $0.02              |
| One essay coaching session (cached)        | $0.06              |
| One-off "tighten this" turn                | $0.01              |
| 12 coaching sessions + 10 turns / year     | $0.85              |
| All-in per active student / year (est.)    | $1.50 – $3         |
| Break-even sub price (monthly)             | $0.30              |
| Break-even sub price (annual)              | $3.00              |

Margin is not the constraint. **Acquisition cost and retention** are.
Price accordingly.
