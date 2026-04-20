/**
 * Phase 3 — Scrape orchestrator.
 *
 * Runs on /api/scrape (cron) or locally via `npm run scrape`.
 * For each source:
 *   1. Launch Playwright, capture rendered HTML
 *   2. Trim HTML and hand to Claude for structured extraction
 *   3. Normalize each raw row into DB-ready shape
 *   4. Upsert into scholarships (on conflict (url)) with source='local'
 *
 * Writes a row to scrape_runs summarizing the run for observability.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  fetchRenderedHtml,
  launchBrowser,
  trimHtmlForExtraction,
} from "./browser";
import { extractScholarshipsFromHtml } from "./extract";
import { normalize, type NormalizedScholarship } from "./normalize";
import { SCRAPE_SOURCES, type ScrapeSource } from "./sources";
import { getSourcesForZip } from "./zipMapping";

/** How long a successful per-source scrape is considered fresh. */
const ZIP_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Sleep between sub-URL fetches in the html_index crawler. Keeps us from
 * hammering a single foundation site with 72 back-to-back requests. 1.5s ×
 * 72 ≈ 2 minutes extra per CCCF run — well within the /api/scrape budget.
 */
const INDEX_CRAWL_DELAY_MS = 1500;

/** Default max_sub_urls when an html_index source doesn't set one. */
const DEFAULT_MAX_SUB_URLS = 100;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `link_pattern` against the raw index HTML and return unique sub-URLs.
 * The pattern MUST have exactly one capture group; group 1 is treated as the
 * absolute URL.
 *
 * De-duplicated because index pages often repeat links (card grid + sidebar
 * nav + related-links widget).
 */
function extractSubUrls(
  html: string,
  pattern: string,
  max = DEFAULT_MAX_SUB_URLS,
): string[] {
  const re = new RegExp(pattern, "g");
  const urls = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    if (match[1]) urls.add(match[1]);
    if (urls.size >= max) break;
  }
  return Array.from(urls);
}

export interface SourceResult {
  source_id: string;
  url: string;
  ok: boolean;
  found: number;
  inserted: number;
  updated: number;
  error?: string;
}

export interface ScrapeRunSummary {
  run_id: string | null;
  status: "success" | "partial" | "failed";
  sources_total: number;
  sources_ok: number;
  scholarships_found: number;
  scholarships_inserted: number;
  scholarships_updated: number;
  results: SourceResult[];
  elapsed_ms: number;
}

