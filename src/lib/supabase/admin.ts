import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client that uses the service-role key.
 *
 * This client bypasses Row-Level Security, so NEVER import it from a client
 * component, page, or any route that accepts unauthenticated input. Legitimate
 * callers are all cron-triggered routes gated by CRON_SECRET (/api/scrape,
 * /api/reminders) and the /api/scholarships/import route (which writes on
 * behalf of the authenticated student after validating the session).
 *
 * We do not expose auth (cookies) here — these writes have no user context.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  }
  if (!serviceKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Required for scraper, import, and reminder routes.",
    );
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
