/**
 * /api/reminders — daily deadline reminder cron.
 *
 * Auth: Vercel Cron sends Authorization: Bearer <CRON_SECRET>, same
 * secret as /api/scrape. We share the secret because both routes are
 * "any internal operator can invoke them" endpoints and splitting
 * secrets for each adds ops overhead without meaningful security gain.
 *
 * Runtime: Node.js (Resend + service-role client are server-only). A
 * generous maxDuration because Resend calls are per-user sequential —
 * 100 students with upcoming deadlines could take ~30s even on a good
 * day. Still well within Vercel Pro's 300s cron ceiling.
 */

import { NextResponse } from "next/server";
import { runReminders } from "@/lib/reminders/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  return handle(request);
}

// Accept POST for manual curl triggers without a body.
export async function POST(request: Request) {
  return handle(request);
}

async function handle(request: Request) {
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

  // Optional ?dryRun=1 — computes who'd get emailed without calling Resend
  // or writing sent_reminders. Useful for first-day verification before
  // pointing DNS at the from-domain.
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  try {
    const summary = await runReminders({ dryRun });
    return NextResponse.json(summary, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
