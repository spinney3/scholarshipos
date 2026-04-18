import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type {
  ApplicationWithScholarship,
  VaultEssay,
  VaultPromptType,
} from "@/lib/types";
import { VAULT_PROMPT_TYPE_OPTIONS } from "@/lib/types";
import { VaultEssayEditor } from "@/components/VaultEssayEditor";

export const dynamic = "force-dynamic";

interface Props {
  searchParams?: {
    from?: string;
    type?: string;
    prompt?: string;
  };
}

/**
 * New-essay page. Supports forking from an existing vault essay via
 * ?from=<vault_essay_id>&type=<prompt_type>&prompt=<new_prompt_text>
 * which is how the Adapt flow hands off to the editor.
 */
export default async function NewVaultEssayPage({ searchParams }: Props) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?redirect=/vault/new");

  // Load user's applications so they can optionally link the new essay.
  const { data: apps } = await supabase
    .from("applications")
    .select(
      `id, user_id, scholarship_id, status, position, notes, created_at, updated_at,
       scholarship:scholarships (*)`,
    )
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  const applications = (apps ?? []) as unknown as ApplicationWithScholarship[];

  // If ?from=<id> is present, load that essay as a prefill source.
  let prefill:
    | {
        title?: string;
        prompt_type?: VaultPromptType;
        prompt_text?: string;
        content?: string;
        source_essay_id?: string;
      }
    | undefined;

  if (searchParams?.from) {
    const { data: source } = await supabase
      .from("vault_essays")
      .select("*")
      .eq("id", searchParams.from)
      .eq("user_id", user.id)
      .single<VaultEssay>();
    if (source) {
      const requestedType =
        searchParams.type &&
        VAULT_PROMPT_TYPE_OPTIONS.some((o) => o.value === searchParams.type)
          ? (searchParams.type as VaultPromptType)
          : source.prompt_type;
      prefill = {
        title: `${source.title} (adapted)`,
        prompt_type: requestedType,
        prompt_text: searchParams.prompt ?? "",
        content: source.content,
        source_essay_id: source.id,
      };
    }
  }

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
          {prefill?.source_essay_id ? "Adapt essay" : "New essay"}
        </h1>
        {prefill?.source_essay_id && (
          <p className="mt-1 text-sm text-slate-600">
            Starting from a copy of a past essay. Edit it to fit the new
            prompt — the link back to the original is saved so we can track
            reuse later.
          </p>
        )}
      </div>

      <VaultEssayEditor
        mode="new"
        availableApplications={applications}
        prefill={prefill}
      />
    </div>
  );
}
