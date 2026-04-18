"use client";

import { useMemo, useState } from "react";
import type {
  Application,
  Essay,
  EssayDraft,
  InterviewTurn,
  Scholarship,
} from "@/lib/types";
import { INTERVIEW_TARGET_QUESTIONS } from "@/lib/types";

interface Props {
  application: Application;
  scholarship: Scholarship;
  initialEssay: Essay | null;
  initialDrafts: EssayDraft[]; // newest first
}

/**
 * Client-side driver for the essay coaching flow.
 *
 * Phases (mirrors essay.status on the server):
 *   1. No essay yet          -> Start screen with scholarship prompt + CTA.
 *   2. status=interviewing   -> Show transcript + input box for the current question.
 *   3. status=drafting       -> Interview done, "Generate first draft" CTA.
 *   4. status=refining/final -> Inline editor + version history.
 *
 * All network calls go to /api/essay/* routes which own Claude access and
 * Supabase writes. We only mutate local state off their responses.
 */
export function EssayCoach({
  application,
  scholarship,
  initialEssay,
  initialDrafts,
}: Props) {
  const [essay, setEssay] = useState<Essay | null>(initialEssay);
  const [drafts, setDrafts] = useState<EssayDraft[]>(initialDrafts);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestDraft = drafts[0] ?? null;

  async function postJson<T>(url: string, body: object): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) {
      throw new Error(json?.error ?? `Request failed: ${res.status}`);
    }
    return json as T;
  }

  async function handleStart() {
    setError(null);
    setBusy("Warming up your coach…");
    try {
      const { essay: created } = await postJson<{ essay: Essay }>(
        "/api/essay/start",
        { applicationId: application.id },
      );
      setEssay(created);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleAnswer(answer: string) {
    if (!essay) return;
    setError(null);
    setBusy("Thinking…");
    try {
      const { essay: updated } = await postJson<{
        essay: Essay;
        done: boolean;
      }>("/api/essay/answer", { essayId: essay.id, answer });
      setEssay(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerateDraft() {
    if (!essay) return;
    setError(null);
    setBusy("Drafting — this takes ~20 seconds…");
    try {
      const { essay: updated, draft } = await postJson<{
        essay: Essay;
        draft: EssayDraft;
      }>("/api/essay/draft", { essayId: essay.id });
      setEssay(updated);
      setDrafts((d) => [draft, ...d]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function handleSaveVersion(content: string, markFinal: boolean) {
    if (!essay) return;
    setError(null);
    setBusy("Saving…");
    try {
      const { draft } = await postJson<{ draft: EssayDraft }>(
        "/api/essay/refine",
        { essayId: essay.id, content, markFinal },
      );
      setDrafts((d) => [draft, ...d]);
      if (markFinal) {
        setEssay((e) => (e ? { ...e, status: "final" } : e));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {!essay && (
        <StartPanel
          scholarship={scholarship}
          busy={busy}
          onStart={handleStart}
        />
      )}

      {essay?.status === "interviewing" && (
        <InterviewPanel
          turns={essay.interview as InterviewTurn[]}
          busy={busy}
          onAnswer={handleAnswer}
        />
      )}

      {essay?.status === "drafting" && (
        <DraftingPanel
          turns={essay.interview as InterviewTurn[]}
          busy={busy}
          onGenerate={handleGenerateDraft}
        />
      )}

      {(essay?.status === "refining" || essay?.status === "final") &&
        latestDraft && (
          <RefinePanel
            essay={essay}
            draft={latestDraft}
            versions={drafts}
            busy={busy}
            onSave={handleSaveVersion}
            onRegenerate={handleGenerateDraft}
          />
        )}
    </div>
  );
}

// =============================================================
// Phase 1: fresh start
// =============================================================
function StartPanel({
  scholarship,
  busy,
  onStart,
}: {
  scholarship: Scholarship;
  busy: string | null;
  onStart: () => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">
        Start with a Socratic interview
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        Your coach will ask you {INTERVIEW_TARGET_QUESTIONS} or so targeted
        questions about your experience, then help you shape the answers into
        a first draft in your own voice. The coach won't write the essay for
        you — it writes with you.
      </p>
      {!scholarship.essay_prompt && (
        <p className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          This scholarship didn't include a specific essay prompt. The coach
          will use a general one.
        </p>
      )}
      <button
        disabled={!!busy}
        onClick={onStart}
        className="mt-5 rounded-md bg-brand-500 px-4 py-2 text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {busy ?? "Start essay"}
      </button>
    </div>
  );
}

// =============================================================
// Phase 2: interview
// =============================================================
function InterviewPanel({
  turns,
  busy,
  onAnswer,
}: {
  turns: InterviewTurn[];
  busy: string | null;
  onAnswer: (answer: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  // The question currently waiting for an answer is the last coach turn.
  const pending =
    turns.length > 0 && turns[turns.length - 1].role === "coach"
      ? turns[turns.length - 1]
      : null;
  const answeredPairs = useMemo(
    () => turns.filter((t) => t.role === "student").length,
    [turns],
  );

  const history = turns.slice(0, pending ? -1 : turns.length);

  async function submit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await onAnswer(trimmed);
    setDraft("");
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500">
        Question {answeredPairs + 1} of ~{INTERVIEW_TARGET_QUESTIONS}
      </div>

      {history.length > 0 && (
        <details className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
          <summary className="cursor-pointer text-slate-600">
            Previous answers ({history.filter((t) => t.role === "student").length})
          </summary>
          <div className="mt-3 space-y-3">
            {history.map((t, i) => (
              <div key={i}>
                <div
                  className={`text-xs font-medium ${
                    t.role === "coach" ? "text-brand-700" : "text-slate-500"
                  }`}
                >
                  {t.role === "coach" ? "Coach" : "You"}
                </div>
                <div className="whitespace-pre-wrap">{t.content}</div>
              </div>
            ))}
          </div>
        </details>
      )}

      {pending && (
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-brand-700">
            Coach
          </div>
          <p className="mt-1 text-slate-900 whitespace-pre-wrap">
            {pending.content}
          </p>

          <textarea
            className="mt-4 w-full rounded-md border border-slate-300 p-3 text-sm min-h-[140px] focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Write as much as you'd like — specifics help. Names, numbers, what you actually said or felt."
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!!busy}
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {busy ?? "Press Submit when you're done."}
            </span>
            <button
              onClick={submit}
              disabled={!!busy || !draft.trim()}
              className="rounded-md bg-brand-500 px-4 py-2 text-sm text-white hover:bg-brand-600 disabled:opacity-60"
            >
              Submit answer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================
// Phase 3: interview done, ready to draft
// =============================================================
function DraftingPanel({
  turns,
  busy,
  onGenerate,
}: {
  turns: InterviewTurn[];
  busy: string | null;
  onGenerate: () => void;
}) {
  const studentTurns = turns.filter((t) => t.role === "student");
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">
        Interview complete
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        You answered {studentTurns.length} questions. Your coach will now turn
        those into an outline and first draft — using only your words and
        specifics, in first person.
      </p>
      <button
        disabled={!!busy}
        onClick={onGenerate}
        className="mt-5 rounded-md bg-brand-500 px-4 py-2 text-white hover:bg-brand-600 disabled:opacity-60"
      >
        {busy ?? "Generate first draft"}
      </button>
    </div>
  );
}

// =============================================================
// Phase 4: refine the draft inline
// =============================================================
function RefinePanel({
  essay,
  draft,
  versions,
  busy,
  onSave,
  onRegenerate,
}: {
  essay: Essay;
  draft: EssayDraft;
  versions: EssayDraft[];
  busy: string | null;
  onSave: (content: string, markFinal: boolean) => void | Promise<void>;
  onRegenerate: () => void;
}) {
  const [content, setContent] = useState(draft.content);
  // When a new draft version arrives (e.g. after Regenerate), refresh the editor.
  // We key on draft.id so the useState re-initializes via a reset effect.
  const [lastSeenId, setLastSeenId] = useState(draft.id);
  if (lastSeenId !== draft.id) {
    setLastSeenId(draft.id);
    setContent(draft.content);
  }

  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const dirty = content !== draft.content;

  return (
    <div className="space-y-4">
      {draft.outline && (
        <details className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <summary className="cursor-pointer font-medium text-slate-900">
            Outline
          </summary>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-slate-700">
            {draft.outline}
          </pre>
        </details>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">
            {essay.status === "final" ? "Final draft" : "Your draft"}
          </h2>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span>
              Version {draft.version} · {draft.source === "claude" ? "AI draft" : "your edit"}
            </span>
            <span>{wordCount} words</span>
          </div>
        </div>

        <textarea
          className="mt-3 w-full rounded-md border border-slate-300 p-3 text-sm min-h-[460px] font-serif leading-relaxed focus:outline-none focus:ring-2 focus:ring-brand-500"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={!!busy}
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {busy ?? (dirty ? "Unsaved changes" : "Edits autosave as a new version when you click Save.")}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onRegenerate}
              disabled={!!busy}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              title="Ask Claude to regenerate from your interview answers"
            >
              Regenerate from interview
            </button>
            <button
              onClick={() => onSave(content, false)}
              disabled={!!busy || !dirty}
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-800 disabled:opacity-60"
            >
              Save version
            </button>
            <button
              onClick={() => onSave(content, true)}
              disabled={!!busy || !content.trim()}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm text-white hover:bg-brand-600 disabled:opacity-60"
            >
              Mark as final
            </button>
          </div>
        </div>
      </div>

      {versions.length > 1 && (
        <details className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
          <summary className="cursor-pointer font-medium text-slate-900">
            Version history ({versions.length})
          </summary>
          <ul className="mt-3 space-y-2">
            {versions.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between text-xs text-slate-600"
              >
                <span>
                  v{v.version} · {v.source === "claude" ? "AI" : "you"} ·{" "}
                  {new Date(v.created_at).toLocaleString()}
                </span>
                <span>
                  {v.content.trim().split(/\s+/).filter(Boolean).length} words
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
