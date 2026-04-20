/**
 * Deadline reminder orchestrator.
 *
 * Called from the /api/reminders cron route (daily, gated by CRON_SECRET).
 *
 * Pipeline:
 *   1. Pull every active application with a deadline 1, 3, or 7 days out
 *      whose student is onboarded + opted in (allow_marketing_emails).
 *   2. Load sent_reminders for those apps and drop any (app, threshold)
 *      pair we've already emailed — the job is idempotent under retry and
 *      resilient to the cron running twice on the same day.
 *   3. Group remaining items by user and email one digest per student.
 *   4. Record sent_reminders rows for each (app, threshold) actually
 *      included in a successful send. Rows are NOT recorded when the
 *      Resend API call fails, so the next run re-tries.
 *
 * Graceful degradation: if Resend is misconfigured or the API errors, we
 * still return a summary with per-user status so the cron log is useful
 * for debugging. One student's failure doesn't abort the other sends.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildHtml,
  buildSubject,
  buildText,
  type ReminderItem,
} from "./email";

type ApplicationStatus =
  | "discovered"
  | "eligible"
  | "in_progress"
  | "submitted"
  | "won"
  | "lost";

/** Thresholds (in days before deadline) that trigger a reminder email. */
const THRESHOLDS = [7, 3, 1] as const;
type Threshold = (typeof THRESHOLDS)[number];

/** Statuses that still need reminders — once submitted/won/lost we stop. */
const ACTIVE_STATUSES: ApplicationStatus[] = [
  "discovered",
  "eligible",
  "in_progress",
];

export interface UserSendResult {
  user_id: string;
  email: string | null;
  items: number;
  status: "sent" | "skipped" | "error";
  error?: string;
}

export interface SendSummary {
  started_at: string;
  elapsed_ms: number;
  candidates: number; // rows matching the threshold filter before dedup
  after_dedup: number; // rows still needing a reminder
  users_notified: number;
  results: UserSendResult[];
}

/**
 * Compute integer days between a YYYY-MM-DD deadline and today (UTC). We
 * normalize both to 12:00 UTC so DST transitions in local time zones don't
 * cause off-by-one errors for a 1-day-out reminder.
 */
function daysUntil(deadlineIso: string): number {
  const deadline = new Date(deadlineIso + "T12:00:00Z").getTime();
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);
  return Math.round((deadline - today.getTime()) / (24 * 60 * 60 * 1000));
}

/** The one threshold this application currently qualifies for, or null. */
function matchingThreshold(deadlineIso: string): Threshold | null {
  const d = daysUntil(deadlineIso);
  return (THRESHOLDS as readonly number[]).includes(d)
    ? (d as Threshold)
    : null;
}

