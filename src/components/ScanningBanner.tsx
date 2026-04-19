"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Displayed on /matches while the zip-targeted scraper is likely still
 * running in the background. Gives the student a heads-up that more
 * results are coming and offers a refresh shortcut.
 *
 * Auto-refreshes once at ~45s — a rough p95 for the two-source worst case
 * with Claude extraction. If the scrape finished within that window, local
 * scholarships will be visible and the parent page hides this banner.
 */
export function ScanningBanner() {
  const router = useRouter();
  const [refreshed, setRefreshed] = useState(false);

  useEffect(() => {
    if (refreshed) return;
    const t = setTimeout(() => {
      setRefreshed(true);
      router.refresh();
    }, 45_000);
    return () => clearTimeout(t);
  }, [refreshed, router]);

  return (
    <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 h-4 w-4 animate-pulse rounded-full bg-emerald-500" />
        <div className="flex-1 text-sm">
          <p className="font-medium text-emerald-900">
            Checking for local scholarships in your area…
          </p>
          <p className="mt-0.5 text-emerald-800">
            We're scanning the community foundations that serve your region.
            New local opportunities will appear here in about 30 seconds.
          </p>
        </div>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="rounded-md border border-emerald-300 bg-white px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
        >
          Refresh now
        </button>
      </div>
    </div>
  );
}
