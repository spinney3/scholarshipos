import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { VaultEssay, VaultPromptType } from "@/lib/types";
import { VAULT_PROMPT_TYPE_OPTIONS } from "@/lib/types";

const VALID_TYPES = new Set<VaultPromptType>(
  VAULT_PROMPT_TYPE_OPTIONS.map((o) => o.value),
);

/**
 * GET /api/vault
 * Optional query ?type=<prompt_type> to filter.
 * Returns the authed user's vault essays, newest-updated first.
 */
export async function GET(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type");

  let q = supabase
    .from("vault_essays")
    .select("*")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (typeParam) {
    if (!VALID_TYPES.has(typeParam as VaultPromptType)) {
      return NextResponse.json(
        { error: "Invalid prompt_type" },
        { status: 400 },
      );
    }
    q = q.eq("prompt_type", typeParam);
  }

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ essays: (data ?? []) as VaultEssay[] });
}

/**
 * POST /api/vault
 * Body: { title?, prompt_type, prompt_text?, content?, source_essay_id?,
 *         linked_application_ids? }
 * Creates a new vault essay. Missing fields fall back to schema defaults.
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
    title?: string;
    prompt_type?: string;
    prompt_text?: string;
    content?: string;
    source_essay_id?: string | null;
    linked_application_ids?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prompt_type = body.prompt_type ?? "other";
  if (!VALID_TYPES.has(prompt_type as VaultPromptType)) {
    return NextResponse.json(
      { error: "Invalid prompt_type" },
      { status: 400 },
    );
  }

  const content = body.content ?? "";
  const { data: inserted, error: insertErr } = await supabase
    .from("vault_essays")
    .insert({
      user_id: user.id,
      title: body.title?.trim() || "Untitled essay",
      prompt_type,
      prompt_text: body.prompt_text ?? "",
      content,
      word_count: countWords(content),
      source_essay_id: body.source_essay_id ?? null,
    })
    .select("*")
    .single();

  if (insertErr || !inserted) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to create essay" },
      { status: 500 },
    );
  }

  // Optional application links
  if (body.linked_application_ids?.length) {
    const rows = body.linked_application_ids.map((application_id) => ({
      vault_essay_id: inserted.id,
      application_id,
    }));
    const { error: linkErr } = await supabase
      .from("vault_essay_applications")
      .insert(rows);
    if (linkErr) {
      // Links are best-effort; surface the essay but note the warning.
      return NextResponse.json(
        {
          essay: inserted as VaultEssay,
          warning: `Essay saved, but linking applications failed: ${linkErr.message}`,
        },
        { status: 201 },
      );
    }
  }

  return NextResponse.json({ essay: inserted as VaultEssay }, { status: 201 });
}

function countWords(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}
