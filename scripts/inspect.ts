/**
 * Diagnostic: fetch a single source through the full Playwright pipeline
 * and dump the trimmed HTML + Claude's raw extraction response to files,
 * so we can see exactly what the scraper saw.
 *
 * Usage:
 *   npm run inspect -- svcf
 *   npm run inspect -- seattle
 *   npm run inspect -- cct
 *
 *   # ad-hoc URL (for probing sub-pages without editing sources.ts):
 *   npm run inspect -- url https://www.svcf.org/scholarships/find-scholarships/svcf-managed-scholarships
 *
 * Writes:
 *   /tmp/scrape-<id>.raw.html        full page.content()
 *   /tmp/scrape-<id>.trimmed.html    what we actually send to Claude
 *   /tmp/scrape-<id>.extraction.json Claude's structured output (RawScholarship[])
 */

import { writeFile } from "node:fs/promises";
import { getSource } from "../src/lib/scraper/sources";
import { launchBrowser, fetchRenderedHtml, trimHtmlForExtraction } from "../src/lib/scraper/browser";
import { extractScholarshipsFromHtml } from "../src/lib/scraper/extract";

async function main() {
  const first = process.argv[2];
  if (!first) {
    console.error("Usage: npm run inspect -- <source-id>");
    console.error("   or: npm run inspect -- url <https-url>");
    process.exit(1);
  }

  let source;
  let id: string;
  if (first === "url") {
    const u = process.argv[3];
    if (!u) {
      console.error("Usage: npm run inspect -- url <https-url>");
      process.exit(1);
    }
    // Build an ad-hoc source record that matches the ScrapeSource shape.
    const host = new URL(u).hostname.replace(/^www\./, "").split(".")[0];
    id = `adhoc-${host}`;
    source = { id, name: `Ad-hoc: ${u}`, region: "adhoc", url: u, zip_scope: "national" };
  } else {
    id = first;
    const s = getSource(id);
    if (!s) {
      console.error(`Unknown source: ${id}`);
      process.exit(1);
    }
    source = s;
  }

  console.log(`→ Launching browser for ${source.name} (${source.url})`);
  const browser = await launchBrowser();

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    console.log("→ Fetching rendered HTML...");
    const raw = await fetchRenderedHtml(page, source.url, source.wait_for);
    const trimmed = trimHtmlForExtraction(raw);

    const rawPath = `/tmp/scrape-${id}.raw.html`;
    const trimmedPath = `/tmp/scrape-${id}.trimmed.html`;
    await writeFile(rawPath, raw);
    await writeFile(trimmedPath, trimmed);

    console.log(`  raw HTML:     ${raw.length.toLocaleString()} chars  → ${rawPath}`);
    console.log(`  trimmed:      ${trimmed.length.toLocaleString()} chars  → ${trimmedPath}`);

    // Show a quick text-density sample — first 1500 chars of the <body>
    const bodyStart = trimmed.toLowerCase().indexOf("<body");
    if (bodyStart >= 0) {
      console.log("\n--- first 1500 chars of trimmed body ---");
      console.log(trimmed.slice(bodyStart, bodyStart + 1500));
      console.log("--- end sample ---\n");
    }

    console.log("→ Running Claude extraction...");
    const extracted = await extractScholarshipsFromHtml({
      html: trimmed,
      sourceName: source.name,
      sourceUrl: source.url,
    });

    const extractionPath = `/tmp/scrape-${id}.extraction.json`;
    await writeFile(extractionPath, JSON.stringify(extracted, null, 2));

    console.log(`\n  extracted:    ${extracted.length} scholarships  → ${extractionPath}`);
    if (extracted.length > 0) {
      console.log("  first row:    " + JSON.stringify(extracted[0], null, 2));
    } else {
      console.log("  (empty — open the trimmed.html to see what Claude was given)");
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
