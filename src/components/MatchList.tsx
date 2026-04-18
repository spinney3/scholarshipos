"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { MatchResult } from "@/lib/matching";
import type { ApplicationStatus } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/types";

interface Props {
  eligible: MatchResult[];
  ineligible: MatchResult[];
  inPipeline: Record<string, ApplicationStatus>;
}

export function MatchList({ eligible, ineligible, inPipeline }: Props) {
  const [pipeline, setPipeline] = useState(inPipeline);
  const [showIneligible, setShowIneligible] = useState(false);

  return (
    <>
      <div className="mt-6 grid gap-4">
        {eligible.map((r) => (
          <MatchCard
            key={r.scholarship.id}
            match={r}
            status={pipeline[r.scholarship.id]}
            onAdded={(id) =>
              setPipeline((p) => ({ ...p, [id]: "discovered" }))
            }
          />
        ))}
        {eligible.length === 0 && (
          <p className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
            No matches yet. Try adjusting your interests or GPA on your profile.
          </p>
        )}
      </div>

      {ineligible.length > 0 && (
        <div className="mt-10">
          <button
            onClick={() => setShowIneligible((v) => !v)}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
            {showIneligible ? "Hide" : "Show"} {ineligible.length} scholarships
            you don't currently qualify for
          </button>
          {showIneligible && (
            <div className="mt-4 grid gap-4 opacity-70">
              {ineligible.map((r) => (
                <MatchCard
                  key={r.scholarship.id}
                  match={r}
                  status={pipeline[r.scholarship.id]}
                  onAdded={(id) =>
                    setPipeline((p) => ({ ...p, [id]: "discovered" }))
                  }
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
}: {
  match: MatchResult;
  status: ApplicationStatus | undefined;
  onAdded: (id: string) => void;
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

  const deadline = new Date(s.deadline);
  const daysUntil = Math.round(
    (deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-slate-900">{s.title}</h3>
          <p className="text-sm text-slate-600">{s.provider}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-slate-900">
            ${s.amount.toLocaleString()}
          </div>
          <div className="text-xs text-slate-500">
            {deadline.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
            {daysUntil >= 0 ? ` · ${daysUntil}d` : " · closed"}
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

      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-slate-500">
          {!disqualified && `Match score: ${score}`}
        </div>
        <div className="flex items-center gap-3 text-sm">
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            className="text-slate-600 hover:text-slate-900"
          >
            View details ↗
          </a>
          {status ? (
            <span className="rounded-md bg-slate-100 px-3 py-1.5 text-slate-700">
              In pipeline · {STATUS_LABELS[status]}
            </span>
          ) : (
            <button
              onClick={addToPipeline}
              disabled={isPending}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-white hover:bg-brand-600 disabled:opacity-60"
            >
              Add to pipeline
            </button>
          )}
        </div>
      </div>

      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </article>
  );
}
