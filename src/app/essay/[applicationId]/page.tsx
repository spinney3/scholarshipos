import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  Essay,
  EssayDraft,
  Scholarship,
  Application,
} from "@/lib/types";
import { EssayCoach } from "@/components/EssayCoach";

interface PageProps {
  params: { applicationId: string };
}

/**
 * Server component: loads the application, its scholarship, and any
 * existing essay + draft rows, then hands the client coach a fully
 * hydrated starting state. Everything else — interview flow, drafting,
 * inline editing — happens client-side against the /api/essay routes.
 */
export default async function EssayPage({ params }: PageProps) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: app } = await supabase
    .from("applications")
    .select("*, scholarship:scholarships(*)")
    .eq("id", params.applicationId)
    .maybeSingle();

  if (!app || app.user_id !== user.id) notFound();

  const scholarship = (
    Array.isArray(app.scholarship) ? app.scholarship[0] : app.scholarship
  ) as Scholarship;

  const { data: essay } = await supabase
    .from("essays")
    .select("*")
    .eq("application_id", params.applicationId)
    .maybeSingle();

  let drafts: EssayDraft[] = [];
  if (essay) {
    const { data } = await supabase
      .from("essay_drafts")
      .select("*")
      .eq("essay_id", essay.id)
      .order("version", { ascending: false });
    drafts = (data ?? []) as EssayDraft[];
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link
        href="/kanban"
        className="text-sm text-slate-500 hover:text-slate-900"
      >
        ← Back to pipeline
      </Link>
      <header className="mt-4">
        <h1 className="text-2xl font-semibold text-slate-900">
          {scholarship.title}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {scholarship.provider} · ${scholarship.amount.toLocaleString()}
        </p>
        {scholarship.essay_prompt && (
          <blockquote className="mt-4 rounded-lg border-l-4 border-brand-500 bg-brand-50 p-4 text-sm text-slate-800">
            <div className="text-xs font-medium uppercase tracking-wide text-brand-700">
              Essay prompt
            </div>
            <p className="mt-1">{scholarship.essay_prompt}</p>
          </blockquote>
        )}
      </header>

      <section className="mt-8">
        <EssayCoach
          application={app as Application}
          scholarship={scholarship}
          initialEssay={(essay ?? null) as Essay | null}
          initialDrafts={drafts}
        />
      </section>
    </main>
  );
}
