import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { EssayDraft, EssayStatus } from "@/lib/types";

/**
 * POST /api/essay/refine
 * Body: { essayId: string, content: string, markFinal?: boolean }
 *
 * Saves the student's inline edit as a new `source: "user"` version.
 * If markFinal is true, flips the essay's status to "final".
 *
 * Deliberately does NOT call Claude — this route exists to preserve
 * student edits untouched. Future revisions (Phase 2.5) can layer on a
 * separate "Ask Claude for feedback" route that surfaces suggestions
 * without overwriting the student's draft.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { essayId?: string; content?: string; markFinal?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { essayId, content, markFinal } = body;
  if (!essayId || typeof content !== "string" || !content.trim()) {
    return NextResponse.json(
      { error: "essayId and non-empty content are required" },
      { status: 400 },
    );
  }

  // Ownership + phase check.
  const { data: essay, error: essayErr } = await supabase
    .from("essays")
    .select("id, user_id, status")
    .eq("id", essayId)
    .single();

  if (essayErr || !essay) {
    return NextResponse.json({ error: "Essay not found" }, { status: 404 });
  }
  if (essay.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (essay.status !== "refining" && essay.status !== "final") {
    return NextResponse.json(
      { error: `Cannot refine while essay is in status "${essay.status}"` },
      { status: 409 },
    );
  }

  const { data: latest } = await supabase
    .from("essay_drafts")
    .select("version, outline")
    .eq("essay_id", essayId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const { data: draft, error: insertErr } = await supabase
    .from("essay_drafts")
    .insert({
      essay_id: essayId,
      user_id: user.id,
      version: nextVersion,
      // Carry forward the outline from the prior version so students don't lose it.
      outline: latest?.outline ?? "",
      content: content.trim(),
      source: "user",
    })
    .select("*")
    .single();

  if (insertErr || !draft) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to save version" },
      { status: 500 },
    );
  }

  if (markFinal) {
    const nextStatus: EssayStatus = "final";
    const { error: updErr } = await supabase
      .from("essays")
      .update({ status: nextStatus })
      .eq("id", essayId);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ draft: draft as EssayDraft });
}
