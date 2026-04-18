import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { KanbanBoard } from "@/components/KanbanBoard";
import type { ApplicationWithScholarship } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function KanbanPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/kanban");

  const { data, error } = await supabase
    .from("applications")
    .select(
      `id, user_id, scholarship_id, status, position, notes, created_at, updated_at,
       scholarship:scholarships (*)`,
    )
    .eq("user_id", user.id)
    .order("position", { ascending: true });

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <p className="text-red-600">Could not load your pipeline: {error.message}</p>
      </div>
    );
  }

  const applications = (data ?? []) as unknown as ApplicationWithScholarship[];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Your pipeline</h1>
        <p className="mt-1 text-sm text-slate-600">
          Drag cards between columns to update status. Deadlines in red close
          within 30 days.
        </p>
      </header>
      <KanbanBoard initialApplications={applications} />
    </div>
  );
}
