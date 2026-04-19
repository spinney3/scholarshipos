"use client";

import type { ClaudeErrorCode } from "@/lib/anthropic";

/**
 * Renders an error banner whose copy and tone depend on the classified
 * Claude error code. The quota_exceeded / config_missing / auth cases are
 * operator-level problems a student can't fix — they get a "contact
 * support" mailto. Transient errors (rate_limited / overloaded / server)
 * offer a retry hint instead.
 *
 * Kept in its own file so /essay, /vault, and any future Claude-powered
 * surface can share one component and one voice.
 */
interface Props {
  code?: ClaudeErrorCode;
  message: string;
  onDismiss?: () => void;
  onRetry?: () => void;
}

const SUPPORT_EMAIL = "shawn.pinney@gmail.com";

function buildMailto(subject: string, body: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

export function ClaudeErrorBanner({ code, message, onDismiss, onRetry }: Props) {
  const isOperatorIssue =
    code === "quota_exceeded" ||
    code === "config_missing" ||
    code === "auth";

  const isTransient =
    code === "rate_limited" ||
    code === "overloaded" ||
    code === "server_error";

  const tone = isOperatorIssue ? "rose" : isTransient ? "amber" : "rose";

  const cls =
    tone === "amber"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-rose-300 bg-rose-50 text-rose-900";

  const heading = isOperatorIssue
    ? "Claude coach is temporarily unavailable"
    : isTransient
    ? "Claude is busy — quick hiccup"
    : "Something went wrong";

  const mailto = buildMailto(
    "ScholarshipOS — Claude coach error",
    `Hi Shawn,\n\nI hit an error using the Claude coach in ScholarshipOS.\n\nError code: ${
      code ?? "unknown"
    }\nMessage: ${message}\n\n(Add anything else you want me to know about what you were doing here.)`,
  );

  return (
    <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="font-medium">{heading}</p>
          <p className="mt-1 text-sm opacity-90">{message}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
            {isTransient && onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-md border border-current px-2.5 py-1 font-medium hover:bg-white/60"
              >
                Try again
              </button>
            )}
            {isOperatorIssue && (
              <a
                href={mailto}
                className="rounded-md border border-current px-2.5 py-1 font-medium hover:bg-white/60"
              >
                Email support
              </a>
            )}
            {!isOperatorIssue && !isTransient && (
              <a href={mailto} className="underline underline-offset-2">
                Email support
              </a>
            )}
          </div>
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

/**
 * Thin error class so `fetch` helpers can throw an error that carries the
 * classified code through to whoever caught it — without any caller having
 * to hand-parse JSON responses again.
 */
export class ClaudeApiError extends Error {
  code?: ClaudeErrorCode;
  constructor(message: string, code?: ClaudeErrorCode) {
    super(message);
    this.name = "ClaudeApiError";
    this.code = code;
  }
}
