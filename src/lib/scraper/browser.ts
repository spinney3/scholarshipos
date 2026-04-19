/**
 * Phase 3 — Playwright launcher.
 *
 * Vercel serverless Node functions have a 50MB bundle cap, which rules out
 * shipping full `playwright` (~280MB of Chromium). The standard fix is
 * `playwright-core` (driver only) paired with `@sparticuz/chromium`
 * (a minimal headless Chromium binary purpose-built for Lambda/Vercel).
 *
 * Locally, developers typically don't have the sparticuz binary installed, so
 * we fall back to whatever Chromium the host provides via `PLAYWRIGHT_LOCAL=1`
 * in .env.local (pointing at `playwright-core`'s `launch()` defaults, which
 * pick up a system Chrome if one is installed).
 */

// Types from playwright-core. We reference them via dynamic import in the
// functions below so the tsc `noEmit` check still works before
// `npm install playwright-core` is run (e.g. in CI on a fresh clone).
type PlaywrightBrowser = Awaited<
  ReturnType<Awaited<ReturnType<typeof loadChromium>>["launch"]>
>;
type PlaywrightPage = Awaited<
  ReturnType<Awaited<ReturnType<PlaywrightBrowser["newContext"]>>["newPage"]>
>;

async function loadChromium() {
  // Dynamic import keeps this working when playwright-core's types aren't
  // resolvable at build time (e.g. fresh clone before `npm install`).
  const mod = await import("playwright-core");
  return mod.chromium;
}

const NAV_TIMEOUT_MS = 30_000;
const USER_AGENT =
  "Mozilla/5.0 (compatible; ScholarshipOS-Scraper/0.1; +https://scholarshipos.app/about/scraper)";

/**
 * Returns a launched headless browser. Caller MUST `await browser.close()`
 * when done — we don't maintain a pool because Vercel recycles the runtime
 * between cron invocations.
 */
export async function launchBrowser(): Promise<PlaywrightBrowser> {
  const chromium = await loadChromium();

  // Local dev escape hatch: skip @sparticuz/chromium and use whatever's on PATH.
  if (process.env.PLAYWRIGHT_LOCAL === "1") {
    return chromium.launch({ headless: true });
  }

  // Production / Vercel: use @sparticuz/chromium's bundled binary.
  const sparticuzMod = await import("@sparticuz/chromium");
  const sparticuz = (sparticuzMod as any).default ?? sparticuzMod;

  const executablePath: string = await sparticuz.executablePath();
  return chromium.launch({
    args: sparticuz.args,
    executablePath,
    headless: true,
  });
}

/**
 * Open a URL, wait for content, and return the rendered HTML.
 *
 * We capture the full `document.documentElement.outerHTML` rather than the
 * server response so JS-rendered foundation widgets (Blackbaud/Submittable/
 * CommunityForce embeds — very common in this space) are included.
 */
export async function fetchRenderedHtml(
  page: PlaywrightPage,
  url: string,
  waitFor?: string,
): Promise<string> {
  await page.setExtraHTTPHeaders({ "User-Agent": USER_AGENT });

  await page.goto(url, {
    timeout: NAV_TIMEOUT_MS,
    waitUntil: "domcontentloaded",
  });

  // Best effort: wait for the listing selector if the source specified one,
  // otherwise wait for the network to settle so any JS widget has a chance.
  if (waitFor) {
    await page
      .waitForSelector(waitFor, { timeout: 10_000 })
      .catch(() => undefined);
  } else {
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(
      () => undefined,
    );
  }

  return page.content();
}

/**
 * Scholarship listings regularly exceed Claude's context window if we ship
 * raw HTML (one site had 1.4MB of inline SVG). Trim to body + strip noisy
 * tags before handing to the extractor.
 */
export function trimHtmlForExtraction(html: string, maxChars = 120_000): string {
  // Drop script / style / svg / comment blobs that carry no scholarship info.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Collapse whitespace runs — doesn't harm extraction, saves tokens.
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}
