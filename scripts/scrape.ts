/**
 * Local scraper runner. Invoke with `npm run scrape:local`.
 *
 * Runs the same orchestrator the cron route uses and prints a summary.
 * Useful for iterating on extraction prompts or normalization without a
 * round-trip to Vercel. Env is loaded via Node's native --env-file flag,
 * wired through the npm script in package.json — no dotenv dependency.
 *
 * Pass --dry-run to skip Supabase writes.
 */

import { runScrape } from "../src/lib/scraper/run";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const summary = await runScrape({ dryRun });

  console.log("\n=== Scrape summary ===");
  console.log(`Status:       ${summary.status}`);
  console.log(`Sources:      ${summary.sources_ok}/${summary.sources_total} ok`);
  console.log(`Found:        ${summary.scholarships_found}`);
  console.log(`Inserted:     ${summary.scholarships_inserted}`);
  console.log(`Updated:      ${summary.scholarships_updated}`);
  console.log(`Elapsed:      ${(summary.elapsed_ms / 1000).toFixed(1)}s\n`);

  for (const r of summary.results) {
    const marker = r.ok ? "✓" : "✗";
    const note = r.ok
      ? `found=${r.found} inserted=${r.inserted} updated=${r.updated}`
      : `error=${r.error}`;
    console.log(`  ${marker} ${r.source_id.padEnd(10)} ${note}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
