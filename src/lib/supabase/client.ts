"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Supabase client for use in React Client Components.
 * Reads session from the browser cookie set by the auth middleware.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
