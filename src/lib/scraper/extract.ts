/**
 * Phase 3 — Claude-powered structured extraction from a scholarship listing
 * page.
 *
 * We intentionally avoid per-site CSS selectors: community foundations
 * restructure these pages constantly and most embed third-party widgets
 * (Blackbaud, Submittable, CommunityForce) whose DOM we don't control.
 * Claude reading trimmed HTML is robust across these variations, and cheap
 * enough on Haiku at the nightly cadence we're targeting (~10 sites/night).
 */

import { getAnthropic } from "@/lib/anthropic";

/** One scholarship as pulled from a listing page. Not yet normalized. */
export interface RawScholarship {
  title: string;
  amount: string | null; // e.g. "$2,500", "Up to $10,000", null if unstated
  deadline: string | null; // natural language from the page: "March 15, 2026"
  eligibility: string;
  url: string; // absolute or relative — normalize.ts resolves
  description?: string;
}

const EXTRACTION_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You extract scholarship listings from HTML scraped from U.S. community foundation websites.

Return ONLY a JSON array. Each element must match:
{
  "title": string,                       // e.g. "Jane Doe Memorial Scholarship"
  "amount": string | null,               // raw text, e.g. "$2,500" or "Up to $10,000" or null if not stated
  "deadline": string | null,             // raw text, e.g. "March 15, 2026" or "Rolling" or null
  "eligibility": string,                 // one sentence summarizing who qualifies
  "url": string,                         // full or relative link to the individual scholarship page
  "description": string                  // one short sentence describing the scholarship
}

Rules:
- Only include items that are clearly scholarships for students (not grants, fellowships for nonprofits, or generic programs).
- If the page lists scholarships by name only (no detail), still return them with best-effort eligibility="Not specified" and description="See listing page".
- If the page has no scholarships at all, return [].
- Do NOT fabricate amounts, deadlines, or URLs — leave null / use the listing page URL if a per-scholarship link is not present.
- Never wrap the JSON in markdown fences or prose. Output must be a bare JSON array.`;

export async function extractScholarshipsFromHtml(args: {
  html: string;
  sourceName: string;
  sourceUrl: string;
}): Promise<RawScholarship[]> {
  const { html, sourceName, sourceUrl } = args;
  const anthropic = getAnthropic();

  const response = await anthropic.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Source: ${sourceName}
Listing page URL (use for resolving relative links): ${sourceUrl}

HTML:
${html}`,
      },
    ],
  });

  const text = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  return parseJsonArray(text);
}

/**
 * Defensive parse: Claude occasionally emits ```json fences despite the
 * system instruction, and some models add a trailing comma. We strip both
 * before falling back to `[]` so one flaky site never crashes the run.
 */
function parseJsonArray(raw: string): RawScholarship[] {
  if (!raw) return [];

  let candidate = raw;
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidate = fence[1];
  candidate = candidate.trim();

  // Find the outermost [ ... ] if there's any stray prose.
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  candidate = candidate.slice(start, end + 1);

  try {
    const parsed = JSON.parse(candidate);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRawScholarshipShape);
  } catch {
    return [];
  }
}

function isRawScholarshipShape(x: unknown): x is RawScholarship {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.title === "string" &&
    typeof o.eligibility === "string" &&
    typeof o.url === "string" &&
    (o.amount === null || typeof o.amount === "string") &&
    (o.deadline === null || typeof o.deadline === "string")
  );
}
