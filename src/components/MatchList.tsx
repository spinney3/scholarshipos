"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { MatchResult } from "@/lib/matching";
import type { ApplicationStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";

/**
 * A labeled cluster of eligible matches. The page splits results by source
 * (My uploads / Local to your area / National) before handing them in, so
 * MatchList stays presentation-only. `emptyState` is rendered when the
 * group's `matches` array is empty — useful for the "Local" section when
 * the student's ZIP has coverage but nothing's been scraped yet.
 */
export interface EligibleGroup {
  key: string;
  title: string;
  subtitle?: string;
  matches: MatchResult[];
  emptyState?: React.ReactNode;
  accentClass?: string; // small colored bar next to the section title
}

interface Props {
  groups: EligibleGroup[];
  ineligible: MatchResult[];
  inPipeline: Record<string, ApplicationStatus>;
  /** Scholarship IDs the user has dismissed — hidden from groups/ineligible
   *  and surfaced in a collapsible "dismissed" section at the bottom so
   *  they can be restored. Loaded server-side from dismissed_scholarships. */
  dismissedIds: string[];
}

export function MatchList({
  groups,
  ineligible,
  inPipeline,
  dismissedIds,
}: Props) {
  const [pipeline, setPipeline] = useState(inPipeline);
  const [showIneligible, setShowIneligible] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  // Track dismissals on the client so the view can update without a full
  // page reload. Seeded from the server-loaded list. Adding an ID hides the
  // card; deleting restores it.
  const [dismissed, setDismissed] = useState<Set<string>>(
    () => new Set(dismissedIds),
  );

  function handleAdded(id: string) {
    setPipeline((p) => ({ ...p, [id]: "discovered" }));
  }

  function handleDismiss(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function handleRestore(id: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // Split the groups into "visible" and "dismissed-from-this-group" so the
  // user sees per-card removal without touching the server-passed data.
  const visibleGroups = groups.map((g) => ({
    ...g,
    matches: g.matches.filter((r) => !dismissed.has(r.scholarship.id)),
  }));
  const visibleIneligible = ineligible.filter(
    (r) => !dismissed.has(r.scholarship.id),
  );

  // Flatten everything that's currently dismissed so we can show them in
  // one collapsible restore section at the bottom.
  const allResults = [
    ...groups.flatMap((g) => g.matches),
    ...ineligible,
  ];
  const dismissedMatches = allResults.filter((r) =>
    dismissed.has(r.scholarship.id),
  );

  const totalEligible = visibleGroups.reduce(
    (n, g) => n + g.matches.length,
    0,
  );

  return (
    <>
      {visibleGroups.map((group) => (
        <section key={group.key} className="mt-8 first:mt-6">
          <div className="flex items-center gap-3">
            {group.accentClass && (
              <span
                aria-hidden
                className={`h-5 w-1.5 rounded-full ${group.accentClass}`}
              />
            )}
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {group.title}
                <span className="ml-2 text-sm font-normal text-slate-500">
                  ({group.matches.length})
                </span>
              </h2>
              {group.subtitle && (
                <p className="text-sm text-slate-600">{group.subtitle}</p>
              )}
            </div>
          </div>

          <div className="mt-3 grid gap-4">
            {group.matches.map((r) => (
              <MatchCard
                key={r.scholarship.id}
                match={r}
                status={pipeline[r.scholarship.id]}
                onAdded={handleAdded}
                onDismiss={handleDismiss}
                onDismissFailed={handleRestore}
              />
            ))}
            {group.matches.length === 0 && group.emptyState}
          </div>
        </section>
      ))}

      {totalEligible === 0 && visibleGroups.every((g) => !g.emptyState) && (
        <p className="mt-6 rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
          No matches yet. Try adjusting your interests or GPA on your profile.
        </p>
      )}

      {visibleIneligible.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setShowIneligible((v) => !v)}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            {showIneligible ? "Hide" : "Show"} {visibleIneligible.length}{" "}
            scholarships you don't currently qualify for
          </button>
          {showIneligible && (
            <div className="mt-4 grid gap-4 opacity-70">
              {visibleIneligible.map((r) => (
                <MatchCard
                  key={r.scholarship.id}
                  match={r}
                  status={pipeline[r.scholarship.id]}
                  onAdded={handleAdded}
                  onDismiss={handleDismiss}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {dismissedMatches.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setShowDismissed((v) => !v)}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            {showDismissed ? "Hide" : "Show"} {dismissedMatches.length}{" "}
            dismissed scholarship
            {dismissedMatches.length === 1 ? "" : "s"}
          </button>
          {showDismissed && (
            <div className="mt-4 grid gap-4 opacity-70">
              {dismissedMatches.map((r) => (
                <DismissedCard
                  key={r.scholarship.id}
                  match={r}
                  onRestore={handleRestore}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function MatchCard({
  match,
  status,
  onAdded,
  onDismiss,
  onDismissFailed,
}: {
  match: MatchResult;
  status: ApplicationStatus | undefined;
  onAdded: (id: string) => void;
  onDismiss: (id: string) => void;
  onDismissFailed?: (id: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const { scholarship: s, reasons, disqualifiers, disqualified, score } = match;

  async function addToPipeline() {
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from("applications").insert({
      user_id: user.id,
      scholarship_id: s.id,
      status: disqualified ? "discovered" : "eligible",
    });

    if (error) {
      setErr(error.message);
      return;
    }
    onAdded(s.id);
    startTransition(() => router.refresh());
  }

  async function dismiss() {
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Optimistically hide the card — the insert lands in the background.
    // If the network fails, we log and restore so the student isn't stuck
    // with a card that claims to be dismissed but isn't persisted.
    onDismiss(s.id);

    const { error } = await supabase
      .from("dismissed_scholarships")
      .upsert(
        { user_id: user.id, scholarship_id: s.id },
        { onConflict: "user_id,scholarship_id" },
      );

    if (error) {
      setErr(`Couldn't dismiss: ${error.message}`);
      // Roll back the optimistic hide — the parent restores the card.
      onDismissFailed?.(s.id);
    }
  }

  // Scraped rows from community foundation catalog pages often lack a
  // per-award deadline. Render "Deadline varies" and skip the days-remaining
  // pill in that case rather than dropping the row.
  const deadline = s.deadline ? new Date(s.deadline) : null;
  const daysUntil = deadline
    ? Math.round((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900">{s.title}</h3>
            {s.source === "local" && (
              <span
                title="Local scholarship — scraped from a community foundation in your region. These usually have fewer applicants."
                className="text-[11px] uppercase tracking-wide rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 font-medium"
              >
                Local
              </span>
            )}
            {s.source === "user_added" && (
              <span
                title="You added this scholarship manually. Only you can see it."
                className="text-[11px] uppercase tracking-wide rounded-full bg-indigo-50 text-indigo-700 px-2 py-0.5 font-medium"
              >
                My upload
              </span>
            )}
          </div>
          <p className="text-sm text-slate-600">{s.provider}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-slate-900">
            {s.amount > 0 ? `$${s.amount.toLocaleString()}` : "Varies"}
          </div>
          <div className="text-xs text-slate-500">
            {deadline ? (
              <>
                {deadline.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
                {daysUntil !== null && daysUntil >= 0
                  ? ` · ${daysUntil}d`
                  : " · closed"}
              </>
            ) : (
              <span className="italic">Deadline varies</span>
            )}
          </div>
        </div>
      </div>

      <p className="mt-3 text-sm text-slate-700">{s.description}</p>

      {!disqualified && reasons.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {reasons.map((r, i) => (
            <li
              key={i}
              className="text-xs rounded-full bg-brand-50 text-brand-700 px-2 py-0.5"
            >
              {r}
            </li>
          ))}
        </ul>
      )}

      {disqualified && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {disqualifiers.map((r, i) => (
            <li
              key={i}
              className="text-xs rounded-full bg-amber-50 text-amber-800 px-2 py-0.5"
            >
              {r}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-y-2">
        <div className="text-xs text-slate-500">
          {!disqualified && `Match score: ${score}`}
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {s.url ? (
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="text-slate-600 hover:text-slate-900"
            >
              View details ↗
            </a>
          ) : (
            <span className="text-xs text-slate-400 italic">
              No link (PDF upload)
            </span>
          )}
          {status ? (
            <span className="rounded-md bg-slate-100 px-3 py-1.5 text-slate-700">
              In pipeline · {STATUS_LABELS[status]}
            </span>
          ) : (
            <>
              <button
                onClick={dismiss}
                className="text-slate-500 hover:text-slate-800"
                title="Hide this from your matches. You can restore it from the Dismissed section at the bottom."
              >
                Not interested
              </button>
              <button
                onClick={addToPipeline}
                disabled={isPending}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-white hover:bg-brand-600 disabled:opacity-60"
              >
                Add to pipeline
              </button>
            </>
          )}
        </div>
      </div>

      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </article>
  );
}

/**
 * Compact card for the "Dismissed" collapsible at the bottom of /matches.
 * Shows just enough to recognize the scholarship + a Restore button that
 * deletes the dismissed_scholarships row. Visually muted (via opacity-70 on
 * the wrapping div) so the section feels archival, not primary.
 */
function DismissedCard({
  match,
  onRestore,
}: {
  match: MatchResult;
  onRestore: (id: string) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const { scholarship: s } = match;

  async function restore() {
    setErr(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Optimistic restore — pull it back into the eligible list immediately.
    onRestore(s.id);

    const { error } = await supabase
      .from("dismissed_scholarships")
      .delete()
      .eq("user_id", user.id)
      .eq("scholarship_id", s.id);

    if (error) {
      setErr(`Couldn't restore: ${error.message}`);
      // No rollback — the card is already back in the visible list. The
      // only loss is that the DB dismissal persists. Reload fixes it.
    }
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-slate-900">{s.title}</h3>
          <p className="text-xs text-slate-500">{s.provider}</p>
        </div>
        <button
          onClick={restore}
          className="text-sm text-brand-600 hover:text-brand-700 font-medium"
        >
          Restore
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </article>
  );
}
