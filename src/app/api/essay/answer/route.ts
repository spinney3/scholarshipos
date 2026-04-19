import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ESSAY_MODEL, classifyClaudeError, getAnthropic } from "@/lib/anthropic";
import {
  READY_MARKER,
  interviewSystemPrompt,
  turnsToMessages,
} from "@/lib/essayPrompts";
import type { Essay, InterviewTurn } from "@/lib/types";

/**
 * POST /api/essay/answer
 * Body: { essayId: string, answer: string }
 *
 * Appends the student's answer to the interview transcript, then asks
 * Claude for the next question. If Claude emits the READY_TO_DRAFT
 * marker, the essay's status flips to "drafting" and the coach's
 * handoff sentence is stored as the final coach turn.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { essayId?: string; answer?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { essayId, answer } = body;
  if (!essayId || typeof answer !== "string" || !answer.trim()) {
    return NextResponse.json(
      { error: "essayId and non-empty answer are required" },
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
  if (essay.status !== "interviewing") {
    return NextResponse.json(
      { error: `Cannot answer while essay is in status "${essay.status}"` },
      { status: 409 },
    );
  }

  // Guard: the transcript should end with a coach question; otherwise we're
  // accepting an answer to nothing.
  const turns = (essay.interview ?? []) as InterviewTurn[];
  const last = turns[turns.length - 1];
  if (!last || last.role !== "coach") {
    return NextResponse.json(
      { error: "No pending question to answer" },
      { status: 409 },
    );
  }

  const appended: InterviewTurn[] = [
    ...turns,
    { role: "student", content: answer.trim() },
  ];

  // Call Claude for the next question.
  let coachText: string;
  try {
    const anthropic = getAnthropic();
    const msg = await anthropic.messages.create({
      model: ESSAY_MODEL,
      max_tokens: 500,
      system: interviewSystemPrompt(essay.prompt),
      messages: turnsToMessages(appended),
    });
    coachText = msg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (e) {
    const c = classifyClaudeError(e);
    return NextResponse.json(
      { error: c.message, code: c.code },
      { status: c.status },
    );
  }

  if (!coachText) {
    return NextResponse.json(
      { error: "Coach returned empty response" },
      { status: 502 },
    );
  }

  const isDone = coachText.includes(READY_MARKER);
  const coachTurn: InterviewTurn = {
    role: "coach",
    content: coachText.replace(READY_MARKER, "").trim() || "Ready to draft.",
  };
  const finalTurns = [...appended, coachTurn];

  const { data: updated, error: updErr } = await supabase
    .from("essays")
    .update({
      interview: finalTurns,
      status: isDone ? "drafting" : "interviewing",
    })
    .eq("id", essayId)
    .select("*")
    .single();

  if (updErr || !updated) {
    return NextResponse.json(
      { error: updErr?.message ?? "Failed to persist turn" },
      { status: 500 },
    );
  }

  return NextResponse.json({ essay: updated as Essay, done: isDone });
}
