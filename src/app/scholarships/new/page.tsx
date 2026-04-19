import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";
import { ManualAddForm } from "@/components/ManualAddForm";

export const dynamic = "force-dynamic";

export default async function ManualAddPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/scholarships/new");

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();
  if (!profile || !profile.onboarded) redirect("/onboarding");

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Add a scholarship
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Found one a teacher emailed you, or a PTA flyer? Paste the URL or
            upload the PDF and we'll extract the fields and drop it into your
            pipeline.
          </p>
        </div>
        <Link
          href="/matches"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to matches
        </Link>
      </div>

      <ManualAddForm />

      <div className="mt-8 rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
        <p className="font-medium text-slate-800">
          What happens to your uploads?
        </p>
        <p className="mt-1">
          Scholarships you add here are private to your account. They show up
          only in your matches and pipeline — no other student sees them. We
          do not store the original PDF; we extract fields once and keep
          those. If the extraction missed something, edit the card on the
          pipeline board.
        </p>
      </div>
    </div>
  );
}
