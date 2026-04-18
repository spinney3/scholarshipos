import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VaultAdaptWorkbench } from "@/components/VaultAdaptWorkbench";

export const dynamic = "force-dynamic";

export default async function VaultAdaptPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/vault/adapt");

  // We fetch nothing server-side; the workbench does client-side
  // similarity + adapt calls so scores update as the student types.
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/vault"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to vault
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Adapt for a new prompt
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Paste a new scholarship&apos;s essay prompt. We&apos;ll surface past
          essays from your vault with similarity scores, and Claude can walk
          you through how to adapt the closest match — without rewriting your
          work for you.
        </p>
      </div>

      <VaultAdaptWorkbench />
    </div>
  );
}
