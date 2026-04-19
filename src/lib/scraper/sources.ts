/**
 * Phase 3.2 — Active scholarship sources for Pennsylvania / Philadelphia region.
 *
 * Strategy (per project_audience memory — primary user is a PA junior in
 * Spring-Ford Area SD, ZIP 194):
 *   Tier 1 — State money:        PHEAA  → moved to seed.sql (single-program
 *                                         aid, FAFSA-driven, not a catalog)
 *   Tier 2 — Regional foundations: CCCF (72 funds via index+per-page),
 *                                  PCHF (1 scholarship, single page)
 *   Tier 3 — District PDF bulletins: Spring-Ford (URL TBD — daughter's hunt)
 *   Tier 4 — National aggregators: dropped (no working RSS feeds)
 *
 * Source types:
 *   'html'        — Playwright → Claude extraction. 1 URL, 1-N rows.
 *   'html_index'  — Index page → regex-extract sub-URLs → html pipeline each.
 *                   Needs `link_pattern` (one capture group = URL).
 *   'pdf'         — HTTP fetch PDF → pdf-parse → Claude (NOT IMPLEMENTED)
 *   'rss'         — HTTP fetch XML → straight-through parse (NOT IMPLEMENTED)
 */

export type ScrapeSourceType = "html" | "html_index" | "pdf" | "rss";

export interface ScrapeSource {
  /** Stable ID used in scrape_runs.results and logs. */
  id: string;
  /** Human-readable name for dashboards and provider attribution. */
  name: string;
  /** Major U.S. region for analytics / coverage auditing. */
  region: string;
  /** Pipeline type. See ScrapeSourceType above. */
  type: ScrapeSourceType;
  /** Listing page / PDF URL / RSS feed / index page. */
  url: string;
  /**
   * ZIP scope tag applied to every scholarship discovered here. Uses the same
   * 'zip:NNN' / 'state:XX' / 'national' format as seed.sql. Matcher filters
   * by 3-digit prefix and supports comma-separated lists.
   */
  zip_scope: string;
  /**
   * (html / html_index only) CSS selector the browser helper waits for before
   * capturing HTML. Undefined = wait for networkidle.
   */
  wait_for?: string;
  /**
   * (html_index only) Regex pattern applied against the index page's raw
   * HTML. MUST contain exactly one capture group that captures the full
   * absolute sub-URL. Example for CCCF:
   *   `href="(https://chescocf\\.org/fund/[^"]+)"`
   */
  link_pattern?: string;
  /**
   * (html_index only) Cap on sub-URLs crawled per run. Defaults to 100.
   * Safety valve against runaway index pages.
   */
  max_sub_urls?: number;
}

/**
 * ACTIVE sources. Two PA foundations verified 2026-04-19:
 *   cccf        — 72 scholarship funds via /fund/<slug>/ index+per-page pattern
 *   pchf-health — Phoenixville Community Health Foundation, 1 scholarship
 */
export const SCRAPE_SOURCES: ScrapeSource[] = [
  {
    id: "cccf",
    name: "Chester County Community Foundation",
    region: "Chester County PA",
    type: "html_index",
    url: "https://chescocf.org/scholarship-funds/",
    zip_scope: "zip:193,194,195",
    // One capture group, doubled backslashes so the string compiles to the
    // regex: href="(https://chescocf\.org/fund/[^"]+)"
    link_pattern: `href="(https://chescocf\\.org/fund/[^"]+)"`,
    max_sub_urls: 100,
  },
  {
    id: "pchf-health",
    name: "Phoenixville Community Health Foundation",
    region: "Phoenixville / Schuylkill Valley PA",
    type: "html",
    url: "https://pchf.net/scholarships/",
    zip_scope: "zip:194,195",
  },
];

/**
 * Candidate sources pending URL verification. Do NOT promote into
 * SCRAPE_SOURCES until `npm run inspect` confirms real content.
 *
 * Both entries below need a human to find the right URL:
 *   pcef           — PCEF's scholarship catalog isn't at /forms-applications/
 *                    or /our-programs/. Likely requires Naviance / guidance
 *                    counselor link. Ask daughter.
 *   spring-ford-sd — Annual scholarship bulletin PDF. Probably under
 *                    Departments → School Counseling on spring-ford.net.
 *                    Ask daughter or guidance office.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CANDIDATE_SOURCES: ScrapeSource[] = [
  {
    id: "pcef",
    name: "Phoenixville Community Education Foundation",
    region: "Phoenixville Area School District",
    type: "html",
    url: "https://www.pcefonline.com/TBD",
    zip_scope: "zip:194,195",
  },
  {
    id: "spring-ford-sd",
    name: "Spring-Ford Area SD Scholarship Bulletin",
    region: "Spring-Ford Area SD",
    type: "pdf",
    url: "https://www.spring-ford.net/TBD.pdf",
    zip_scope: "zip:194",
  },
];

/**
 * Sources probed and rejected during Phase 3.2 verification (2026-04-19).
 * Kept here so future curation doesn't re-litigate these dead ends.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DISABLED_SOURCES = [
  //   pheaa-state-grant, pheaa-special-programs
  //     → Not a catalog. Single-program aid, FAFSA-driven. The state grant
  //       and Ready to Succeed / Chafee / PATH programs are better expressed
  //       as seed.sql entries than scraper output.
  //
  //   philafound (Philadelphia Foundation)
  //     → Applications gated behind Salesforce Experience Cloud login at
  //       philafound.my.site.com. No public pre-login catalog. Same ToS
  //       territory we chose to avoid with national aggregators.
  //
  //   bccf (Berks County Community Foundation)
  //     → Uses Foundant GrantInterface portal (grantinterface.com, login-
  //       gated). Their public /scholarships/ page has no /fund/ namespace
  //       like CCCF — no scrapable catalog.
  //
  //   studentscholarships.org RSS
  //     → Feed URL 404s after redirect chain (/rss/ → /rss → 404).
  //
  //   Phase 3 multi-metro attempt: svcf, seattle, denver, cct, cleveland,
  //   tbf, nyct, cfga, cftexas, gkccf
  //     → Deprioritized when project audience narrowed to PA / Spring-Ford.
  //       SVCF did work (~23 rows at /find-scholarships/svcf-managed-scholarships)
  //       so restoring them if ScholarshipOS becomes a public product is
  //       straightforward — see git history for the URLs.
];

export function getSource(id: string): ScrapeSource | undefined {
  return SCRAPE_SOURCES.find((s) => s.id === id);
}
