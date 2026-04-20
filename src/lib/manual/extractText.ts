/**
 * Format-agnostic text extractor for the student's "add a scholarship" flow.
 *
 * Takes raw bytes (or a string, for paste mode) plus a filename hint and
 * returns a cleaned, deduped, Claude-ready text blob along with a guess at
 * whether the content is plausibly about a scholarship. This is the single
 * chokepoint between the manual-add route and Claude, so all three of our
 * token-reduction tactics live here in one place:
 *
 *   1. Format-native parsing (pdf-parse / mammoth / native text) — avoids
 *      dragging HTML boilerplate or base64 image garbage into the prompt.
 *   2. Whitespace + boilerplate strip — collapses runs of spaces, drops
 *      "Page 1 of 3" headers, and dedupes repeated lines that are almost
 *      certainly page-headers or footers.
 *   3. Keyword pre-filter gate — if the text contains no scholarship-ish
 *      token at all, we short-circuit and tell the caller to reject the
 *      upload WITHOUT making a Haiku call. At Shawn's $0.80/$4.00 per 1M
 *      Haiku pricing, skipping Claude on clearly-unrelated uploads is the
 *      single biggest per-call savings.
 *
 * The extractor is synchronous in signature (aside from the async deep
 * import for pdf-parse) so the route can await a single function and move
 * straight into Claude extraction without a case statement at the top.
 */

import type { Buffer as NodeBuffer } from "node:buffer";

export type ExtractFormat = "pdf" | "docx" | "txt" | "paste";

export interface ExtractedText {
  /** Cleaned, whitespace-collapsed plain text ready for Claude. */
  text: string;
  /** Approximate word count AFTER cleanup (for logging + UX copy). */
  wordCount: number;
  /** Which code path produced this text. */
  format: ExtractFormat;
  /**
   * Passed the keyword gate? Caller SHOULD refuse to hit Claude when this
   * is false — it's how we avoid burning tokens on random flyers, resumes,
   * menus, or whatever else a student accidentally uploads.
   */
  looksLikeScholarship: boolean;
  /** How many dedup-worthy "header/footer" lines we stripped (logging only). */
  boilerplateLinesRemoved: number;
}

export class ExtractError extends Error {
  code:
    | "empty"
    | "unsupported_format"
    | "parse_failed"
    | "too_short"
    | "not_scholarship";
  constructor(code: ExtractError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Tokens we expect to see in at least one form somewhere in a real
 * scholarship listing. Deliberately loose so a minimal flyer ("$500 award
 * for high school seniors, due June 1") still qualifies, but strict enough
 * that a resume or meeting agenda doesn't. Matched case-insensitively on
 * word boundaries.
 */
const SCHOLARSHIP_KEYWORDS = [
  "scholarship",
  "scholarships",
  "award",
  "awards",
  "grant",
  "grants",
  "fellowship",
  "fellowships",
  "bursary",
  "stipend",
  "tuition",
  "financial aid",
  "deadline",
  "eligibility",
  "eligible",
  "applicant",
  "applicants",
  "apply",
  "application",
  "gpa",
  "seniors",
  "undergraduate",
  "graduate student",
  "high school student",
  "essay prompt",
];

const KEYWORD_REGEX = new RegExp(
  "\\b(" +
    SCHOLARSHIP_KEYWORDS.map((k) =>
      k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ).join("|") +
    ")\\b",
  "i",
);

/** Minimum cleaned-text length we'll bother sending to Claude. */
const MIN_TEXT_LENGTH = 30;

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export async function extractFromFile(args: {
  bytes: NodeBuffer;
  filename: string;
  /** MIME type as reported by the client, or "" if missing (mobile/email). */
  mimeHint: string;
}): Promise<ExtractedText> {
  const format = detectFileFormat(args.filename, args.mimeHint);

  let raw: string;
  switch (format) {
    case "pdf":
      raw = await parsePdf(args.bytes);
      break;
    case "docx":
      raw = await parseDocx(args.bytes);
      break;
    case "txt":
      raw = parseTxt(args.bytes);
      break;
    default:
      throw new ExtractError(
        "unsupported_format",
        "That file type isn't supported. Upload a PDF, Word doc, or plain text file.",
      );
  }

  return finalize(raw, format);
}

export function extractFromPaste(text: string): ExtractedText {
  return finalize(text, "paste");
}

// ---------------------------------------------------------------------------
// Format detection
// ---------------------------------------------------------------------------

function detectFileFormat(
  filename: string,
  mimeHint: string,
): ExtractFormat | "unknown" {
  const lower = (filename || "").toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx")) return "docx";
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".markdown")
  )
    return "txt";

  // Fall back to MIME when the extension is missing — common with email
  // forwards stripped of filenames.
  if (/pdf/i.test(mimeHint)) return "pdf";
  if (/wordprocessingml/i.test(mimeHint)) return "docx";
  if (/^text\//i.test(mimeHint)) return "txt";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Per-format parsers
// ---------------------------------------------------------------------------

/**
 * PDF text via pdf-parse. We import the library's inner module directly
 * because its index.js runs a self-test against a bundled sample PDF on
 * module load — that sample isn't included in Next.js's serverless function
 * trace, so the top-level import 500s in prod. The deep-path form is the
 * maintainer-documented workaround.
 */
async function parsePdf(buf: NodeBuffer): Promise<string> {
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
    data: NodeBuffer,
  ) => Promise<{ text: string }>;
  try {
    const result = await pdfParse(buf);
    return result.text ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExtractError(
      "parse_failed",
      `Couldn't read that PDF: ${msg}. Scanned-image PDFs don't extract well — consider retyping into a Google Doc and pasting the share link.`,
    );
  }
}

/**
 * DOCX via mammoth. Mammoth's `extractRawText` gives us plain text without
 * the XML noise; we could use `convertToMarkdown` if we wanted to preserve
 * headings, but the extractor's JSON output fields don't benefit from
 * markdown structure, so raw text keeps the input token count lower.
 */
async function parseDocx(buf: NodeBuffer): Promise<string> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExtractError(
      "parse_failed",
      `Couldn't read that Word doc: ${msg}. If it's a .doc (older format), re-save as .docx and try again.`,
    );
  }
}

