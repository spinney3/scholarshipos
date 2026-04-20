/**
 * Email template for the daily deadline digest.
 *
 * Kept intentionally minimal — inline styles, one CTA, no tracking pixels.
 * We render both HTML and text; Resend/ISPs will pick whichever the
 * recipient's client prefers. Anything fancier (dark-mode variants,
 * AMP-for-email) is deferred until we have enough deliverability data to
 * justify the complexity.
 */

export interface ReminderItem {
  application_id: string;
  title: string;
  provider: string;
  amount: number;
  deadline: string; // YYYY-MM-DD
  days_until: number; // 7, 3, or 1
  url: string | null;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://scholarshipos.app";

function formatDollars(n: number): string {
  return n > 0 ? `$${n.toLocaleString()}` : "Varies";
}

function formatDeadline(iso: string): string {
  // Parse as UTC to avoid off-by-one when Vercel runs the cron in UTC but
  // the recipient reads in Eastern time. Render without year — all
  // reminders fire within 7 days of "now," so the month+day alone is
  // unambiguous and reads more naturally.
  const d = new Date(iso + "T12:00:00Z");
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function urgencyLabel(days: number): string {
  if (days <= 1) return "due tomorrow";
  if (days <= 3) return `${days} days out`;
  return `${days} days out`;
}

export function buildSubject(items: ReminderItem[]): string {
  const soonest = Math.min(...items.map((i) => i.days_until));
  const count = items.length;
  if (soonest <= 1) {
    return count === 1
      ? "A scholarship deadline is tomorrow"
      : `${count} scholarship deadlines this week — one is tomorrow`;
  }
  if (soonest <= 3) {
    return count === 1
      ? `A scholarship deadline in ${soonest} days`
      : `${count} scholarship deadlines this week`;
  }
  return count === 1
    ? "A scholarship deadline next week"
    : `${count} scholarship deadlines next week`;
}

export function buildHtml(
  items: ReminderItem[],
  firstName?: string,
): string {
  // Sort soonest first so the reader's eye lands on urgency.
  const sorted = [...items].sort((a, b) => a.days_until - b.days_until);

  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : "Hi,";

  const rows = sorted
    .map((i) => {
      const pill = i.days_until <= 1
        ? `<span style="display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#991b1b;background:#fee2e2;border-radius:999px;">${urgencyLabel(i.days_until)}</span>`
        : i.days_until <= 3
          ? `<span style="display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#92400e;background:#fef3c7;border-radius:999px;">${urgencyLabel(i.days_until)}</span>`
          : `<span style="display:inline-block;padding:2px 8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;color:#3730a3;background:#e0e7ff;border-radius:999px;">${urgencyLabel(i.days_until)}</span>`;

      const link = i.url
        ? `<a href="${escapeHtml(i.url)}" style="color:#3b82f6;text-decoration:underline;">View listing</a>`
        : `<span style="color:#94a3b8;font-style:italic;">No link</span>`;

      return `
        <tr>
          <td style="padding:16px;border-bottom:1px solid #e2e8f0;">
            <div style="font-weight:600;color:#0f172a;font-size:15px;">${escapeHtml(i.title)}</div>
            <div style="color:#64748b;font-size:13px;margin-top:2px;">${escapeHtml(i.provider)} · ${formatDollars(i.amount)}</div>
            <div style="margin-top:8px;font-size:13px;color:#334155;">
              ${pill}
              <span style="margin-left:8px;color:#475569;">Deadline: <strong>${formatDeadline(i.deadline)}</strong></span>
            </div>
            <div style="margin-top:8px;font-size:13px;">${link}</div>
          </td>
        </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>ScholarshipOS deadline reminders</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f8fafc;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 8px 28px;">
              <div style="font-size:13px;color:#64748b;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;">ScholarshipOS</div>
              <h1 style="margin:4px 0 0 0;font-size:22px;line-height:1.3;color:#0f172a;font-weight:700;">Deadlines coming up</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:12px 28px 4px 28px;color:#334155;font-size:15px;line-height:1.5;">
              ${greeting}<br>
              A quick heads-up on the scholarships in your pipeline that are due soon.
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 0 28px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;">
                ${rows}
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:24px 28px 28px 28px;">
              <a href="${APP_URL}/kanban" style="display:inline-block;padding:12px 20px;background:#3b82f6;color:#ffffff;text-decoration:none;font-weight:600;border-radius:8px;font-size:14px;">Open your pipeline →</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 24px 28px;font-size:12px;color:#94a3b8;line-height:1.5;">
              You're receiving this because you signed up for ScholarshipOS and opted into updates.
              <a href="${APP_URL}/onboarding" style="color:#94a3b8;text-decoration:underline;">Manage your email preferences</a>.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildText(items: ReminderItem[], firstName?: string): string {
  const sorted = [...items].sort((a, b) => a.days_until - b.days_until);
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const lines = sorted.map((i) => {
    const parts = [
      `• ${i.title} (${i.provider}) — ${formatDollars(i.amount)}`,
      `  ${urgencyLabel(i.days_until).replace(/^./, (c) => c.toUpperCase())} · Deadline: ${formatDeadline(i.deadline)}`,
    ];
    if (i.url) parts.push(`  ${i.url}`);
    return parts.join("\n");
  });

  return `${greeting}

A quick heads-up on the scholarships in your pipeline that are due soon.

${lines.join("\n\n")}

Open your pipeline: ${APP_URL}/kanban

Manage your email preferences: ${APP_URL}/onboarding
`;
}

// Minimal HTML escaper — we only interpolate a handful of user/provider
// strings so this doesn't need to be bulletproof, but it prevents the
// obvious injection vector of a scholarship title containing `<script>`.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
