/**
 * Phase 3.2 — ZIP prefix → scholarship source mapping.
 *
 * Coverage is Pennsylvania-focused per project audience (Spring-Ford Area SD,
 * ZIP 194). Tier 1 PHEAA sources cover all of PA; Tier 2/3 foundations +
 * district bulletins cover specific prefixes within southeastern PA.
 *
 * ZIP prefixes in our target region (southeastern PA):
 *   190 — Philadelphia west + inner Main Line
 *   191 — Philadelphia core + NE/NW
 *   193 — Delaware County / western suburbs (Chester, Media)
 *   194 — Montgomery County exurb (Norristown, King of Prussia, Royersford,
 *         Collegeville, Phoenixville, Limerick, Spring City) ← Spring-Ford
 *   195 — Schuylkill Valley (Pottstown, Reading exurbs)
 *   196 — Reading / Berks County core
 *
 * Coverage is intentionally conservative: false-negatives (fringe students
 * missing coverage) are tolerable, false-positives dilute the "local" promise.
 */

import { SCRAPE_SOURCES, type ScrapeSource } from "./sources";

/**
 * 3-digit ZIP prefix → source IDs that serve that area.
 *
 * Populated 2026-04-19 after Phase 3.2 candidate verification sprint.
 * See sources.ts DISABLED_SOURCES for what got cut and why.
 *
 * Active coverage:
 *   193 — Chester County / Delaware County borderlands (Chester, Media, West
 *         Chester, Kennett Square). CCCF primary service area.
 *   194 — Montgomery County exurb (Royersford, Collegeville, Phoenixville,
 *         Limerick, Spring City, King of Prussia, Norristown). Spring-Ford
 *         Area SD sits here. CCCF extends here because Chester County border
 *         runs through this prefix; PCHF serves Phoenixville-area schools.
 *   195 — Schuylkill Valley (Pottstown, Reading exurbs). PCHF covers
 *         Phoenixville-adjacent schools; CCCF reaches western Chester County.
 *
 * No coverage yet for 190/191 (Philly core) because philafound's Salesforce
 * portal is login-gated. 196 (Berks) has no coverage because bccf uses a
 * Foundant portal with no public catalog.
 */
export const ZIP_PREFIX_TO_SOURCES: Record<string, string[]> = {
  "193": ["cccf"],
  "194": ["cccf", "pchf-health"],
  "195": ["cccf", "pchf-health"],
};

/**
 * Given a student ZIP code, return the subset of SCRAPE_SOURCES that serve
 * their region. Returns [] if no foundation in our mapping covers this ZIP —
 * in that case, students still see national seed data and whatever the
 * nightly cron surfaces.
 */
export function getSourcesForZip(zip: string | null | undefined): ScrapeSource[] {
  if (!zip || zip.length < 3) return [];
  const prefix = zip.slice(0, 3);
  const ids = ZIP_PREFIX_TO_SOURCES[prefix];
  if (!ids || ids.length === 0) return [];
  return SCRAPE_SOURCES.filter((s) => ids.includes(s.id));
}

/**
 * Invert ZIP_PREFIX_TO_SOURCES: source_id → every 3-digit prefix that maps
 * to it. Used to stamp scraped scholarships with a zip_scope that matches
 * the source's full service area, so a San Francisco student (prefix 940)
 * still sees SVCF scholarships even if we nominally stamp them for Palo
 * Alto (prefix 943).
 *
 * Format matches the comma-separated convention matching.ts accepts:
 *   "zip:940,941,943,944,945,950,951"
 */
export function getZipScopeForSource(sourceId: string): string {
  const prefixes: string[] = [];
  for (const [prefix, ids] of Object.entries(ZIP_PREFIX_TO_SOURCES)) {
    if (ids.includes(sourceId)) prefixes.push(prefix);
  }
  if (prefixes.length === 0) return "national";
  return `zip:${prefixes.sort().join(",")}`;
}

/**
 * True if the student's ZIP falls inside a region we have coverage for.
 * Useful for UI copy ("Checking local scholarships near you…" vs
 * "We don't have a local partner in your area yet").
 */
export function hasLocalCoverage(zip: string | null | undefined): boolean {
  return getSourcesForZip(zip).length > 0;
}