export async function runReminders(options: {
  /** If true, compute the would-be sends but don't call Resend or write sent_reminders. */
  dryRun?: boolean;
} = {}): Promise<SendSummary> {
  const startedAt = Date.now();

  // Hard early-exit if Resend hasn't been configured yet. This lets the
  // Vercel cron entry ship before the ops work (DNS verify, API key,
  // migration 008) is complete — the route returns 200 with a clean
  // "skipped, not configured" summary instead of 500-ing nightly while
  // the operator finishes setup. Both RESEND_API_KEY and EMAIL_FROM are
  // required before we'll touch the database.
  if (!options.dryRun && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)) {
    return {
      started_at: new Date(startedAt).toISOString(),
      elapsed_ms: Date.now() - startedAt,
      candidates: 0,
      after_dedup: 0,
      users_notified: 0,
      results: [
        {
          user_id: "-",
          email: null,
          items: 0,
          status: "skipped",
          error: "RESEND_API_KEY or EMAIL_FROM not configured — reminder run is a no-op",
        },
      ],
    };
  }

  const admin = createAdminClient();

  // --- 1. Pull active applications with upcoming deadlines ---
  //
  // We fetch a generous window (all active apps with non-null future
  // deadlines) and filter to exact 7/3/1-day hits in JS. This avoids
  // pushing date arithmetic through Supabase PostgREST — which is
  // awkward — and the result set is small (bounded by users × ~10 apps).
  const { data: rows, error: fetchErr } = await admin
    .from("applications")
    .select(
      `
        id,
        user_id,
        status,
        scholarship:scholarships (
          title,
          provider,
          amount,
          deadline,
          url
        ),
        profile:profiles!inner (
          full_name,
          allow_marketing_emails,
          onboarded
        )
      `,
    )
    .in("status", ACTIVE_STATUSES);

  if (fetchErr) {
    throw new Error(`reminders: failed to load applications: ${fetchErr.message}`);
  }

  interface CandidateRow {
    application_id: string;
    user_id: string;
    full_name: string;
    threshold: Threshold;
    item: ReminderItem;
  }

  const candidates: CandidateRow[] = [];
  for (const r of rows ?? []) {
    // Supabase foreign-key expansion can return either an object or an
    // array depending on the relationship cardinality. Normalize.
    const scholarship = Array.isArray(r.scholarship) ? r.scholarship[0] : r.scholarship;
    const profile = Array.isArray(r.profile) ? r.profile[0] : r.profile;
    if (!scholarship || !profile) continue;
    if (!profile.onboarded) continue;
    if (!profile.allow_marketing_emails) continue;
    if (!scholarship.deadline) continue; // deadline-less rows can't be reminded about

    const threshold = matchingThreshold(scholarship.deadline);
    if (threshold === null) continue;

    candidates.push({
      application_id: r.id,
      user_id: r.user_id,
      full_name: profile.full_name ?? "",
      threshold,
      item: {
        application_id: r.id,
        title: scholarship.title,
        provider: scholarship.provider,
        amount: scholarship.amount,
        deadline: scholarship.deadline,
        days_until: threshold,
        url: scholarship.url ?? null,
      },
    });
  }

  // --- 2. Drop candidates we've already reminded about at this threshold ---
  const candidateAppIds = Array.from(new Set(candidates.map((c) => c.application_id)));
  const alreadySent = new Set<string>(); // "appId|threshold"
  if (candidateAppIds.length > 0) {
    const { data: sentRows, error: sentErr } = await admin
      .from("sent_reminders")
      .select("application_id, days_before_deadline")
      .in("application_id", candidateAppIds);
    if (sentErr) {
      throw new Error(`reminders: failed to load sent_reminders: ${sentErr.message}`);
    }
    for (const s of sentRows ?? []) {
      alreadySent.add(`${s.application_id}|${s.days_before_deadline}`);
    }
  }

  const toSend = candidates.filter(
    (c) => !alreadySent.has(`${c.application_id}|${c.threshold}`),
  );

  // --- 3. Group by user and send one digest each ---
  const byUser = new Map<
    string,
    { full_name: string; rows: CandidateRow[] }
  >();
  for (const c of toSend) {
    const existing = byUser.get(c.user_id);
    if (existing) {
      existing.rows.push(c);
    } else {
      byUser.set(c.user_id, { full_name: c.full_name, rows: [c] });
    }
  }

  const results: UserSendResult[] = [];
  const dryRun = !!options.dryRun;

  for (const [userId, { full_name, rows: userRows }] of byUser.entries()) {
    // Fetch the student's email from the auth schema. A student without a
    // deliverable email (e.g., deleted auth user but orphaned profile) is
    // skipped rather than errored — shouldn't happen under the ON DELETE
    // CASCADE, but we don't want one stray row to crash the run.
    const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(userId);
    const email = userRes?.user?.email ?? null;

    if (userErr || !email) {
      results.push({
        user_id: userId,
        email,
        items: userRows.length,
        status: "skipped",
        error: userErr?.message ?? "no email on auth user",
      });
      continue;
    }

    const items = userRows.map((r) => r.item);
    const firstName = full_name.trim().split(/\s+/)[0] || undefined;

    if (dryRun) {
      results.push({ user_id: userId, email, items: items.length, status: "sent" });
      continue;
    }

    try {
      await sendEmail({
        to: email,
        subject: buildSubject(items),
        html: buildHtml(items, firstName),
        text: buildText(items, firstName),
      });
    } catch (err) {
      results.push({
        user_id: userId,
        email,
        items: items.length,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    // --- 4. Record sent_reminders on success ---
    const inserts = userRows.map((r) => ({
      user_id: userId,
      application_id: r.application_id,
      days_before_deadline: r.threshold,
    }));
    const { error: insertErr } = await admin.from("sent_reminders").insert(inserts);
    if (insertErr) {
      // The email went out but we couldn't record it. On the next run the
      // student would get a duplicate reminder for the same threshold. We
      // surface the error but don't re-throw — a duplicate is worse than
      // nothing but not catastrophic.
      results.push({
        user_id: userId,
        email,
        items: items.length,
        status: "error",
        error: `email sent but sent_reminders insert failed: ${insertErr.message}`,
      });
      continue;
    }

    results.push({ user_id: userId, email, items: items.length, status: "sent" });
  }

  return {
    started_at: new Date(startedAt).toISOString(),
    elapsed_ms: Date.now() - startedAt,
    candidates: candidates.length,
    after_dedup: toSend.length,
    users_notified: results.filter((r) => r.status === "sent").length,
    results,
  };
}

/**
 * Thin Resend wrapper. Kept inline (no @resend/node SDK) to avoid adding a
 * dep for a single HTTP POST — Resend's REST API is trivial.
 */
async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  if (!from) throw new Error("EMAIL_FROM is not configured");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
}
