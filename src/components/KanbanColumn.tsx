"use client";

import { useDroppable } from "@dnd-kit/core";
import type {
  ApplicationStatus,
  ApplicationWithScholarship,
} from "@/lib/types";
import { KanbanCard } from "./KanbanCard";

interface Props {
  status: ApplicationStatus;
  title: string;
  applications: ApplicationWithScholarship[];
  onDelete: (id: string) => void;
}

const COLUMN_TINT: Record<ApplicationStatus, string> = {
  discovered: "bg-slate-100",
  eligible: "bg-sky-50",
  in_progress: "bg-indigo-50",
  submitted: "bg-amber-50",
  won: "bg-emerald-50",
  lost: "bg-rose-50",
};

export function KanbanColumn({ status, title, applications, onDelete }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-72 rounded-lg border transition-colors ${
        isOver ? "border-brand-500" : "border-slate-200"
      } ${COLUMN_TINT[status]}`}
    >
      <header className="flex items-center justify-between px-3 py-2.5 border-b border-slate-200/70">
        <h3 className="font-medium text-sm text-slate-900">{title}</h3>
        <span className="text-xs text-slate-500 rounded-full bg-white px-2 py-0.5 border border-slate-200">
          {applications.length}
        </span>
      </header>
      <div className="p-2 space-y-2 min-h-[8rem]">
        {applications.map((a) => (
          <KanbanCard key={a.id} app={a} onDelete={onDelete} />
        ))}
      </div>
    </div>
  );
}
