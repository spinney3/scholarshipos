"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClaudeErrorBanner } from "./ClaudeErrorBanner";
import type { ClaudeErrorCode } from "@/lib/anthropic";

type Tab = "url" | "upload" | "paste";

/**
 * Non-Claude error codes returned by the import route. Kept as a typed union
 * so the rendering logic can swap in per-code recovery copy.
 */
type ImportErrorCode =
  | ClaudeErrorCode
  | "client"
  | "empty"
  | "unsupported_format"
  | "parse_failed"
  | "too_short"
  | "not_scholarship"
  | "invalid_url"
  | "timeout"
  | "network"
  | "too_large"
  | "not_text";

interface FormError {
  code: ImportErrorCode | null;
  message: string;
}

const MAX_FILE_MB = 5;
/** Soft warning shown when the student pastes > this many characters. */
const PASTE_SOFT_WARN_CHARS = 50_000;
/** Server-side hard cap mirror — we enforce client-side so the user gets a
 *  friendly message instead of a 413 from the route. */
const PASTE_HARD_MAX_CHARS = 5_000_000;

export function ManualAddForm() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<FormError | null>(null);
  const [success, setSuccess] = useState<{ title: string; id: string } | null>(
    null,
  );

  async function submit() {
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    const form = new FormData();
    form.append("mode", tab);

    if (tab === "url") {
      if (!url.trim()) {
        setError({ code: "client", message: "Paste a scholarship URL first." });
        setSubmitting(false);
        return;
      }
      form.append("url", url.trim());
    } else if (tab === "upload") {
      if (!file) {
        setError({ code: "client", message: "Choose a file to upload." });
        setSubmitting(false);
        return;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        setError({
          code: "client",
          message: `File is too large. Max is ${MAX_FILE_MB}MB.`,
        });
        setSubmitting(false);
        return;
      }
      form.append("file", file);
    } else {
      const trimmed = pasteText.trim();
      if (!trimmed) {
        setError({ code: "client", message: "Paste the scholarship details first." });
        setSubmitting(false);
        return;
      }
      if (trimmed.length > PASTE_HARD_MAX_CHARS) {
        setError({
          code: "client",
          message:
            "That's a lot of text — trim it down to just the scholarship info.",
        });
        setSubmitting(false);
        return;
      }
      form.append("text", trimmed);
    }

    try {
      const res = await fetch("/api/scholarships/import", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as {
        scholarship_id?: string;
        title?: string;
        error?: string;
        code?: ImportErrorCode;
        warning?: string;
      };

      if (!res.ok) {
        setError({
          code: data.code ?? "client",
          message: data.error ?? "Something went wrong. Please try again.",
        });
        setSubmitting(false);
        return;
      }

      setSuccess({
        title: data.title ?? "Your scholarship",
        id: data.scholarship_id!,
      });
      setTimeout(() => {
        router.push("/kanban");
        router.refresh();
      }, 1200);
    } catch (e) {
      setError({
        code: "client",
        message:
          e instanceof Error ? e.message : "Network error. Please try again.",
      });
      setSubmitting(false);
    }
  }

  const submitLabel = submitting
    ? tab === "url"
      ? "Reading page…"
      : tab === "upload"
        ? "Reading file…"
        : "Parsing text…"
    : "Extract & add to pipeline";

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
      {/* --- Tabs --- */}
      <div className="flex gap-1 rounded-md bg-slate-100 p-1 w-fit">
        <TabButton active={tab === "url"} onClick={() => setTab("url")}>
          Paste a URL
        </TabButton>
        <TabButton active={tab === "upload"} onClick={() => setTab("upload")}>
          Upload a file
        </TabButton>
        <TabButton active={tab === "paste"} onClick={() => setTab("paste")}>
          Paste text
        </TabButton>
      </div>

      {/* --- Active tab body --- */}
      {tab === "url" && (
        <div className="mt-5">
          <label
            htmlFor="scholarship-url"
            className="block text-sm font-medium text-slate-700"
          >
            Scholarship URL
          </label>
          <input
            id="scholarship-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.examplefoundation.org/scholarship"
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-brand-500"
            disabled={submitting}
          />
          <p className="mt-2 text-xs text-slate-500">
            We'll fetch the page and use Claude to pull out the title,
            provider, amount, deadline, and essay prompt. Works best on a
            single scholarship's detail page — not a full index listing.
          </p>
        </div>
      )}

      {tab === "upload" && (
        <div className="mt-5">
          <label
            htmlFor="scholarship-file"
            className="block text-sm font-medium text-slate-700"
          >
            Scholarship flyer or letter
          </label>
          <input
            id="scholarship-file"
            type="file"
            accept="application/pdf,.pdf,.docx,.txt,.md,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
            disabled={submitting}
          />
          <p className="mt-2 text-xs text-slate-500">
            PDF, Word (.docx), or plain text. Max {MAX_FILE_MB}MB. Scanned-image
            PDFs may not extract cleanly — if you hit that, switch to the{" "}
            <button
              type="button"
              onClick={() => setTab("paste")}
              className="font-medium text-brand-700 underline hover:text-brand-800"
            >
              Paste text
            </button>{" "}
            tab and type the key details by hand.
          </p>
          {file && (
            <p className="mt-2 text-xs text-slate-700">
              Selected: <span className="font-medium">{file.name}</span> (
              {(file.size / 1024).toFixed(0)} KB)
            </p>
          )}
        </div>
      )}

      {tab === "paste" && (
        <div className="mt-5">
          <label
            htmlFor="scholarship-paste"
            className="block text-sm font-medium text-slate-700"
          >
            Scholarship details
          </label>
          <textarea
            id="scholarship-paste"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste the body of a counselor's email, a PTA announcement, the eligibility section from a flyer — whatever you have. We'll figure out the rest."
            rows={10}
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono text-slate-800 focus:border-brand-500 focus:ring-brand-500"
            disabled={submitting}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              Works great for forwarded emails and short blurbs — just the
              bits that describe the scholarship.
            </span>
            <span
              className={
                pasteText.length > PASTE_SOFT_WARN_CHARS
                  ? "font-medium text-amber-700"
                  : ""
              }
            >
              {pasteText.length.toLocaleString()} chars
            </span>
          </div>
          {pasteText.length > PASTE_SOFT_WARN_CHARS && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              That's a lot of text. Claude only needs the part describing the
              scholarship — trimming signatures, quoted replies, and unrelated
              announcements will give cleaner results.
            </p>
          )}
        </div>
      )}

      {/* --- Errors / success --- */}
      {error && isExtractCode(error.code) && (
        <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {error.message}
        </p>
      )}
      {error && error.code === "client" && (
        <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error.message}
        </p>
      )}
      {error && isClaudeCode(error.code) && (
        <div className="mt-4">
          <ClaudeErrorBanner
            code={error.code as ClaudeErrorCode}
            message={error.message}
          />
        </div>
      )}
      {success && (
        <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Added <span className="font-medium">{success.title}</span> to your
          pipeline. Redirecting…
        </p>
      )}

      {/* --- Submit --- */}
      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !!success}
          className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

// Extract / fetch errors → amber, friendly "here's what to try" tone.
function isExtractCode(code: ImportErrorCode | null): boolean {
  return (
    code === "empty" ||
    code === "unsupported_format" ||
    code === "parse_failed" ||
    code === "too_short" ||
    code === "not_scholarship" ||
    code === "invalid_url" ||
    code === "timeout" ||
    code === "network" ||
    code === "too_large" ||
    code === "not_text"
  );
}

// Claude API-specific errors → use the richer banner with retry guidance.
function isClaudeCode(code: ImportErrorCode | null): boolean {
  return (
    code === "rate_limited" ||
    code === "quota_exceeded" ||
    code === "overloaded" ||
    code === "auth" ||
    code === "config_missing" ||
    code === "server_error" ||
    code === "other"
  );
}
