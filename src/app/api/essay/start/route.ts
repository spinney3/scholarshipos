import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ESSAY_MODEL, getAnthropic } from "@/lib/anthropic";
import {
  interviewSystemPrompt,
  turnsToMessages,
  READY_MARKER,
} from "@/lib/essayPrompts";
import type { Essay, InterviewTurn } from "@/lib/types";

/**
 * POST /api/essay/start
 * Body: { applicationId: string }
 *
 * Idempotent: if an essay row already exists for this application,
 * returns it as-is. Otherwise creates one, asks Claude for the first
 * Socratic question, persists it, and returns the new essay.
 */
export async function POST(req: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: { applicationId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const applicationId = body.applicationId;
  if (!applicationId) {
    return NextResponse.json(
      { error: "applicationId is required" },
      { status: 400 },
    );
  }

  // Confirm the application belongs to this user and grab the scholarship's prompt.
  const { data: app, error: appErr } = await supabase
    .from("applications")
    .select("id, user_id, scholarship:scholarships(id, title, essay_prompt)")
    .eq("id", applicationId)
    .single();

  if (appErr || !app) {
    return NextResponse.json(
      { error: "Application not found" },
      { status: 404 },
    );
  }
  if (app.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Supabase joins return arrays for related rows; normalize to a single object.
  const scholarship = Array.isArray(app.scholarship)
    ? app.scholarship[0]
    : app.scholarship;
  const prompt =
    scholarship?.essay_prompt ??
    "Tell us about yourself and why this scholarship would matter to you.";

  // Existing essay? Return it untouched.
  const { data: existing } = await supabase
    .from("essays")
    .select("*")
    .eq("application_id", applicationId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ essay: existing as Essay });
  }

  // Ask Claude for the very first question.
  let firstQuestion: string;
  try {
    const anthropic = getAnthropic();
    const msg = await anthropic.messages.create({
      model: ESSAY_MODEL,
      max_tokens: 400,
      system: interviewSystemPrompt(prompt),
      messages: turnsToMessages([]),
    });
    firstQuestion = msg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    if (!firstQuestion || firstQuestion.includes(READY_MARKER)) {
      throw new Error("Coach returned no opening question");
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Claude call failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const initialTurns: InterviewTurn[] = [
    { role: "coach", content: firstQuestion },
  ];

  const { data: created, error: insertErr } = await supabase
    .from("essays")
    .insert({
      application_id: applicationId,
      user_id: user.id,
      prompt,
      interview: initialTurns,
      status: "interviewing",
    })
    .select("*")
    .single();

  if (insertErr || !created) {
    return NextResponse.json(
      { error: insertErr?.message ?? "Failed to create essay" },
      { status: 500 },
    );
  }

  return NextResponse.json({ essay: created as Essay });
}
