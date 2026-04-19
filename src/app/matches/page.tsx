import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { matchScholarships } from "@/lib/matching";
import type { Application, Profile, Scholarship } from "@/lib/types";
import { MatchList } from "@/components/MatchList";

export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/matches");

  // Load the profile; if not onboarded, send them through the wizard.
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (!profile || !profile.onboarded) {
    redirect("/onboarding");
  }

  // All scholarships + the user's existing applications
  const [{ data: scholarships }, { data: applications }] = await Promise.all([
    // nullsFirst: false so scraped rows without a listed deadline sort to the
    // bottom of /matches rather than crowding the top. Dated scholarships —
    // which carry real urgency signal — stay at the front of the list.
    supabase
      .from("scholarships")
      .select("*")
      .order("deadline", { ascending: true, nullsFirst: false }),
    supabase.from("applications").select("id, scholarship_id, status").eq("user_id", user.id),
  ]);

  const results = matchScholarships(profile, (scholarships ?? []) as Scholarship[]);
  const inPipeline = new Map<string, Application["status"]>();
  for (const a of (applications ?? []) as Application[]) {
    inPipeline.set(a.scholarship_id, a.status);
  }

  const eligible = results.filter((r) => !r.disqualified);
  const ineligible = results.filter((r) => r.disqualified);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Your matches
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {eligible.length} scholarships match your profile.{" "}
            <Link
              href="/kanban"
              className="text-brand-600 hover:text-brand-700 font-medium"
            >
              View pipeline →
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <Link
            href="/scholarships/new"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-slate-700 hover:bg-slate-50"
          >
            + Add scholarship
          </Link>
          <Link
            href="/onboarding"
            className="text-slate-600 hover:text-slate-900"
          >
            Edit profile
          </Link>
        </div>
      </header>

      <MatchList
        eligible={eligible}
        ineligible={ineligible}
        inPipeline={Object.fromEntries(inPipeline.entries())}
      />
    </div>
  );
}
