/**
 * Phase 3 — /api/scrape
 *
 * Cron-triggered endpoint that runs the nightly community-foundation scraper
 * and upserts results into Supabase with source='local'.
 *
 * Auth: Vercel Cron sends Authorization: Bearer <CRON_SECRET>. We require
 * that header so the route isn't publicly abusable (Playwright + Claude is
 * not cheap to invoke).
 *
 * Runtime: Node.js (Playwright won't run on Edge). maxDuration bumped since
 * 10 sources at ~15s apiece + Claude extraction lands well over the default.
 */

import { NextResponse } from "next/server";
import { runScrape } from "@/lib/scraper/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Cron max for Pro plan is 300s; Hobby is 60s. The scraper can exceed
// 60s with 10 sources, so this app requires Pro (or an external runner).
export const maxDuration = 300;

export async function GET(request: Request) {
  return handle(request);
}

// Also accept POST so manual triggers from dashboards / curl work cleanly.
export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
  // --- Auth ---
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server" },
      { status: 500 },
    );
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- Optional dry-run for testing without writing to Supabase ---
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  try {
    const summary = await runScrape({ dryRun });
    const httpStatus = summary.status === "failed" ? 500 : 200;
    return NextResponse.json(summary, { status: httpStatus });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { status: "failed", error: message },
      { status: 500 },
    );
  }
}
