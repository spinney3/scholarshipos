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
    <>
      {/* ---------- Hero ---------- */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 via-white to-white">
        {/* Decorative blobs — purely aesthetic, don't affect layout. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 -right-24 h-80 w-80 rounded-full bg-brand-200/40 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-200/40 blur-3xl"
        />

        <div className="relative mx-auto max-w-4xl px-4 pt-16 pb-20 sm:pt-24 sm:pb-28 text-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/80 backdrop-blur px-3 py-1 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            For high school juniors & seniors
          </span>
          <h1 className="mt-6 text-4xl sm:text-6xl font-bold tracking-tight text-slate-900">
            Win the scholarship money
            <br className="hidden sm:block" />
            <span className="bg-gradient-to-r from-brand-600 to-emerald-600 bg-clip-text text-transparent">
              {" "}you&rsquo;d have missed.
            </span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-slate-600 max-w-2xl mx-auto">
            Local community foundations, Rotary clubs, and employer programs give
            away thousands of small scholarships every year — they almost never
            show up on Fastweb. ScholarshipOS finds them, matches them to you,
            and helps you write essays that sound like <em>you</em>.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-md bg-brand-500 px-6 py-3 text-white text-base font-semibold shadow-sm hover:bg-brand-600"
            >
              Start for free
            </Link>
            <Link
              href="/login"
              className="rounded-md border border-slate-300 bg-white px-6 py-3 text-slate-700 text-base font-medium hover:bg-slate-50"
            >
              I already have an account
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-500">
            No credit card required. Your first essay coaching cycle is free.
          </p>
        </div>
      </section>

      {/* ---------- The math (why local matters) ---------- */}
      <section className="mx-auto max-w-5xl px-4 py-16">
        <div className="rounded-2xl bg-slate-900 text-white p-6 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand-300">
            The math everyone misses
          </p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold">
            A $500 local scholarship with 12 applicants beats a $5,000 national
            one with 50,000.
          </h2>
          <p className="mt-4 max-w-2xl text-slate-300">
            National scholarships are the lottery. Local awards are winnable. We
            crawl community foundations in your ZIP code — Chester County
            Community Foundation, Phoenixville Community Health Foundation, and
            more — so every small award your neighbors are quietly winning shows
            up in your queue too.
          </p>
          <dl className="mt-8 grid gap-6 sm:grid-cols-3 text-left">
            <div>
              <dt className="text-3xl font-bold text-brand-300">~70+</dt>
              <dd className="mt-1 text-sm text-slate-300">
                Local PA scholarships already in the index
              </dd>
            </div>
            <div>
              <dt className="text-3xl font-bold text-brand-300">6</dt>
              <dd className="mt-1 text-sm text-slate-300">
                Pipeline stages — nothing falls through the cracks
              </dd>
            </div>
            <div>
              <dt className="text-3xl font-bold text-brand-300">$0</dt>
              <dd className="mt-1 text-sm text-slate-300">
                To start. One free essay coaching cycle included.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">
            How it works
          </h2>
          <p className="mt-3 text-slate-600 max-w-xl mx-auto">
            Three steps. No generic advice, no AI-written essays, no
            application fees.
          </p>
        </div>

        <ol className="mt-10 grid gap-6 sm:grid-cols-3">
          <Step
            number="1"
            title="Tell us about you"
            body="GPA, ZIP code, extracurriculars, financial need. Two minutes. We use it to filter scholarships you actually qualify for — not a firehose of &quot;maybes.&quot;"
          />
          <Step
            number="2"
            title="See your matches"
            body="We pull local and national awards, score each one against your profile, and show you the ones you should actually apply to first."
          />
          <Step
            number="3"
            title="Write & track"
            body="A Socratic AI coach asks you questions, then helps you shape your answers into your own essay. Every application tracked on a Kanban board."
          />
        </ol>
      </section>

      {/* ---------- Feature strip ---------- */}
      <section className="mx-auto max-w-5xl px-4 pb-20">
        <div className="grid gap-4 sm:grid-cols-3">
          <Feature
            accent="bg-brand-500"
            title="Smart matching"
            body="Scholarships filtered against your GPA, ZIP, and interests — including &quot;close matches&quot; you could qualify for with one more activity."
          />
          <Feature
            accent="bg-indigo-500"
            title="Kanban pipeline"
            body="Discovered → Eligible → In Progress → Submitted → Won/Lost. Drag and drop. Deadline reminders. Essay vault linked to each card."
          />
          <Feature
            accent="bg-emerald-500"
            title="Local awards"
            body="Community foundations, Rotary, employer programs. The small awards with small applicant pools are where you actually win."
          />
        </div>
      </section>

      {/* ---------- Ethics / coach-not-ghostwriter ---------- */}
      <section className="mx-auto max-w-3xl px-4 pb-20 text-center">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          A coach, not a ghostwriter.
        </h2>
        <p className="mt-4 text-slate-600">
          Most scholarship ethics policies forbid AI-written essays — and
          admissions readers can spot them. ScholarshipOS never writes your
          essay for you. It asks good questions, pulls out the specifics of
          your actual experience, and helps you structure <em>your own</em>{" "}
          words into something a human reader will remember.
        </p>
      </section>

      {/* ---------- Final CTA ---------- */}
      <section className="mx-auto max-w-3xl px-4 pb-24 text-center">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
            Your first essay coaching cycle is free.
          </h2>
          <p className="mt-3 text-slate-600">
            No credit card. No cap on scholarships you can browse or track.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="rounded-md bg-brand-500 px-6 py-3 text-white text-base font-semibold shadow-sm hover:bg-brand-600"
            >
              Create your profile
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Step({
  number,
  title,
  body,
}: {
  number: string;
  title: string;
  body: string;
}) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-6">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-brand-700 font-semibold">
        {number}
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p
        className="mt-2 text-sm text-slate-600"
        // Body may contain &quot; entities from inline quotes.
        dangerouslySetInnerHTML={{ __html: body }}
      />
    </li>
  );
}

function Feature({
  accent,
  title,
  body,
}: {
  accent: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5">
      <div className={`h-1 w-10 rounded-full ${accent}`} aria-hidden />
      <h3 className="mt-3 font-semibold text-slate-900">{title}</h3>
      <p
        className="mt-2 text-sm text-slate-600"
        dangerouslySetInnerHTML={{ __html: body }}
      />
    </div>
  );
}
