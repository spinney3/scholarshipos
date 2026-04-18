import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function LandingPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/matches");
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-20">
      <section className="text-center">
        <p className="text-brand-600 font-medium text-sm uppercase tracking-wide">
          Phase 1 · Discover & Track
        </p>
        <h1 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight text-slate-900">
          Every scholarship you qualify for, in one pipeline.
        </h1>
        <p className="mt-5 text-lg text-slate-600 max-w-2xl mx-auto">
          ScholarshipOS surfaces local and national scholarships matched to your
          profile, then tracks each application from discovery to decision — so
          nothing falls through the cracks.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/signup"
            className="rounded-md bg-brand-500 px-5 py-2.5 text-white font-medium hover:bg-brand-600"
          >
            Create your profile
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-slate-300 bg-white px-5 py-2.5 text-slate-700 font-medium hover:bg-slate-50"
          >
            I already have an account
          </Link>
        </div>
      </section>

      <section className="mt-20 grid sm:grid-cols-3 gap-6">
        <Feature
          title="Smart matching"
          body="Scholarships filtered against your GPA, location, and interests — no more wading through awards you can't win."
        />
        <Feature
          title="Kanban pipeline"
          body="Move applications through Discovered → Eligible → In Progress → Submitted → Won/Lost. Drag and drop to update."
        />
        <Feature
          title="Local awards"
          body="Community foundations, Rotary, employer programs. The small awards with small applicant pools are where you actually win."
        />
      </section>
    </div>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
    </div>
  );
}
