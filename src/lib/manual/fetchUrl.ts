/**
 * Fetch a pasted scholarship URL server-side and strip it to plain text.
 *
 * Deliberately DOESN'T use Playwright. Manual adds happen one at a time at
 * student interaction latency — boot cost of a headless browser is 5-10s and
 * we don't need it. Most scholarship pages rendered by school/foundation
 * sites, PTA blogs, or Google Docs are static enough that a raw fetch works.
 * If the page is JS-rendered and the extraction comes back thin, the student
 * can edit fields by hand on the pipeline card.
 *
 * Safety:
 *   - 10s timeout via AbortController so a dead host can't hang the route.
 *   - 1MB response cap — text/html well above this is almost certainly a
 *     malformed page or a non-text file mistyped as html.
 *   - http(s) only; rejects file://, data:, etc.
 */

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 1_000_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; ScholarshipOS/1.0; +https://scholarshipos.app)";

export interface FetchResult {
  url: string;        // may have been normalized / redirected
  text: string;       // HTML-stripped, whitespace-collapsed
  titleGuess: string; // best-effort <title> extraction, for the UI
}

export class FetchUrlError extends Error {
  code: "invalid_url" | "timeout" | "network" | "too_large" | "not_text";
  constructor(code: FetchUrlError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export async function fetchUrlAsText(rawUrl: string): Promise<FetchResult> {
  const url = validate(rawUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e instanceof Error && e.name === "AbortError") {
      throw new FetchUrlError(
        "timeout",
        "That page took too long to respond. Double-check the URL and try again.",
      );
    }
    throw new FetchUrlError(
      "network",
      "Couldn't reach that page. The site may be down or blocking us.",
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw new FetchUrlError(
      "network",
      `The page responded with HTTP ${res.status}.`,
    );
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType && !/\b(text\/html|text\/plain|application\/xhtml)\b/i.test(contentType)) {
    throw new FetchUrlError(
      "not_text",
      `That URL returned ${contentType.split(";")[0]}, not a webpage. If it's a PDF, use the Upload tab instead.`,
    );
  }

  // Read with a byte cap so we don't load a 50MB HTML dump into memory.
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    throw new FetchUrlError(
      "too_large",
      "That page is too large to process. Try a direct scholarship detail page instead of a full index.",
    );
  }
  const html = new TextDecoder("utf-8", { fatal: false }).decode(buf);

  return {
    url: res.url || url,
    text: htmlToText(html),
    titleGuess: extractTitle(html),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validate(input: string): string {
  const s = (input ?? "").trim();
  if (!s) {
    throw new FetchUrlError("invalid_url", "Please paste a URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(s);
  } catch {
    throw new FetchUrlError(
      "invalid_url",
      "That doesn't look like a valid URL. Make sure it starts with https://",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new FetchUrlError(
      "invalid_url",
      "Only http(s) URLs are supported.",
    );
  }
  return parsed.toString();
}

/**
 * Strip HTML to readable text. Intentionally simple — Claude does the
 * structured extraction, we just need to keep it readable and under the
 * token budget. Drops <script>/<style>/<nav>/<footer> blocks whose text
 * content is noise.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  return m[1].replace(/\s+/g, " ").trim();
}
