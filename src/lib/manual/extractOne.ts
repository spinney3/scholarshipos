/**
 * Single-scholarship extractor for the student's manual-add flow.
 *
 * Unlike src/lib/scraper/extract.ts (which pulls a LIST of scholarships off
 * a community-foundation index page), this one works against the raw text
 * of ONE scholarship — a URL the student pasted or a PDF flyer they
 * uploaded. The contract is different: return a single object, not an
 * array, and bias toward extracting SOMETHING usable even when the source
 * is thin.
 *
 * One Haiku call per submission. No rate-limiting concerns at student
 * volume.
 */
import { getAnthropic } from "@/lib/anthropic";

export interface ExtractedScholarship {
  title: string;
  provider: string;
  amount: string | null;      // raw, e.g. "$500" / "Up to $2,000" / null
  deadline: string | null;    // raw, e.g. "March 15, 2026" / "Rolling" / null
  eligibility: string;
  description: string;
  essay_prompt: string | null; // captured verbatim if the source quotes one
}

const EXTRACTION_MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `You extract structured fields from a single scholarship listing. The source may be a scholarship provider's webpage, a PTA flyer converted to text, or a counselor's email.

Return ONLY a JSON object (NOT an array) with this exact shape:
{
  "title": string,            // the scholarship's full name
  "provider": string,         // the organization offering the scholarship (e.g. "Rotary Club of Phoenixville")
  "amount": string | null,    // raw text: "$500", "Up to $2,500", or null if not stated
  "deadline": string | null,  // raw text: "March 15, 2026", "Rolling", or null if not stated
  "eligibility": string,      // one or two sentences on who qualifies
  "description": string,      // one or two sentences describing what the scholarship is for
  "essay_prompt": string | null // the verbatim essay prompt/question if the source includes one; null otherwise
}

Rules:
- Do NOT invent fields. If the source doesn't state an amount, return amount: null (same for deadline, essay_prompt).
- If the text isn't actually a scholarship (e.g. it's a job posting, a grant for nonprofits, or unrelated content), still return the object but set title to "Not a scholarship" and eligibility to a brief note explaining what the content actually is.
- If the source is thin (a name + one line), do your best with eligibility/description — "See source for details" is acceptable.
- Never wrap in markdown fences. Never include prose. Output must be a bare JSON object.`;

export async function extractOneScholarship(args: {
  text: string;
  sourceLabel: string; // "Pasted URL: https://..." or "Uploaded PDF: flyer.pdf"
}): Promise<ExtractedScholarship> {
  const { text, sourceLabel } = args;
  const anthropic = getAnthropic();

  // Trim extremely long inputs — Haiku's input budget is generous but we
  // don't need 100k tokens of HTML noise to extract six fields. 40k chars
  // ~ 10k tokens is plenty for any realistic single-scholarship source.
  const trimmed = text.length > 40_000 ? text.slice(0, 40_000) : text;

  const response = await anthropic.messages.create({
    model: EXTRACTION_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${sourceLabel}

Content:
${trimmed}`,
      },
    ],
  });

  const raw = response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  return parseJsonObject(raw);
}

/**
 * Defensive parse: strip fences, isolate the outermost {...}, fall back to
 * a placeholder row rather than throwing so the route returns a usable
 * response even if Claude's output drifts.
 */
function parseJsonObject(raw: string): ExtractedScholarship {
  if (!raw) return placeholder();

  let candidate = raw;
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidate = fence[1];
  candidate = candidate.trim();

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return placeholder();
  candidate = candidate.slice(start, end + 1);

  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    return {
      title: stringOr(parsed.title, "Untitled scholarship"),
      provider: stringOr(parsed.provider, "Unknown provider"),
      amount: stringOrNull(parsed.amount),
      deadline: stringOrNull(parsed.deadline),
      eligibility: stringOr(parsed.eligibility, "See source for details."),
      description: stringOr(parsed.description, "See source for details."),
      essay_prompt: stringOrNull(parsed.essay_prompt),
    };
  } catch {
    return placeholder();
  }
}

function stringOr(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function stringOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.toLowerCase() !== "null" ? t : null;
}

function placeholder(): ExtractedScholarship {
  return {
    title: "Untitled scholarship",
    provider: "Unknown provider",
    amount: null,
    deadline: null,
    eligibility: "Review the original source for eligibility details.",
    description: "Claude couldn't extract structured fields — the row has been added to your pipeline so you can edit it manually.",
    essay_prompt: null,
  };
}
