/**
 * Phase 3 — Normalize Claude's raw extraction into rows that fit the
 * scholarships schema.
 *
 * The extractor is intentionally lenient (strings for amount/deadline, null
 * allowed). This module converts those into the strict shapes the DB expects:
 *   * amount → integer USD (conservative: takes the lower bound of a range,
 *     zero if unparseable — zero rows get filtered out upstream)
 *   * deadline → ISO date string (drops rows we can't confidently parse)
 *   * url → absolute URL (resolved against the source listing page)
 */

import type { RawScholarship } from "./extract";
import type { ScrapeSource } from "./sources";
import { getZipScopeForSource } from "./zipMapping";

export interface NormalizedScholarship {
  title: string;
  provider: string;
  amount: number; // USD, integer (0 = unlisted on source catalog page)
  /**
   * YYYY-MM-DD, or null when the source catalog lists the scholarship by
   * name without a deadline. Matching.ts skips deadline checks on null
   * rows and UI renders them as "Deadline varies". Per-scholarship detail
   * pages would often have a date but we don't follow them (cost: 2x Haiku
   * calls per site).
   */
  deadline: string | null;
  description: string;
  eligibility_summary: string;
  min_gpa: null;
  interests: string[]; // left empty — matcher will still surface via zip_scope
  /**
   * Comma-separated prefix list matching matching.ts's multi-prefix format,
   * e.g. "zip:940,941,943,944,945,950,951" for SVCF. Derived from
   * zipMapping.ts so it covers the foundation's full service area.
   */
  zip_scope: string;
  url: string;
  essay_prompt: null;
  source: "local";
}

export function normalize(
  raw: RawScholarship,
  source: ScrapeSource,
): NormalizedScholarship | null {
  const title = raw.title?.trim();
  if (!title || title.length < 4) return null;

  const url = resolveUrl(raw.url, source.url);
  if (!url) return null;

  const amount = parseAmount(raw.amount);
  // Deadline is optional: community foundations often publish scholarship
  // names on a catalog page without per-award dates. We let null through —
  // matcher/UI handle the absence — rather than dropping otherwise-valid rows.
  const deadline = parseDeadline(raw.deadline);

  // Use the source's full derived coverage area (all 3-digit prefixes that
  // zipMapping.ts associates with this foundation) rather than source.zip_scope,
  // which carries a single representative ZIP. Falls back to the source's own
  // representative ZIP if the source is not listed in zipMapping.
  const derivedScope = getZipScopeForSource(source.id);
  const zipScope = derivedScope === "national" ? source.zip_scope : derivedScope;

  return {
    title: title.slice(0, 200),
    provider: source.name,
    amount,
    deadline,
    description: (raw.description ?? "").slice(0, 500) || "See listing page for details.",
    eligibility_summary: (raw.eligibility ?? "Not specified").slice(0, 500),
    min_gpa: null,
    interests: [],
    zip_scope: zipScope,
    url,
    essay_prompt: null,
    source: "local",
  };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * "$2,500"            → 2500
 * "Up to $10,000"     → 10000
 * "$1,000 – $5,000"   → 1000 (low end — students still see it in matches)
 * "Varies"            → 0
 */
export function parseAmount(input: string | null | undefined): number {
  if (!input) return 0;
  // Match all $-prefixed numbers, preferring the first (usually the low end
  // or headline amount).
  const matches = input.match(/\$\s?([\d,]+(?:\.\d+)?)/g);
  if (!matches || matches.length === 0) {
    // Bare numbers with a k/K suffix ("up to 10k")
    const kMatch = input.match(/(\d+)\s*k\b/i);
    if (kMatch) return parseInt(kMatch[1], 10) * 1000;
    return 0;
  }
  const first = matches[0].replace(/[^\d.]/g, "");
  const n = parseFloat(first);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

/**
 * Parse a variety of deadline formats scraped from HTML into ISO YYYY-MM-DD.
 * Returns null for "Rolling", "Varies", or anything we can't confidently parse
 * — upstream filters those rows out rather than guessing.
 */
export function parseDeadline(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  if (!s) return null;
  // Rolling / varies / open — we can't schedule a reminder against these.
  if (/\b(rolling|varies|ongoing|open|tbd|n\/a)\b/i.test(s)) return null;

  // Strip leading labels ("Deadline:", "Due by")
  const cleaned = s
    .replace(/^(deadline|due|closes|apply by|application deadline)[:\s]*/i, "")
    .trim();

  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return null;

  // Sanity check: reject years outside a reasonable scraping window.
  const year = d.getUTCFullYear();
  const thisYear = new Date().getUTCFullYear();
  if (year < thisYear - 1 || year > thisYear + 3) return null;

  return d.toISOString().slice(0, 10);
}

/** Resolve relative URLs against the source listing page. */
export function resolveUrl(
  raw: string | null | undefined,
  baseUrl: string,
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}
