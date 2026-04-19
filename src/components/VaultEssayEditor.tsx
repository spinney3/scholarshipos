"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  ApplicationWithScholarship,
  VaultEssay,
  VaultPromptType,
} from "@/lib/types";
import { VAULT_PROMPT_TYPE_OPTIONS } from "@/lib/types";

interface Props {
  mode: "new" | "edit";
  initial?: VaultEssay;
  initialLinkedApplicationIds?: string[];
  availableApplications: ApplicationWithScholarship[];
  // When forking, prefill with this sourceEssayId + original content.
  prefill?: {
    title?: string;
    prompt_type?: VaultPromptType;
    prompt_text?: string;
    content?: string;
    source_essay_id?: string;
  };
}

export function VaultEssayEditor({
  mode,
  initial,
  initialLinkedApplicationIds = [],
  availableApplications,
  prefill,
}: Props) {
  const router = useRouter();

  const [title, setTitle] = useState(
    initial?.title ?? prefill?.title ?? "",
  );
  const [promptType, setPromptType] = useState<VaultPromptType>(
    initial?.prompt_type ?? prefill?.prompt_type ?? "other",
  );
  const [promptText, setPromptText] = useState(
    initial?.prompt_text ?? prefill?.prompt_text ?? "",
  );
  const [content, setContent] = useState(
    initial?.content ?? prefill?.content ?? "",
  );
  const [linkedIds, setLinkedIds] = useState<string[]>(
    initialLinkedApplicationIds,
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);

  const wordCount = useMemo(() => {
    const m = content.trim().match(/\S+/g);
    return m ? m.length : 0;
  }, [content]);

  /**
   * Export helpers. All four modes are dependency-free and client-side so a
   * student can grab their work even if the backend is wobbly:
   *   - copy: Clipboard API
   *   - txt:  Blob download with .txt extension
   *   - doc:  HTML wrapped with application/msword MIME — Word, Pages, and
   *           Google Docs all open it cleanly. Not a "real" .docx but
   *           indistinguishable for an essay with no images/tables.
   *   - pdf:  Open a print-friendly window and call window.print(); the
   *           browser's print dialog offers "Save as PDF" on every OS.
   */
  const exportFilename = useMemo(() => {
    const safe = (title.trim() || "essay")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 60);
    return safe || "essay";
  }, [title]);

  function flashExportMsg(msg: string) {
    setExportMsg(msg);
    window.setTimeout(() => setExportMsg(null), 1800);
  }

  async function exportCopy() {
    try {
      await navigator.clipboard.writeText(content);
      flashExportMsg("Copied to clipboard");
    } catch {
      flashExportMsg("Copy failed — select and copy manually");
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Safari needs a tick before revoke.
    window.setTimeout(() => URL.revokeObjectURL(url), 250);
  }

  function exportTxt() {
    const header = title.trim() ? `${title.trim()}\n\n` : "";
    const blob = new Blob([header + content], { type: "text/plain" });
    downloadBlob(blob, `${exportFilename}.txt`);
    flashExportMsg("Downloaded .txt");
  }

  function exportDoc() {
    const escape = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const paragraphs = content
      .split(/\n{2,}/)
      .map((p) => `<p>${escape(p).replace(/\n/g, "<br/>")}</p>`)
      .join("\n");
    const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<title>${escape(title.trim() || "Essay")}</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.6; }
  h1 { font-size: 16pt; margin: 0 0 16pt 0; }
  p  { margin: 0 0 10pt 0; }
</style>
</head>
<body>
${title.trim() ? `<h1>${escape(title.trim())}</h1>` : ""}
${paragraphs}
</body>
</html>`;
    const blob = new Blob(["\ufeff", html], { type: "application/msword" });
    downloadBlob(blob, `${exportFilename}.doc`);
    flashExportMsg("Downloaded .doc");
  }

  function exportPdf() {
    const escape = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const paragraphs = content
      .split(/\n{2,}/)
      .map((p) => `<p>${escape(p).replace(/\n/g, "<br/>")}</p>`)
      .join("\n");
    const w = window.open("", "_blank", "width=720,height=900");
    if (!w) {
      flashExportMsg("Pop-up blocked — allow pop-ups to export PDF");
      return;
    }
    w.document.write(`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${escape(title.trim() || "Essay")}</title>
<style>
  @page { margin: 1in; }
  body { font-family: Georgia, "Times New Roman", serif; font-size: 12pt; line-height: 1.6; color: #111; max-width: 680px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 20pt; margin: 0 0 24px 0; }
  p  { margin: 0 0 12px 0; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
${title.trim() ? `<h1>${escape(title.trim())}</h1>` : ""}
${paragraphs}
<script>
  window.addEventListener('load', function() {
    setTimeout(function() { window.focus(); window.print(); }, 120);
  });
</script>
</body>
</html>`);
    w.document.close();
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: title.trim() || "Untitled essay",
        prompt_type: promptType,
        prompt_text: promptText,
        content,
        linked_application_ids: linkedIds,
        ...(mode === "new" && prefill?.source_essay_id
          ? { source_essay_id: prefill.source_essay_id }
          : {}),
      };
      const url = mode === "new" ? "/api/vault" : `/api/vault/${initial!.id}`;
      const method = mode === "new" ? "POST" : "PUT";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      const id = json.essay?.id ?? initial?.id;
      router.push(`/vault/${id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!initial) return;
    if (!confirm("Delete this essay? This can't be undone.")) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/vault/${initial.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Delete failed");
      router.push("/vault");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setSaving(false);
    }
  }

  function toggleLink(id: string) {
    setLinkedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-xs font-medium text-slate-700">
          Title
        </label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. My tutoring program — leadership"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <div>
          <label className="block text-xs font-medium text-slate-700">
            Prompt type
          </label>
          <select
            value={promptType}
            onChange={(e) => setPromptType(e.target.value as VaultPromptType)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          >
            {VAULT_PROMPT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-700">
            Original prompt text (optional but strongly recommended)
          </label>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={3}
            placeholder="Paste the scholarship's essay prompt here. It powers similarity matching against future prompts."
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-slate-700">
            Essay content
          </label>
          <span className="text-xs text-slate-400">
            {wordCount.toLocaleString()} words
          </span>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={18}
          placeholder="Paste or write your essay here. This content is private to your account."
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm leading-relaxed focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>

      {availableApplications.length > 0 && (
        <div>
          <label className="block text-xs font-medium text-slate-700">
            Linked applications (optional)
          </label>
          <p className="text-xs text-slate-500">
            Attach this essay to any scholarship applications that used it.
            Essays can be linked to multiple applications.
          </p>
          <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
            {availableApplications.map((app) => (
              <li key={app.id}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-white">
                  <input
                    type="checkbox"
                    checked={linkedIds.includes(app.id)}
                    onChange={() => toggleLink(app.id)}
                    className="rounded border-slate-300 text-brand-500 focus:ring-brand-500"
                  />
                  <span className="truncate">
                    <span className="font-medium text-slate-800">
                      {app.scholarship.title}
                    </span>{" "}
                    <span className="text-xs text-slate-500">
                      — {app.scholarship.provider}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {content.trim().length > 0 && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-slate-700">Export</p>
              <p className="text-xs text-slate-500">
                Grab your essay in any format — always your words, always yours.
              </p>
            </div>
            {exportMsg && (
              <span className="text-xs text-emerald-700">{exportMsg}</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportCopy}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Copy
            </button>
            <button
              type="button"
              onClick={exportTxt}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Download .txt
            </button>
            <button
              type="button"
              onClick={exportDoc}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Download .doc (Word)
            </button>
            <button
              type="button"
              onClick={exportPdf}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              Save as PDF
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between">
        <div>
          {mode === "edit" && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={saving}
              className="text-sm text-rose-600 hover:text-rose-700 disabled:opacity-50"
            >
              Delete essay
            </button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/vault"
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : mode === "new" ? "Save to vault" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
