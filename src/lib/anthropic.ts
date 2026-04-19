import Anthropic from "@anthropic-ai/sdk";

/**
 * Server-only Anthropic client.
 *
 * Never import this from a client component. The ANTHROPIC_API_KEY must
 * stay on the server; all Claude calls are proxied through /api/essay/*.
 */
let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local to enable the essay coach.",
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * Model used for all essay coaching calls. Pinned here so we can upgrade
 * in one place.
 */
export const ESSAY_MODEL = "claude-haiku-4-5-20251001";

/**
 * Stable error codes surfaced to the browser so components can render
 * accurate recovery copy (e.g., quota-exhausted vs. transient rate limit
 * vs. genuine server glitch). Keep this union small — any new code must
 * also be handled in ClaudeErrorBanner.
 */
export type ClaudeErrorCode =
  | "rate_limited"     // 429 — transient; retry after a pause
  | "quota_exceeded"   // billing / monthly cap — user action won't fix
  | "overloaded"       // 529 — Anthropic capacity pressure
  | "auth"             // 401 — bad API key on our side
  | "config_missing"   // ANTHROPIC_API_KEY not set in the environment
  | "server_error"     // generic 5xx from Anthropic
  | "other";           // parsing/network/unknown

export interface ClassifiedClaudeError {
  code: ClaudeErrorCode;
  /** HTTP status to return to the browser from the route handler. */
  status: number;
  /** Short safe-to-display message. No stack traces, no API internals. */
  message: string;
}

/**
 * Map an unknown error from `anthropic.messages.create` (or our own
 * config/parsing errors) into a stable code the UI can switch on.
 *
 * Why this exists: every Claude route was returning a raw `e.message` with a
 * blanket 502. The user couldn't tell the difference between "we're out of
 * credits" (real, needs human intervention) and "please retry in 30s"
 * (transient). Now the banner in the UI can make that call accurately.
 */
export function classifyClaudeError(err: unknown): ClassifiedClaudeError {
  // Config error thrown by getAnthropic() when the key is missing.
  if (err instanceof Error && /ANTHROPIC_API_KEY is not set/i.test(err.message)) {
    return {
      code: "config_missing",
      status: 503,
      message: "Claude isn't configured on the server yet.",
    };
  }

  // Anthropic SDK errors expose .status and .error.type.
  const e = err as {
    status?: number;
    message?: string;
    error?: { error?: { type?: string; message?: string } };
  };
  const status = typeof e?.status === "number" ? e.status : undefined;
  const type = e?.error?.error?.type;
  const rawMsg = e?.error?.error?.message ?? (err instanceof Error ? err.message : "");

  // Quota / billing exhaustion. Anthropic uses type === 'overloaded_error'
  // for capacity and encodes credit issues in the message with keywords
  // like "credit balance" or "insufficient_quota".
  if (/credit balance|insufficient_quota|billing|monthly.*limit|quota/i.test(rawMsg)) {
    return {
      code: "quota_exceeded",
      status: 503,
      message:
        "The Claude coach is temporarily offline because the shared API budget is exhausted. The site owner has been notified.",
    };
  }

  if (status === 429 || type === "rate_limit_error") {
    return {
      code: "rate_limited",
      status: 429,
      message:
        "The Claude coach is a little busy right now. Give it a minute and try again.",
    };
  }

  if (status === 529 || type === "overloaded_error") {
    return {
      code: "overloaded",
      status: 503,
      message:
        "Anthropic's servers are overloaded. This usually clears within a few minutes — try again shortly.",
    };
  }

  if (status === 401 || status === 403 || type === "authentication_error") {
    return {
      code: "auth",
      status: 503,
      message:
        "Claude rejected our API key. The site owner has been notified.",
    };
  }

  if (status && status >= 500) {
    return {
      code: "server_error",
      status: 502,
      message: "Claude returned a server error. Please try again shortly.",
    };
  }

  return {
    code: "other",
    status: 502,
    message: rawMsg || "Claude call failed.",
  };
}
