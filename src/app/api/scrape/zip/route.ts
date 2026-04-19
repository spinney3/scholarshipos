/**
 * Phase 3.5 — /api/scrape/zip
 *
 * Per-student, zip-targeted scrape triggered at onboarding completion.
 *
 * Unlike /api/scrape (cron, requires CRON_SECRET), this route authenticates
 * via the student's Supabase session. It reads the ZIP from the student's
 * profile rather than the request body — preventing trivial abuse where a
 * caller sprays arbitrary ZIPs to force scrapes.
 *
 * Rate limiting: the runScrapeForZip 6h cache is the primary guard — if a
 * student's region was already scraped in the last 6h, the route returns
 * immediately with zero network/LLM cost. An additional per-user throttle
 * isn't needed because (a) the student has no way to point this at a
 * region other than their own, and (b) even if they did, the cache fires.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runScrapeForZip } from "@/lib/scraper/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Worst case: two uncached sources × ~30s apiece + Claude extraction.
export const maxDuration = 120;

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("zip_code")
    .eq("id", user.id)
    .single();

  if (profileErr || !profile) {
    return NextResponse.json(
      { error: "Profile not found" },
      { status: 404 },
    );
  }

  if (!profile.zip_code) {
    return NextResponse.json(
      {
        skipped: "no_zip",
        message: "Add a ZIP code to your profile to find local scholarships.",
      },
      { status: 200 },
    );
  }

  try {
    const summary = await runScrapeForZip(profile.zip_code);
    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "failed", error: message },
      { status: 500 },
    );
  }
}
