"use client";

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

  const deadline = new Date(app.scholarship.deadline);
  const daysUntil = Math.round(
    (deadline.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );
  const urgent = daysUntil >= 0 && daysUntil <= 30;
  const past = daysUntil < 0;

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
          ${app.scholarship.amount.toLocaleString()}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500 truncate">
        {app.scholarship.provider}
      </p>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span
          className={
            past
              ? "text-slate-400"
              : urgent
                ? "text-rose-600 font-medium"
                : "text-slate-500"
          }
        >
          {deadline.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
          {past ? " · closed" : urgent ? ` · ${daysUntil}d left` : ""}
        </span>
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
    </article>
  );
}
