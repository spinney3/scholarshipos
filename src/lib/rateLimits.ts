/**
 * Rate limits + cost guardrails for all Claude-calling surfaces.
 *
 * Three concerns, one module:
 *
 *   1. Daily caps — a single student shouldn't be able to make more than
 *      N coaching calls per rolling 24h window. At current Haiku prices
 *      this keeps worst-case daily spend per student bounded to a few
 *      dollars even if the account is shared or scripted.
 *
 *   2. New-account burst — fresh signups are the riskiest cohort: no
 *      track record, could be scripts or throwaways. We cap them harder
 *      for the first 10 minutes of account life. If a real student hits
 *      this cap they just wait a bit; a scraped/scripted attacker gets
 *      their first 5 calls and then runs into a wall.
 *
 *   3. Per-call input ceiling — no single Claude call should take more
 *      than 4,000 tokens of user-controlled input. This kills the
 *      "paste 50,000 words to see if the coach will rewrite it for me"
 *      vector without affecting any legitimate essay workflow (an essay
 *      draft is typically 400-800 words, well under the cap).
 *
 * Design notes:
 *
 *   - Event-sourced. We count rows in claude_usage_events rather than
 *     maintaining a counter. Cost is one indexed count() per check —
 *     fine at our volume — and we never have to worry about drift or
 *     forgetting to decrement after a refund.
 *
 *   - Admin client for reads AND writes. The rate limiter must be
 *     impossible for a user to tamper with, and going through the admin
 *     client (service role) guarantees we bypass any future RLS policy
 *     that could let a student forge their own usage rows.
 *
 *   - recordUsage is best-effort. If the insert fails we log but don't
 *     throw — the student already got their response, and losing a
 *     counter is worse than losing the feature. A failed insert shows
 *     up as "generous" (undercounted) limits for one window, which is
 *     acceptable degradation.
 *
 *   - Token estimation for the pre-call check uses a cheap char/4
 *     heuristic. Real OpenAI/Anthropic tokenizers are ~4 chars/token on
 *     English text; this heuristic tends to slightly UNDERcount which
 *     means the limit is marginally looser than advertised. Post-call
 *     recordUsage uses the real response.usage counts.
 */

import { createAdminClient } from "@/lib/supabase/admin";

// ---------------------------------------------------------------------------
// Public types + errors
// ---------------------------------------------------------------------------

export type UsageKind =
  | "coach_interview_start"
  | "coach_interview_turn"
  | "coach_draft"
  | "coach_refine"
  | "essay_adapt"
  | "manual_add"
  | "scrape_extract";

/**
 * Machine-readable codes surfaced to the client so the UI can pick the
 * right copy. Keep this union small — any new code must also be handled
 * by the EssayCoach component's error renderer.
 */
export type RateLimitCode =
  | "daily_cap"
  | "burst_cap"
  | "input_too_large"
  | "draft_cap";

export class RateLimitError extends Error {
  code: RateLimitCode;
  /** Suggested HTTP status for the route handler to return. */
  status: number;
  /** Non-PII info for the client — how long to wait, current counts, etc. */
  details: {
    limit: number;
    used?: number;
    resetAtIso?: string;
    maxTokens?: number;
    actualTokens?: number;
  };