/**
 * Plain text — UTF-8 with a lenient decoder so a Windows-1252 or BOM-laden
 * file doesn't blow up the request.
 */
function parseTxt(buf: NodeBuffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

// ---------------------------------------------------------------------------
// Cleanup + gating
// ---------------------------------------------------------------------------

function finalize(raw: string, format: ExtractFormat): ExtractedText {
  if (!raw || !raw.trim()) {
    throw new ExtractError("empty", "That source was empty.");
  }

  const { text, boilerplateLinesRemoved } = stripBoilerplate(raw);

  if (text.length < MIN_TEXT_LENGTH) {
    throw new ExtractError(
      "too_short",
      "We pulled almost no text out of that source. If it's a scanned image, retype the info into a Google Doc and paste the share link under the URL tab.",
    );
  }

  const looksLikeScholarship = KEYWORD_REGEX.test(text);
  if (!looksLikeScholarship) {
    throw new ExtractError(
      "not_scholarship",
      "That doesn't look like a scholarship listing — no mention of an award, grant, eligibility, deadline, or application. Double-check you uploaded the right file.",
    );
  }

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    text,
    wordCount,
    format,
    looksLikeScholarship,
    boilerplateLinesRemoved,
  };
}

/**
 * Strip boilerplate that eats tokens without carrying meaning:
 *   - Leading/trailing whitespace on each line, empty lines collapsed.
 *   - "Page X of Y" / "Page X" lines.
 *   - Lines that appear 3+ times in the document (almost always page
 *     headers or footers in PDFs — "Acme Community Foundation | Scholarships
 *     | 2026" repeated on every page).
 *   - Runs of whitespace collapsed to a single space WITHIN a line, while
 *     preserving line breaks between paragraphs so Claude can still see
 *     structural cues.
 *
 * We do NOT aggressively strip URLs, emails, or short lines — those carry
 * signal for the extractor.
 */
function stripBoilerplate(raw: string): {
  text: string;
  boilerplateLinesRemoved: number;
} {
  // Normalize line endings and split.
  const lines = raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim());

  // Count how many times each non-trivial line appears — repeat candidates
  // are likely page headers/footers.
  const counts = new Map<string, number>();
  for (const l of lines) {
    if (l.length >= 8 && l.length <= 120) {
      counts.set(l, (counts.get(l) ?? 0) + 1);
    }
  }

  let removed = 0;
  const kept: string[] = [];
  let lastBlank = false;
  for (const l of lines) {
    if (!l) {
      if (!lastBlank) {
        kept.push("");
        lastBlank = true;
      }
      continue;
    }
    // Page numbering
    if (/^page\s+\d+(\s+of\s+\d+)?$/i.test(l)) {
      removed++;
      continue;
    }
    // Lone short numbers that are almost always page numbers in PDFs.
    if (/^\d{1,3}$/.test(l)) {
      removed++;
      continue;
    }
    // Repeated header/footer
    if ((counts.get(l) ?? 0) >= 3) {
      removed++;
      continue;
    }
    kept.push(l);
    lastBlank = false;
  }

  // Trim leading/trailing blank lines.
  while (kept.length && !kept[0]) kept.shift();
  while (kept.length && !kept[kept.length - 1]) kept.pop();

  return { text: kept.join("\n"), boilerplateLinesRemoved: removed };
}
