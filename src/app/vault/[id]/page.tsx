import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  ApplicationWithScholarship,
  VaultEssay,
} from "@/lib/types";
import { VaultEssayEditor } from "@/components/VaultEssayEditor";

export const dynamic = "force-dynamic";

interface Props {
  params: { id: string };
}

export default async function EditVaultEssayPage({ params }: Props) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?redirect=/vault/${params.id}`);

  const [essayRes, linksRes, appsRes] = await Promise.all([
    supabase.from("vault_essays").select("*").eq("id", params.id).single(),
    supabase
      .from("vault_essay_applications")
      .select("application_id")
      .eq("vault_essay_id", params.id),
    supabase
      .from("applications")
      .select(
        `id, user_id, scholarship_id, status, position, notes, created_at, updated_at,
         scholarship:scholarships (*)`,
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false }),
  ]);

  if (essayRes.error || !essayRes.data) notFound();
  const essay = essayRes.data as VaultEssay;
  if (essay.user_id !== user.id) notFound();

  const linkedIds = (linksRes.data ?? []).map((l) => l.application_id);
  const applications = (appsRes.data ??
    []) as unknown as ApplicationWithScholarship[];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <Link
          href="/vault"
          className="text-sm text-slate-600 hover:text-slate-900"
        >
          ← Back to vault
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Edit essay
        </h1>
        {essay.source_essay_id && (
          <p className="mt-1 text-xs text-slate-500">
            Adapted from{" "}
            <Link
              href={`/vault/${essay.source_essay_id}`}
              className="text-brand-600 hover:text-brand-700"
            >
              another vault essay
            </Link>
            .
          </p>
        )}
      </div>

      <VaultEssayEditor
        mode="edit"
        initial={essay}
        initialLinkedApplicationIds={linkedIds}
        availableApplications={applications}
      />
    </div>
  );
}
