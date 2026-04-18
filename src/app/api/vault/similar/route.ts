import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { VaultEssay, VaultPromptType } from "@/lib/types";
import { VAULT_PROMPT_TYPE_OPTIONS } from "@/lib/types";
import { rankVaultEssays } from "@/lib/vaultSimilarity";

const VALID_TYPES = new Set<VaultPromptType>(
  VAULT_PROMPT_TYPE_OPTIONS.map((o) => o.value),
);

/**
 * POST /api/vault/similar
 * Body: { prompt_type: VaultPromptType, prompt_text: string,
 *         excludeId?: string, limit?: number, minScore?: number }
 *
 * Returns the student's past vault essays ranked by similarity to the
 * given new prompt, using the local (no network) similarity engine.
 * This endpoint is cheap — safe to call on keystroke with debounce.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: {
    prompt_type?: string;
    prompt_text?: string;
    excludeId?: string;
    limit?: number;
    minScore?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body.prompt_type !== "string" ||
    !VALID_TYPES.has(body.prompt_type as VaultPromptType)
  ) {
    return NextResponse.json(
      { error: "prompt_type is required and must be a valid VaultPromptType" },
      { status: 400 },
    );
  }
  if (typeof body.prompt_text !== "string") {
    return NextResponse.json(
      { error: "prompt_text is required" },
      { status: 400 },
    );
  }

  let q = supabase
    .from("vault_essays")
    .select("*")
    .eq("user_id", user.id);
  if (body.excludeId) q = q.neq("id", body.excludeId);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const ranked = rankVaultEssays(
    {
      prompt_type: body.prompt_type as VaultPromptType,
      prompt_text: body.prompt_text,
    },
    (data ?? []) as VaultEssay[],
    { minScore: body.minScore ?? 0 },
  );

  const limit = typeof body.limit === "number" ? Math.max(1, Math.min(50, body.limit)) : 10;
  return NextResponse.json({ results: ranked.slice(0, limit) });
}
