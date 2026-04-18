import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ESSAY_MODEL, getAnthropic } from "@/lib/anthropic";
import {
  draftSystemPrompt,
  draftUserMessage,
  parseDraftResponse,
} from "@/lib/essayPrompts";
import type { Essay, EssayDraft, InterviewTurn } from "@/lib/types";

/**
 * POST /api/essay/draft
 * Body: { essayId: string }
 *
 * Generates a first-person outline + draft from the interview transcript.
 * Persists the result as essay_drafts version 1 (or next available version
 * if the student forces a regeneration), and flips the essay into
 * "refining" status so the UI moves to the editor.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { essayId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const essayId = body.essayId;
  if (!essayId) {
    return NextResponse.json(
      { error: "essayId is required" },
      { status: 400 },
    );
  }

  const { data: essay, error: essayErr } = await supabase
    .from("essays")
    .select("*")
    .eq("id", essayId)
    .single();

  if (essayErr || !essay) {
    return NextResponse.json({ error: "Essay not found" }, { status: 404 });
  }
  if (essay.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Allow drafting from "drafting" (normal flow) or "refining" (regenerate).
  if (essay.status === "interviewing") {
    return NextResponse.json(
      { error: "Interview is not complete yet" },
      { status: 409 },
    );
  }

  const turns = (essay.interview ?? []) as InterviewTurn[];
  const studentTurns = turns.filter((t) => t.role === "student");
  if (studentTurns.length === 0) {
    return NextResponse.json(
      { error: "No student answers to draft from" },
      { status: 409 },
    );
  }

  // Call Claude for outline + draft.
  let outline: string;
  let draft: string;
  try {
    const anthropic = getAnthropic();
    const msg = await anthropic.messages.create({
      model: ESSAY_MODEL,
      max_tokens: 3000,
      system: draftSystemPrompt(essay.prompt),
      messages: [{ role: "user", content: draftUserMessage(turns) }],
    });
    const text = msg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = parseDraftResponse(text);
    outline = parsed.outline;
    draft = parsed.draft;
  } catch (e) {
    const message =
      e instanceof Error ? e.message : "Failed to generate draft";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  // Determine next version number for this essay.
  const { data: latest } = await supabase
    .from("essay_drafts")
    .select("version")
    .eq("essay_id", essayId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextVersion = (latest?.version ?? 0) + 1;

  const { data: newDraft, error: insertErr } = await supabase
    .from("essay_drafts")
    .insert({
      essay_id: essayId,
      user_id: user.id,
      version: nextVersion,
      outline,
      content: draft,
      source: "claude",
    })
    .select("*")
    .single();

  if (insertErr || !newDraft) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to save draft" },
      { status: 500 },
    );
  }

  // Move the essay into the editing phase.
  const { data: updatedEssay, error: updErr } = await supabase
    .from("essays")
    .update({ status: "refining" })
    .eq("id", essayId)
    .select("*")
    .single();

  if (updErr || !updatedEssay) {
    return NextResponse.json(
      { error: updErr?.message ?? "Failed to update essay status" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    essay: updatedEssay as Essay,
    draft: newDraft as EssayDraft,
  });
}
