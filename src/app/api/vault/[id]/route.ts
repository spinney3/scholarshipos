import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { VaultEssay, VaultEssayWithLinks, VaultPromptType } from "@/lib/types";
import { VAULT_PROMPT_TYPE_OPTIONS } from "@/lib/types";

const VALID_TYPES = new Set<VaultPromptType>(
  VAULT_PROMPT_TYPE_OPTIONS.map((o) => o.value),
);

/**
 * GET /api/vault/[id]
 * Returns the essay plus its linked application IDs.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data: essay, error } = await supabase
    .from("vault_essays")
    .select("*")
    .eq("id", params.id)
    .single();

  if (error || !essay) {
    return NextResponse.json({ error: "Essay not found" }, { status: 404 });
  }
  if (essay.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: links } = await supabase
    .from("vault_essay_applications")
    .select("application_id")
    .eq("vault_essay_id", params.id);

  const result: VaultEssayWithLinks = {
    ...(essay as VaultEssay),
    linked_application_ids: (links ?? []).map((l) => l.application_id),
  };

  return NextResponse.json({ essay: result });
}

/**
 * PUT /api/vault/[id]
 * Body: any subset of { title, prompt_type, prompt_text, content,
 *                       linked_application_ids }
 * Passing linked_application_ids REPLACES the full link set.
 */
export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
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
    linked_application_ids?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Ownership check (RLS would also enforce this, but a clean 403 beats a
  // silent no-op update when developing against a misconfigured policy).
  const { data: existing } = await supabase
    .from("vault_essays")
    .select("id, user_id")
    .eq("id", params.id)
    .single();
  if (!existing) {
    return NextResponse.json({ error: "Essay not found" }, { status: 404 });
  }
  if (existing.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.title === "string") {
    update.title = body.title.trim() || "Untitled essay";
  }
  if (typeof body.prompt_type === "string") {
    if (!VALID_TYPES.has(body.prompt_type as VaultPromptType)) {
      return NextResponse.json(
        { error: "Invalid prompt_type" },
        { status: 400 },
      );
    }
    update.prompt_type = body.prompt_type;
  }
  if (typeof body.prompt_text === "string") update.prompt_text = body.prompt_text;
  if (typeof body.content === "string") {
    update.content = body.content;
    update.word_count = countWords(body.content);
  }

  let updated: VaultEssay | null = null;
  if (Object.keys(update).length > 0) {
    const { data, error } = await supabase
      .from("vault_essays")
      .update(update)
      .eq("id", params.id)
      .select("*")
      .single();
    if (error || !data) {
      return NextResponse.json(
        { error: error?.message ?? "Failed to update" },
        { status: 500 },
      );
    }
    updated = data as VaultEssay;
  } else {
    const { data } = await supabase
      .from("vault_essays")
      .select("*")
      .eq("id", params.id)
      .single();
    updated = (data as VaultEssay) ?? null;
  }

  // Full-replace link set if provided.
  if (Array.isArray(body.linked_application_ids)) {
    const { error: delErr } = await supabase
      .from("vault_essay_applications")
      .delete()
      .eq("vault_essay_id", params.id);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    if (body.linked_application_ids.length > 0) {
      const rows = body.linked_application_ids.map((application_id) => ({
        vault_essay_id: params.id,
        application_id,
      }));
      const { error: insErr } = await supabase
        .from("vault_essay_applications")
        .insert(rows);
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ essay: updated });
}

/**
 * DELETE /api/vault/[id]
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { error } = await supabase
    .from("vault_essays")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

function countWords(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}
