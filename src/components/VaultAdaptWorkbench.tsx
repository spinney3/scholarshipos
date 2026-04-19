"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  AdaptationGuidance,
  VaultEssayWithSimilarity,
  VaultPromptType,
} from "@/lib/types";
import {
  VAULT_PROMPT_TYPE_LABELS,
  VAULT_PROMPT_TYPE_OPTIONS,
} from "@/lib/types";
import type { ClaudeErrorCode } from "@/lib/anthropic";
import { ClaudeErrorBanner } from "./ClaudeErrorBanner";

type GuidanceError = { code?: ClaudeErrorCode; message: string };

/**
 * Client-side workbench for the Adapt flow.
 *
 * Left column: prompt input (type + text). Debounced POST to /api/vault/similar
 * returns ranked past essays with scores.
 *
 * Right column: the currently-selected past essay + (optional) Claude
 * adaptation guidance. Guidance is lazy — only generated when the student
 * clicks "Get Claude's adaptation plan", because it costs an API call.
 */
export function VaultAdaptWorkbench() {
  const [promptType, setPromptType] = useState<VaultPromptType>("leadership");
  const [promptText, setPromptText] = useState("");
  const [results, setResults] = useState<VaultEssayWithSimilarity[]>([]);
  const [loadingRank, setLoadingRank] = useState(false);
  const [rankError, setRankError] = useState<string | null>(null);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [guidance, setGuidance] = useState<AdaptationGuidance | null>(null);
  const [loadingGuidance, setLoadingGuidance] = useState(false);
  const [guidanceError, setGuidanceError] = useState<GuidanceError | null>(null);

  // Debounced ranking call
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSimilar = useCallback(
    async (type: VaultPromptType, text: string) => {
      if (text.trim().length < 10) {
        setResults([]);
        setRankError(null);
        return;
      }
      setLoadingRank(true);
      setRankError(null);
      try {
        const res = await fetch("/api/vault/similar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt_type: type,
            prompt_text: text,
            limit: 10,
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Ranking failed");
        setResults(json.results as VaultEssayWithSimilarity[]);
      } catch (e) {
        setRankError(e instanceof Error ? e.message : "Ranking failed");
      } finally {
        setLoadingRank(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSimilar(promptType, promptText);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [promptType, promptText, fetchSimilar]);

  // Reset guidance whenever selection or prompt changes — otherwise the
  // student could see stale guidance from a different essay.
  useEffect(() => {
    setGuidance(null);
    setGuidanceError(null);
  }, [selectedIdx, promptText, promptType]);

  const selected =
    selectedIdx !== null && selectedIdx < results.length
      ? results[selectedIdx]
      : null;

  async function runAdaptation() {
    if (!selected) return;
    setLoadingGuidance(true);
    setGuidanceError(null);
    try {
      const res = await fetch("/api/vault/adapt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          essayId: selected.essay.id,
          prompt_type: promptType,
          prompt_text: promptText,
        }),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        const code =
          typeof (json as { code?: unknown }).code === "string"
            ? ((json as { code: ClaudeErrorCode }).code)
            : undefined;
        const message =
          (typeof (json as { error?: unknown }).error === "string"
            ? (json as { error: string }).error
            : undefined) ?? "Adaptation failed";
        setGuidanceError({ code, message });
        return;
      }
      setGuidance(json.guidance as AdaptationGuidance);
    } catch (e) {
      setGuidanceError({
        message: e instanceof Error ? e.message : "Adaptation failed",
      });
    } finally {
      setLoadingGuidance(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* -------- Left: prompt + rankings -------- */}
      <section className="space-y-4">
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <label className="block text-xs font-medium text-slate-700">
            New prompt type
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

          <label className="mt-4 block text-xs font-medium text-slate-700">
            New prompt text
          </label>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={6}
            placeholder="Paste the new scholarship prompt here."
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <p className="mt-1 text-[11px] text-slate-400">
            Similarity updates as you type. Past essays are ranked locally —
            no API calls until you click Adapt.
          </p>
        </div>

        <div>
          <h2 className="text-sm font-medium text-slate-900">
            Past essays ranked by similarity
          </h2>
          {rankError && (
            <p className="mt-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {rankError}
            </p>
          )}
          {loadingRank && (
            <p className="mt-2 text-xs text-slate-400">Scoring…</p>
          )}
          {!loadingRank && promptText.trim().length < 10 && (
            <p className="mt-2 text-sm text-slate-500">
              Type at least a sentence of the new prompt to see matches.
            </p>
          )}
          {!loadingRank &&
            promptText.trim().length >= 10 &&
            results.length === 0 && (
              <p className="mt-2 text-sm text-slate-500">
                No past essays in your vault yet.{" "}
                <Link
                  href="/vault/new"
                  className="text-brand-600 hover:text-brand-700"
                >
                  Add one
                </Link>
                .
              </p>
            )}
          <ul className="mt-2 space-y-2">
            {results.map((r, i) => (
              <SimilarityRow
                key={r.essay.id}
                result={r}
                rank={i + 1}
                selected={selectedIdx === i}
                onSelect={() => setSelectedIdx(i)}
              />
            ))}
          </ul>
        </div>
      </section>

      {/* -------- Right: detail + guidance -------- */}
      <section className="lg:sticky lg:top-6 lg:self-start">
        {!selected ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
            Select a past essay on the left to preview it and generate
            Claude&apos;s adaptation plan.
          </div>
        ) : (
          <SelectedEssayPanel
            result={selected}
            onAdapt={runAdaptation}
            loadingGuidance={loadingGuidance}
            guidance={guidance}
            guidanceError={guidanceError}
            newPromptText={promptText}
            newPromptType={promptType}
          />
        )}
      </section>
    </div>
  );
}

function SimilarityRow({
  result,
  rank,
  selected,
  onSelect,
}: {
  result: VaultEssayWithSimilarity;
  rank: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const pct = Math.round(result.similarity.score * 100);
  const bar = pct < 25 ? "bg-slate-300" : pct < 55 ? "bg-amber-400" : "bg-emerald-500";
  return (
    <li>
      <button
        onClick={onSelect}
        className={`w-full rounded-md border bg-white p-3 text-left transition ${
          selected
            ? "border-brand-500 ring-1 ring-brand-500"
            : "border-slate-200 hover:border-slate-300"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900">
              <span className="mr-1 text-slate-400">#{rank}</span>
              {result.essay.title}
            </p>
            <p className="text-xs text-slate-500">
              {VAULT_PROMPT_TYPE_LABELS[result.essay.prompt_type]} ·{" "}
              {result.essay.word_count} words
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-sm font-semibold text-slate-900">{pct}%</div>
            <div className="mt-1 h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full ${bar}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span>
            tag {(result.similarity.tag_score * 100).toFixed(0)}%
          </span>
          <span>·</span>
          <span>
            keywords {(result.similarity.keyword_score * 100).toFixed(0)}%
          </span>
          {result.similarity.matched_keywords.length > 0 && (
            <>
              <span>·</span>
              <span className="truncate">
                {result.similarity.matched_keywords.slice(0, 4).join(", ")}
              </span>
            </>
          )}
        </div>
      </button>
    </li>
  );
}

function SelectedEssayPanel({
  result,
  onAdapt,
  loadingGuidance,
  guidance,
  guidanceError,
  newPromptText,
  newPromptType,
}: {
  result: VaultEssayWithSimilarity;
  onAdapt: () => void;
  loadingGuidance: boolean;
  guidance: AdaptationGuidance | null;
  guidanceError: GuidanceError | null;
  newPromptText: string;
  newPromptType: VaultPromptType;
}) {
  const forkHref = `/vault/new?from=${result.essay.id}&type=${newPromptType}&prompt=${encodeURIComponent(newPromptText)}`;
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-slate-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              {result.essay.title}
            </h3>
            <p className="text-xs text-slate-500">
              {VAULT_PROMPT_TYPE_LABELS[result.essay.prompt_type]}
            </p>
          </div>
          <Link
            href={`/vault/${result.essay.id}`}
            className="text-xs text-brand-600 hover:text-brand-700"
            target="_blank"
          >
            Open in vault ↗
          </Link>
        </div>
        {result.essay.prompt_text && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-slate-600">
              Original prompt
            </summary>
            <p className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-700">
              {result.essay.prompt_text}
            </p>
          </details>
        )}
        <details className="mt-3" open>
          <summary className="cursor-pointer text-xs text-slate-600">
            Essay content ({result.essay.word_count} words)
          </summary>
          <p className="mt-1 max-h-80 overflow-y-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs leading-relaxed text-slate-700">
            {result.essay.content}
          </p>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={onAdapt}
          disabled={loadingGuidance || newPromptText.trim().length < 10}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {loadingGuidance ? "Asking Claude…" : "Get adaptation plan"}
        </button>
        <Link
          href={forkHref}
          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Fork to new draft
        </Link>
      </div>

      {guidanceError && (
        <ClaudeErrorBanner
          code={guidanceError.code}
          message={guidanceError.message}
        />
      )}

      {guidance && <GuidancePanel guidance={guidance} />}
    </div>
  );
}

function GuidancePanel({ guidance }: { guidance: AdaptationGuidance }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 text-sm">
      <h4 className="text-sm font-semibold text-slate-900">
        Claude&apos;s adaptation plan
      </h4>
      <p className="mt-1 text-xs text-slate-500">
        Guidance only — not rewritten prose. You still write the new essay.
      </p>

      <p className="mt-3 text-slate-700">{guidance.summary}</p>

      {guidance.keep.length > 0 && (
        <div className="mt-4">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            Keep
          </h5>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {guidance.keep.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </div>
      )}

      {guidance.rewrite.length > 0 && (
        <div className="mt-4">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Rewrite
          </h5>
          <ul className="mt-1 space-y-3">
            {guidance.rewrite.map((r, i) => (
              <li key={i} className="rounded bg-amber-50 p-2 text-sm">
                <p className="font-medium text-slate-900">{r.what}</p>
                <p className="mt-1 text-xs text-slate-600">
                  <span className="font-semibold">Why:</span> {r.why}
                </p>
                <p className="mt-1 text-xs text-slate-700">
                  <span className="font-semibold">Ask yourself:</span> {r.how}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {guidance.new_angles.length > 0 && (
        <div className="mt-4">
          <h5 className="text-xs font-semibold uppercase tracking-wide text-brand-700">
            New angles to surface
          </h5>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
            {guidance.new_angles.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