/** Main entry point called by /api/scrape. */
export async function runScrape(options: {
  sources?: ScrapeSource[];
  /** If true, parse + normalize but do not write to Supabase. */
  dryRun?: boolean;
} = {}): Promise<ScrapeRunSummary> {
  const startedAt = Date.now();
  const sources = options.sources ?? SCRAPE_SOURCES;
  const admin = options.dryRun ? null : createAdminClient();

  // --- 1. Open a run row so a mid-run crash still leaves a trace ---
  let runId: string | null = null;
  if (admin) {
    const { data } = await admin
      .from("scrape_runs")
      .insert({
        status: "running",
        sources_total: sources.length,
      })
      .select("id")
      .single();
    runId = data?.id ?? null;
  }

  const results: SourceResult[] = [];
  let totalFound = 0;
  let totalInserted = 0;
  let totalUpdated = 0;

  // --- 2. Launch one browser, reuse for all sources ---
  const browser = await launchBrowser();
  try {
    for (const source of sources) {
      const result = await scrapeOne(browser, source, admin);
      results.push(result);
      totalFound += result.found;
      totalInserted += result.inserted;
      totalUpdated += result.updated;
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const okCount = results.filter((r) => r.ok).length;
  const status: ScrapeRunSummary["status"] =
    okCount === sources.length ? "success" : okCount === 0 ? "failed" : "partial";

  // --- 3. Close out the run row ---
  if (admin && runId) {
    await admin
      .from("scrape_runs")
      .update({
        finished_at: new Date().toISOString(),
        status,
        sources_ok: okCount,
        scholarships_found: totalFound,
        scholarships_inserted: totalInserted,
        scholarships_updated: totalUpdated,
        results,
      })
      .eq("id", runId);
  }

  return {
    run_id: runId,
    status,
    sources_total: sources.length,
    sources_ok: okCount,
    scholarships_found: totalFound,
    scholarships_inserted: totalInserted,
    scholarships_updated: totalUpdated,
    results,
    elapsed_ms: Date.now() - startedAt,
  };
}

/**
 * Per-student entry point triggered on onboarding completion.
 *
 * Pipeline:
 *   1. Look up community foundations serving this ZIP (src/lib/scraper/zipMapping.ts).
 *      If none, return a zero-cost summary — we don't have coverage there yet.
 *   2. For each source, check scrape_runs for a successful run that included
 *      it within ZIP_CACHE_TTL_MS. Cached sources are skipped so a classroom
 *      of students onboarding back-to-back doesn't rescrape the same site
 *      50 times in an afternoon.
 *   3. Run the normal orchestrator on the remaining (uncached) sources.
 *
 * The returned summary still lists ALL sources relevant to this ZIP so the
 * caller can tell the student "you're covered by N foundations" even when
 * every source was cached.
 */
export async function runScrapeForZip(zip: string): Promise<
  ScrapeRunSummary & {
    zip: string;
    covered_sources: string[];
    cached_sources: string[];
  }
> {
  const startedAt = Date.now();
  const relevant = getSourcesForZip(zip);

  // No coverage for this ZIP — return a no-op summary. The orchestrator is
  // never invoked; we don't even open a scrape_runs row.
  if (relevant.length === 0) {
    return {
      run_id: null,
      status: "success",
      sources_total: 0,
      sources_ok: 0,
      scholarships_found: 0,
      scholarships_inserted: 0,
      scholarships_updated: 0,
      results: [],
      elapsed_ms: Date.now() - startedAt,
      zip,
      covered_sources: [],
      cached_sources: [],
    };
  }

  // Look up fresh runs to decide which sources can skip network + LLM work.
  const admin = createAdminClient();
  const since = new Date(Date.now() - ZIP_CACHE_TTL_MS).toISOString();
  const { data: recentRuns } = await admin
    .from("scrape_runs")
    .select("results, finished_at, status")
    .gte("finished_at", since)
    .order("finished_at", { ascending: false });

  const freshlyScraped = new Set<string>();
  for (const run of recentRuns ?? []) {
    if (run.status === "failed") continue;
    const results = Array.isArray(run.results) ? run.results : [];
    for (const r of results as SourceResult[]) {
      if (r && r.ok) freshlyScraped.add(r.source_id);
    }
  }

  const needsScrape = relevant.filter((s) => !freshlyScraped.has(s.id));
  const cached = relevant.filter((s) => freshlyScraped.has(s.id));

  // All sources are cached — nothing to do. Return early without launching
  // Playwright. The student will see cached scholarships on /matches already.
  if (needsScrape.length === 0) {
    return {
      run_id: null,
      status: "success",
      sources_total: relevant.length,
      sources_ok: relevant.length,
      scholarships_found: 0,
      scholarships_inserted: 0,
      scholarships_updated: 0,
      results: [],
      elapsed_ms: Date.now() - startedAt,
      zip,
      covered_sources: relevant.map((s) => s.id),
      cached_sources: cached.map((s) => s.id),
    };
  }

  const summary = await runScrape({ sources: needsScrape });
  return {
    ...summary,
    zip,
    covered_sources: relevant.map((s) => s.id),
    cached_sources: cached.map((s) => s.id),
  };
}

/**
 * Scrape a single source and upsert its scholarships. Errors here are
 * caught and returned as part of the result — one broken site should never
 * abort the nightly run.
 */
async function scrapeOne(
  browser: Awaited<ReturnType<typeof launchBrowser>>,
  source: ScrapeSource,
  admin: ReturnType<typeof createAdminClient> | null,
): Promise<SourceResult> {
  const result: SourceResult = {
    source_id: source.id,
    url: source.url,
    ok: false,
    found: 0,
    inserted: 0,
    updated: 0,
  };

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Dispatch on source type. HTML + HTML_INDEX are fully implemented;
    // PDF + RSS are NEXT-SESSION work (src/lib/scraper/pdf.ts, rss.ts).
    // Throwing for unimplemented types means the per-source result records
    // the error in scrape_runs.results rather than crashing the whole run.
    let raws;
    if (source.type === "html") {
      // Single-page flow: one URL → Claude extraction → N rows.
      const html = await fetchRenderedHtml(page, source.url, source.wait_for);
      const trimmed = trimHtmlForExtraction(html);
      raws = await extractScholarshipsFromHtml({
        html: trimmed,
        sourceName: source.name,
        sourceUrl: source.url,
      });
    } else if (source.type === "html_index") {
      // Index+per-page flow (CCCF pattern):
      //   Stage 1: fetch index, regex-extract sub-URLs (no Claude call).
      //   Stage 2: for each sub-URL, run the single-page flow and concat.
      //
      // One broken sub-URL is tolerated — we log and continue — because 72
      // pages fetched sequentially will inevitably hit the occasional
      // transient timeout and we'd rather collect 71 than abort.
      if (!source.link_pattern) {
        throw new Error(
          `html_index source ${source.id} is missing link_pattern`,
        );
      }
      const indexHtml = await fetchRenderedHtml(
        page,
        source.url,
        source.wait_for,
      );
      const subUrls = extractSubUrls(
        indexHtml,
        source.link_pattern,
        source.max_sub_urls,
      );
      console.log(
        `[${source.id}] index crawl: ${subUrls.length} sub-URLs discovered`,
      );

      raws = [];
      let subOk = 0;
      let subFail = 0;
      for (const subUrl of subUrls) {
        try {
          await sleep(INDEX_CRAWL_DELAY_MS);
          const subHtml = await fetchRenderedHtml(page, subUrl);
          const subTrimmed = trimHtmlForExtraction(subHtml);
          const subRaws = await extractScholarshipsFromHtml({
            html: subTrimmed,
            sourceName: source.name,
            sourceUrl: subUrl,
          });
          raws.push(...subRaws);
          subOk++;
        } catch (subErr) {
          subFail++;
          console.warn(
            `[${source.id}] sub-URL failed: ${subUrl} — ${
              subErr instanceof Error ? subErr.message : String(subErr)
            }`,
          );
        }
      }
      console.log(
        `[${source.id}] index crawl done: ${subOk} ok, ${subFail} failed, ${raws.length} scholarships extracted`,
      );
    } else if (source.type === "pdf") {
      throw new Error(
        `PDF pipeline not yet implemented — see src/lib/scraper/pdf.ts (planned)`,
      );
    } else if (source.type === "rss") {
      throw new Error(
        `RSS pipeline not yet implemented — see src/lib/scraper/rss.ts (planned)`,
      );
    } else {
      throw new Error(`Unknown source type: ${(source as { type: string }).type}`);
    }

    const normalized: NormalizedScholarship[] = raws
      .map((r) => normalize(r, source))
      .filter((n): n is NormalizedScholarship => n !== null)
      // Drop rows whose URL equals the listing page itself — those are
      // extraction artifacts, not real scholarships, and overlap with seed
      // data for foundations that are already in seed.sql.
      .filter((n) => n.url !== source.url);

    result.found = normalized.length;

    if (admin && normalized.length > 0) {
      const { inserted, updated } = await upsertDedup(admin, normalized);
      result.inserted = inserted;
      result.updated = updated;
    }

    result.ok = true;
  } catch (err) {
    result.ok = false;
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    await context.close().catch(() => undefined);
  }

  return result;
}

/**
 * Dedup by URL. We pre-query existing CATALOG rows (created_by IS NULL)
 * with their source so we can:
 *   1. Count inserted vs. updated for observability
 *   2. Skip rows that already exist as `seed` — we must never let the scraper
 *      flip a curated seed scholarship to `source='local'` just because the
 *      URL happens to match.
 *
 * Rows that already exist as `local` are still updated so the nightly run
 * can refresh deadline, amount, and eligibility as sites change them.
 *
 * NOTE: migration 007 replaced the global `scholarships_url_key` unique
 * constraint with a *partial* unique index (WHERE created_by IS NULL) so
 * multiple students can upload the same URL as their own `user_added` row.
 * That broke `.upsert({ onConflict: "url" })` — PostgREST can't resolve a
 * partial index by column name — so we do explicit insert + per-row update
 * instead. Slightly more chatty but correct, and the scraper's write volume
 * is bounded (~100 rows/run) so the round-trip cost is negligible.
 */
async function upsertDedup(
  admin: ReturnType<typeof createAdminClient>,
  rows: NormalizedScholarship[],
): Promise<{ inserted: number; updated: number }> {
  const urls = rows.map((r) => r.url);

  // Scope the existence check to catalog rows. A user_added row with the
  // same URL is a different (private) scholarship and must not influence
  // scraper behavior.
  const { data: existing } = await admin
    .from("scholarships")
    .select("url, source")
    .in("url", urls)
    .is("created_by", null);

  const existingByUrl = new Map<string, string>();
  for (const r of existing ?? []) {
    existingByUrl.set(r.url, r.source);
  }

  // Skip anything that already exists from a non-local source — we don't
  // want the scraper to overwrite seed data.
  const writable = rows.filter((r) => {
    const src = existingByUrl.get(r.url);
    return !src || src === "local";
  });

  if (writable.length === 0) return { inserted: 0, updated: 0 };

  const toInsertRaw = writable.filter((r) => !existingByUrl.has(r.url));
  const toUpdate = writable.filter((r) => existingByUrl.has(r.url));

  // CCCF's html_index pipeline can yield multiple rows that normalize to the
  // same URL within a single run — e.g., two fund pages both pointing at a
  // shared "apply here" landing page, or Claude emitting two variants for
  // the same award on a long detail page. Without this collapse the batch
  // insert violates scholarships_catalog_url_idx on the first dup pair and
  // the whole transaction rolls back, losing every row the scraper worked
  // for. First-wins is fine: the matcher has no way to prefer one variant
  // over another, and the nightly re-run will replace whichever copy won.
  const insertByUrl = new Map<string, NormalizedScholarship>();
  for (const row of toInsertRaw) {
    if (!insertByUrl.has(row.url)) insertByUrl.set(row.url, row);
  }
  const toInsert = Array.from(insertByUrl.values());
  const dupsCollapsed = toInsertRaw.length - toInsert.length;
  if (dupsCollapsed > 0) {
    console.log(
      `[upsert] collapsed ${dupsCollapsed} intra-batch duplicate URL(s) before insert`,
    );
  }

  // Insert new catalog rows in one round-trip. `created_by` defaults to
  // NULL so the partial unique index governs these.
  if (toInsert.length > 0) {
    const { error: insertErr } = await admin
      .from("scholarships")
      .insert(toInsert);
    if (insertErr) {
      throw new Error(`insert failed: ${insertErr.message}`);
    }
  }

  // Update existing local rows one at a time. We gate the UPDATE on both
  // url AND source='local' AND created_by IS NULL so a race where a seed
  // row appeared between our SELECT and UPDATE can't overwrite it.
  for (const row of toUpdate) {
    const { error: updateErr } = await admin
      .from("scholarships")
      .update({
        title: row.title,
        provider: row.provider,
        amount: row.amount,
        deadline: row.deadline,
        description: row.description,
        eligibility_summary: row.eligibility_summary,
        min_gpa: row.min_gpa,
        interests: row.interests,
        zip_scope: row.zip_scope,
        high_school_restriction: row.high_school_restriction,
        essay_prompt: row.essay_prompt,
      })
      .eq("url", row.url)
      .eq("source", "local")
      .is("created_by", null);
    if (updateErr) {
      throw new Error(`update failed for ${row.url}: ${updateErr.message}`);
    }
  }

  return { inserted: toInsert.length, updated: toUpdate.length };
}