  constructor(
    code: RateLimitCode,
    message: string,
    details: RateLimitError["details"],
    status = 429,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Limit configuration
// ---------------------------------------------------------------------------

/**
 * Per-kind daily caps in a rolling 24-hour window. Chosen to be
 * well above any plausible legitimate usage while capping worst-case
 * per-student-per-day cost at around $3 even if the attacker maxes
 * everything.
 */
const DAILY_CAPS: Record<UsageKind, number> = {
  coach_interview_start: 5, // starting 5 brand-new essays a day is extreme
  coach_interview_turn: 30, // the main chokepoint; 30 turns is ~1.5 full sessions
  coach_draft: 5,           // generating 5 fresh drafts/day is above any honest workflow
  coach_refine: 20,         // saving refinements is cheap but still worth capping
  essay_adapt: 10,          // vault adaptation — 10 reuses/day is plenty
  manual_add: 50,           // adding 50 scholarships manually/day is extreme
  scrape_extract: 1000,     // cron is the only caller; high cap prevents legit-use 429s
};

/** Burst window length for new accounts (ms). */
const BURST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Total coach-related calls allowed in a new account's first 10 minutes,
 * across ALL coach_* kinds combined. This is deliberately less than any
 * single daily cap — the message is "slow down, we want to verify you're
 * real before letting you consume a lot of tokens."
 */
const NEW_ACCOUNT_BURST_LIMIT = 5;

/** Per-call input ceiling in tokens. Applies to every kind. */
const MAX_INPUT_TOKENS_PER_CALL = 4000;

/** Roughly how many chars per token on English text (char/token heuristic). */
const CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Estimate token count from a string. Intentionally conservative-ish. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Kinds that count toward the new-account burst window. */
const BURST_KINDS: readonly UsageKind[] = [
  "coach_interview_start",
  "coach_interview_turn",
  "coach_draft",
  "coach_refine",
  "essay_adapt",
];

// ---------------------------------------------------------------------------
// Main gate
// ---------------------------------------------------------------------------

/**
 * Pre-call gate. Throws RateLimitError if the user would exceed any cap;
 * returns silently on success.
 *
 * Call this BEFORE the Claude API request, not after. Usage tracking is
 * done separately via recordUsage() after a successful call so failed
 * calls don't count against the student.
 */
export async function checkRateLimit(args: {
  userId: string;
  kind: UsageKind;
  /** Raw user-controlled input (question, draft, pasted text). Used for
   *  the input-token ceiling check. Pass "" if no user input. */
  userInput: string;
  /** Any additional fixed input the route adds (system prompt, context,
   *  rubric). Optional — only include if it's large (rare). */
  additionalInputTokens?: number;
}): Promise<void> {
  const { userId, kind, userInput, additionalInputTokens = 0 } = args;

  // 1. Input-size ceiling — cheap, purely local, runs first.
  const estimated = estimateTokens(userInput) + additionalInputTokens;
  if (estimated > MAX_INPUT_TOKENS_PER_CALL) {
    throw new RateLimitError(
      "input_too_large",
      `That's too much text for a single request. Try breaking it into smaller pieces — we cap individual coaching inputs at around ${Math.round(
        (MAX_INPUT_TOKENS_PER_CALL * CHARS_PER_TOKEN) / 1000,
      )}K characters.`,
      { limit: MAX_INPUT_TOKENS_PER_CALL, actualTokens: estimated, maxTokens: MAX_INPUT_TOKENS_PER_CALL },
    );
  }

  const admin = createAdminClient();

  // 2. New-account burst window. Skip the DB round trip if the account
  //    is clearly old — we only care about the first 10 minutes of life.
  const { data: profile } = await admin
    .from("profiles")
    .select("created_at")
    .eq("id", userId)
    .maybeSingle();

  if (profile?.created_at && BURST_KINDS.includes(kind)) {
    const createdAt = new Date(profile.created_at).getTime();
    const age = Date.now() - createdAt;
    if (age < BURST_WINDOW_MS) {
      const burstSince = new Date(Date.now() - BURST_WINDOW_MS).toISOString();
      const { count: burstCount } = await admin
        .from("claude_usage_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .in("kind", BURST_KINDS as unknown as string[])
        .gte("created_at", burstSince);

      if ((burstCount ?? 0) >= NEW_ACCOUNT_BURST_LIMIT) {
        const resetAt = new Date(createdAt + BURST_WINDOW_MS);
        throw new RateLimitError(
          "burst_cap",
          `We limit brand-new accounts to ${NEW_ACCOUNT_BURST_LIMIT} coaching actions in their first 10 minutes. Give it a few minutes and try again — this cap lifts at ${resetAt.toLocaleTimeString()}.`,
          {
            limit: NEW_ACCOUNT_BURST_LIMIT,
            used: burstCount ?? 0,
            resetAtIso: resetAt.toISOString(),
          },
        );
      }
    }
  }

  // 3. Per-kind daily cap.
  const dailyLimit = DAILY_CAPS[kind];
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: dailyCount } = await admin
    .from("claude_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", since24h);

  if ((dailyCount ?? 0) >= dailyLimit) {
    const code: RateLimitCode = kind === "coach_draft" ? "draft_cap" : "daily_cap";
    throw new RateLimitError(
      code,
      friendlyDailyCapMessage(kind, dailyLimit),
      {
        limit: dailyLimit,
        used: dailyCount ?? 0,
        // Rough reset — the oldest event in the window falls off. We
        // don't query for the exact timestamp because a 24h estimate is
        // honest enough for the UI ("try again tomorrow") and avoids
        // another round trip.
        resetAtIso: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      },
    );
  }
}

function friendlyDailyCapMessage(kind: UsageKind, limit: number): string {
  switch (kind) {
    case "coach_interview_start":
      return `You've started ${limit} essays today, which is our daily limit. Take a break and pick it back up tomorrow — the essays you've already started are saved.`;
    case "coach_interview_turn":
      return `You've hit your daily coaching limit (${limit} turns). Come back tomorrow — your progress is saved and you can pick up right where you left off.`;
    case "coach_draft":
      return `You've generated ${limit} drafts today. That's our daily cap to keep Claude costs manageable. Revise what you have, or try again tomorrow.`;
    case "coach_refine":
      return `You've saved ${limit} revisions today. Let your draft rest overnight — you'll come back to it with fresh eyes.`;
    case "essay_adapt":
      return `You've adapted ${limit} essays today. Nice pace! Try again tomorrow.`;
    case "manual_add":
      return `You've added ${limit} scholarships manually today. That's our daily cap — try again tomorrow.`;
    case "scrape_extract":
      return `Scraper daily cap hit (${limit}). This shouldn't happen under normal operation.`;
  }
}

// ---------------------------------------------------------------------------
// Post-call recorder
// ---------------------------------------------------------------------------

export interface UsageRecord {
  userId: string;
  kind: UsageKind;
  tokensIn: number;
  tokensOut: number;
  /** Optional linked entity id (essay_id, application_id, scholarship_id). */
  subjectId?: string | null;
}

/**
 * Record usage after a SUCCESSFUL Claude call. Best-effort: if the insert
 * fails the route still returns success — undercounting is preferable to
 * losing the user's response.
 *
 * IMPORTANT: only call this after Anthropic responded 200. Errored/aborted
 * calls should not be recorded because they didn't consume output tokens.
 * Retries DO count (we were charged).
 */
export async function recordUsage(record: UsageRecord): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from("claude_usage_events").insert({
      user_id: record.userId,
      kind: record.kind,
      tokens_in: record.tokensIn,
      tokens_out: record.tokensOut,
      subject_id: record.subjectId ?? null,
    });
  } catch (err) {
    // Don't throw. Undercounting is safer than failing a legitimate
    // response, and the user-facing result is already on the wire.
    console.warn("[rateLimits] recordUsage insert failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Route helper
// ---------------------------------------------------------------------------

/**
 * Convert a RateLimitError into the JSON body + HTTP status a route
 * should return. Keeps the shape uniform across all essay routes so the
 * client can handle 429s with one switch statement.
 */
export function rateLimitErrorResponse(err: RateLimitError): {
  body: {
    error: string;
    code: RateLimitCode;
    details: RateLimitError["details"];
  };
  status: number;
} {
  return {
    body: {
      error: err.message,
      code: err.code,
      details: err.details,
    },
    status: err.status,
  };
}
