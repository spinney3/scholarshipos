"use client";

import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { ApplicationWithScholarship } from "@/lib/types";

interface Props {
  app: ApplicationWithScholarship;
  dragging?: boolean;
  onDelete?: (id: string) => void;
}

export function KanbanCard({ app, dragging, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: app.id });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  // Deadline may be null for scraped community-foundation rows that list
  // scholarship names without per-award dates — render "No date listed"
  // and skip urgency/past styling.
  const deadline = app.scholarship.deadline
    ? new Date(app.scholarship.deadline)
    : null;
  const daysUntil = deadline
    ? Math.round((deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const urgent = daysUntil !== null && daysUntil >= 0 && daysUntil <= 30;
  const past = daysUntil !== null && daysUntil < 0;

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`group rounded-md bg-white border border-slate-200 p-3 shadow-sm cursor-grab active:cursor-grabbing ${
        dragging ? "shadow-lg ring-2 ring-brand-500" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-slate-900 leading-snug">
          {app.scholarship.title}
        </h4>
        <span className="shrink-0 text-xs font-semibold text-slate-700">
          {app.scholarship.amount > 0
            ? `$${app.scholarship.amount.toLocaleString()}`
            : "Varies"}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500 truncate">
        {app.scholarship.provider}
        {app.scholarship.source === "local" && (
          <span
            className="ml-1.5 inline-block text-[10px] uppercase tracking-wide rounded-full bg-emerald-50 text-emerald-700 px-1.5 py-0.5 font-medium align-middle"
            title="Local community foundation scholarship"
          >
            Local
          </span>
        )}
      </p>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span
          className={
            !deadline
              ? "text-slate-400 italic"
              : past
                ? "text-slate-400"
                : urgent
                  ? "text-rose-600 font-medium"
                  : "text-slate-500"
          }
        >
          {deadline ? (
            <>
              {deadline.toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
              {past ? " · closed" : urgent ? ` · ${daysUntil}d left` : ""}
            </>
          ) : (
            "No date listed"
          )}
        </span>
        <div className="flex items-center gap-2">
          <Link
            href={`/essay/${app.id}`}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-brand-600 hover:text-brand-700 font-medium"
          >
            Essay →
          </Link>
          {onDelete && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => onDelete(app.id)}
              className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 transition-opacity"
              aria-label="Remove from pipeline"
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
