"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClaudeErrorBanner } from "./ClaudeErrorBanner";
import type { ClaudeErrorCode } from "@/lib/anthropic";

type Tab = "url" | "pdf";

interface FormError {
  code: ClaudeErrorCode | "client" | null;
  message: string;
}

const MAX_PDF_MB = 5;

export function ManualAddForm() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("url");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
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
    } else {
      if (!file) {
        setError({ code: "client", message: "Choose a PDF to upload." });
        setSubmitting(false);
        return;
      }
      if (file.size > MAX_PDF_MB * 1024 * 1024) {
        setError({
          code: "client",
          message: `PDF is too large. Max is ${MAX_PDF_MB}MB.`,
        });
        setSubmitting(false);
        return;
      }
      form.append("file", file);
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
        code?: ClaudeErrorCode;
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
      // Clear form, then send them to the pipeline after a beat so they see
      // the success confirmation.
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

  return (
    <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6">
      {/* --- Tabs --- */}
      <div className="flex gap-1 rounded-md bg-slate-100 p-1 w-fit">
        <TabButton active={tab === "url"} onClick={() => setTab("url")}>
          Paste a URL
        </TabButton>
        <TabButton active={tab === "pdf"} onClick={() => setTab("pdf")}>
          Upload a PDF
        </TabButton>
      </div>

      {/* --- Active tab body --- */}
      {tab === "url" ? (
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
      ) : (
        <div className="mt-5">
          <label
            htmlFor="scholarship-pdf"
            className="block text-sm font-medium text-slate-700"
          >
            Scholarship flyer (PDF)
          </label>
          <input
            id="scholarship-pdf"
            type="file"
            accept="application/pdf,.pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
            disabled={submitting}
          />
          <p className="mt-2 text-xs text-slate-500">
            Max {MAX_PDF_MB}MB. Works on typed flyers; scanned-image PDFs may
            not extract cleanly — consider re-typing the info into a Google
            Doc and pasting the share link under the URL tab instead.
          </p>
          {file && (
            <p className="mt-2 text-xs text-slate-700">
              Selected: <span className="font-medium">{file.name}</span> (
              {(file.size / 1024).toFixed(0)} KB)
            </p>
          )}
        </div>
      )}

      {/* --- Errors / success --- */}
      {error && error.code === "client" && (
        <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error.message}
        </p>
      )}
      {error && error.code !== "client" && error.code !== null && (
        <div className="mt-4">
          <ClaudeErrorBanner code={error.code} message={error.message} />
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
          {submitting
            ? tab === "url"
              ? "Reading page…"
              : "Reading PDF…"
            : "Extract & add to pipeline"}
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
