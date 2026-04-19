import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { matchScholarships, type MatchResult } from "@/lib/matching";
import { hasLocalCoverage } from "@/lib/scraper/zipMapping";
import type { Application, Profile, Scholarship } from "@/lib/types";
import { MatchList, type EligibleGroup } from "@/components/MatchList";

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

  // Split eligible into three buckets. Order matters — "My uploads" and
  // "Local" come first because they're the highest-signal rows per the
  // project's "$500 local with 12 applicants beats $5k national with 50k"
  // thesis.
  const myUploads: MatchResult[] = [];
  const localMatches: MatchResult[] = [];
  const nationalMatches: MatchResult[] = [];
  for (const r of eligible) {
    if (r.scholarship.source === "user_added") {
      myUploads.push(r);
    } else if (r.scholarship.zip_scope !== "national") {
      // Any zip-scoped scholarship that passed matching is local to THIS
      // student (the matcher disqualifies mismatched ZIPs). This covers
      // both scraper-sourced (source='local') rows and legacy seeded
      // regional rows (source='seed' with a zip_scope).
      localMatches.push(r);
    } else {
      nationalMatches.push(r);
    }
  }

  const coveredZip = hasLocalCoverage(profile.zip_code);

  const groups: EligibleGroup[] = [];

  if (myUploads.length > 0) {
    groups.push({
      key: "uploads",
      title: "My uploads",
      subtitle: "Scholarships you added yourself — private to your account.",
      accentClass: "bg-indigo-500",
      matches: myUploads,
    });
  }

  // Always render the Local section for students whose ZIP is covered, even
  // if empty — the empty-state is where we explain that the catalog needs a
  // scrape run. If the ZIP isn't covered at all, skip the section entirely
  // rather than tease something we can't deliver.
  if (coveredZip || localMatches.length > 0) {
    groups.push({
      key: "local",
      title: "Local to your area",
      subtitle:
        "Community foundations and regional awards. Smaller applicant pools — where you actually win.",
      accentClass: "bg-emerald-500",
      matches: localMatches,
      emptyState:
        localMatches.length === 0 ? (
          <div className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/40 p-5 text-sm text-emerald-900">
            <p className="font-medium">
              No local scholarships in the catalog yet for your region.
            </p>
            <p className="mt-1 text-emerald-800/90">
              We have community foundation coverage for your ZIP, but no rows
              have been loaded. Run <code className="rounded bg-white px-1.5 py-0.5 text-xs">npm run scrape:local</code>{" "}
              against the production database to pull current listings, or{" "}
              <Link
                href="/scholarships/new"
                className="font-medium underline underline-offset-2 hover:text-emerald-700"
              >
                add one manually
              </Link>{" "}
              if a counselor forwarded you something.
            </p>
          </div>
        ) : undefined,
    });
  }

  groups.push({
    key: "national",
    title: "National",
    subtitle: "Larger awards, larger applicant pools — still worth applying to the ones that fit.",
    accentClass: "bg-slate-400",
    matches: nationalMatches,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Your matches
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {eligible.length} scholarships match your profile
            {localMatches.length > 0 && (
              <>
                {" "}
                · <span className="text-emerald-700 font-medium">
                  {localMatches.length} local
                </span>
              </>
            )}
            .{" "}
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
        groups={groups}
        ineligible={ineligible}
        inPipeline={Object.fromEntries(inPipeline.entries())}
      />
    </div>
  );
}
