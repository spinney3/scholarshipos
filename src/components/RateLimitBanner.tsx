"use client";

/**
 * Banner rendered when a Claude-backed route refuses the request because
 * the user has hit a rate-limit cap. Tone is softer than ClaudeErrorBanner
 * because it's not a system problem — the student is fine, they just need
 * to slow down or come back later.
 *
 * Used by EssayCoach and (in future) any other client surface that hits
 * rate-limited routes. The codes come from src/lib/rateLimits.ts.
 */

import { useMemo } from "react";

export type RateLimitCode =
  | "daily_cap"
  | "burst_cap"
  | "input_too_large"
  | "draft_cap";

interface Details {
  limit?: number;
  used?: number;
  resetAtIso?: string;
  maxTokens?: number;
  actualTokens?: number;
}

interface Props {
  code: RateLimitCode;
  message: string;
  details?: Details;
  onDismiss?: () => void;
}

export function RateLimitBanner({ code, message, details, onDismiss }: Props) {
  // Input-too-large is the only "you did something wrong, fix it" variant
  // — everything else is "wait a bit." Use tone to reflect that.
  const tone = code === "input_too_large" ? "rose" : "amber";
  const cls =
    tone === "amber"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-rose-300 bg-rose-50 text-rose-900";

  const heading = useMemo(() => {
    switch (code) {
      case "daily_cap":
        return "You've hit today's coaching limit";
      case "burst_cap":
        return "Slow down for a moment";
      case "draft_cap":
        return "Draft generation limit reached";
      case "input_too_large":
        return "That's too much text in one go";
    }
  }, [code]);

  const resetLabel = useMemo(() => {
    if (!details?.resetAtIso) return null;
    const d = new Date(details.resetAtIso);
    if (Number.isNaN(d.getTime())) return null;
    // Relative time in a compact form — "tomorrow at 9:40 AM" or "at 2:15 PM".
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    return sameDay ? `at ${time}` : `tomorrow at ${time}`;
  }, [details?.resetAtIso]);

  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="font-medium">{heading}</p>
          <p className="mt-1 text-sm opacity-90">{message}</p>
          {(details?.used !== undefined && details?.limit !== undefined) && (
            <p className="mt-2 text-xs opacity-75">
              Used {details.used} of {details.limit}
              {resetLabel ? ` — resets ${resetLabel}` : ""}.
            </p>
          )}
          {code === "input_too_large" &&
            details?.actualTokens !== undefined &&
            details?.maxTokens !== undefined && (
              <p className="mt-2 text-xs opacity-75">
                You sent ~{details.actualTokens.toLocaleString()} tokens; the
                per-request limit is {details.maxTokens.toLocaleString()}. Try
                trimming to just the parts you want help with.
              </p>
            )}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="text-xs opacity-60 hover:opacity-100"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
