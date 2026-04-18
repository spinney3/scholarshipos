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
export const ESSAY_MODEL = "claude-sonnet-4-6";
