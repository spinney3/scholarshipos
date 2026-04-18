"use client";

import { useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { createClient } from "@/lib/supabase/client";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type ApplicationStatus,
  type ApplicationWithScholarship,
} from "@/lib/types";
import { KanbanColumn } from "./KanbanColumn";
import { KanbanCard } from "./KanbanCard";

interface Props {
  initialApplications: ApplicationWithScholarship[];
}

export function KanbanBoard({ initialApplications }: Props) {
  const [apps, setApps] = useState<ApplicationWithScholarship[]>(
    initialApplications,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const grouped = useMemo(() => {
    const out: Record<ApplicationStatus, ApplicationWithScholarship[]> = {
      discovered: [],
      eligible: [],
      in_progress: [],
      submitted: [],
      won: [],
      lost: [],
    };
    for (const a of apps) out[a.status].push(a);
    return out;
  }, [apps]);

  const activeApp = activeId ? apps.find((a) => a.id === activeId) : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const appId = String(active.id);
    const overId = String(over.id);

    // Resolve the target column: either a column ID or a card in a column
    let targetStatus: ApplicationStatus | null = null;
    if (APPLICATION_STATUSES.includes(overId as ApplicationStatus)) {
      targetStatus = overId as ApplicationStatus;
    } else {
      const overApp = apps.find((a) => a.id === overId);
      if (overApp) targetStatus = overApp.status;
    }
    if (!targetStatus) return;

    const current = apps.find((a) => a.id === appId);
    if (!current || current.status === targetStatus) return;

    // Optimistic local update
    const prev = apps;
    setApps((cur) =>
      cur.map((a) => (a.id === appId ? { ...a, status: targetStatus! } : a)),
    );

    // Persist
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("applications")
      .update({ status: targetStatus })
      .eq("id", appId);

    if (updateError) {
      setError(updateError.message);
      setApps(prev); // rollback
    } else {
      setError(null);
    }
  }

  async function deleteApp(id: string) {
    const prev = apps;
    setApps((cur) => cur.filter((a) => a.id !== id));
    const supabase = createClient();
    const { error: delErr } = await supabase
      .from("applications")
      .delete()
      .eq("id", id);
    if (delErr) {
      setError(delErr.message);
      setApps(prev);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {apps.length === 0 ? (
        <EmptyState />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4">
            {APPLICATION_STATUSES.map((status) => (
              <KanbanColumn
                key={status}
                status={status}
                title={STATUS_LABELS[status]}
                applications={grouped[status]}
                onDelete={deleteApp}
              />
            ))}
          </div>

          <DragOverlay>
            {activeApp ? <KanbanCard app={activeApp} dragging /> : null}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
      <h3 className="font-medium text-slate-900">No applications yet</h3>
      <p className="mt-1 text-sm text-slate-600">
        Head to{" "}
        <a href="/matches" className="text-brand-600 hover:text-brand-700">
          Matches
        </a>{" "}
        and click <span className="font-medium">Add to pipeline</span> on any
        scholarship to get started.
      </p>
    </div>
  );
}
