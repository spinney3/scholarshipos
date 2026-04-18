import type { InterviewTurn } from "./types";
import { INTERVIEW_MIN_QUESTIONS, INTERVIEW_TARGET_QUESTIONS } from "./types";

/**
 * Marker the coach emits when it has gathered enough material to draft.
 * The frontend uses presence of this marker to flip into the drafting phase.
 */
export const READY_MARKER = "[READY_TO_DRAFT]";

/**
 * System prompt for the Socratic interviewer.
 *
 * Design notes:
 * - We tell Claude explicitly NOT to write the essay or suggest content —
 *   that prevents the "AI slop" problem flagged in the project brief.
 * - We require ONE question at a time, no preambles, so the UI can render
 *   each question cleanly.
 * - We bound the interview length and give the model a clear stopping
 *   signal (READY_MARKER) so the frontend can transition phases.
 */
export function interviewSystemPrompt(scholarshipPrompt: string): string {
  return `You are a thoughtful, warm high school college counselor coaching a student who is about to write a scholarship essay.

The scholarship's essay prompt is:
"""
${scholarshipPrompt}
"""

Your only job right now is to conduct a Socratic interview that surfaces the student's *own* specific, lived material — concrete moments, sensory details, names, numbers, what they actually said and did and felt. Later, a separate step will help them shape this into a draft. Do NOT write the essay, suggest sentences, or summarize their answers back to them in polished prose.

Rules:
- Ask exactly ONE question per turn. No preamble, no bullet lists, no meta-commentary about your process.
- Each question should drill into a specific moment or detail — not "what are you passionate about" but "tell me about the specific day you decided to start the tutoring program."
- Build on the previous answer. Reference what they just said.
- Aim for ${INTERVIEW_MIN_QUESTIONS}–${INTERVIEW_TARGET_QUESTIONS} questions total. Once you have enough vivid, specific material to draft from, respond with exactly:

${READY_MARKER}
<one short sentence handing off to the drafting step, e.g. "Great — I have what I need. Let's turn this into a draft.">

Do not emit ${READY_MARKER} before at least ${INTERVIEW_MIN_QUESTIONS} substantive student answers.`;
}

/**
 * Convert our stored interview transcript into Anthropic Messages format.
 * Coach turns -> assistant, student turns -> user. We prepend a synthetic
 * "begin" user message so the conversation always starts with `user`,
 * which the Messages API requires.
 */
export function turnsToMessages(turns: InterviewTurn[]): {
  role: "user" | "assistant";
  content: string;
}[] {
  const msgs: { role: "user" | "assistant"; content: string }[] = [
    {
      role: "user",
      content:
        "Please begin the interview. Ask me your first question about my experience relevant to this scholarship prompt.",
    },
  ];
  for (const t of turns) {
    msgs.push({
      role: t.role === "coach" ? "assistant" : "user",
      content: t.content,
    });
  }
  return msgs;
}

/**
 * System prompt for first-draft generation.
 *
 * The most important constraint here is "do not invent details." Without
 * this, models cheerfully fabricate names, dates, and incidents — exactly
 * the failure mode that gets essays flagged.
 */
export function draftSystemPrompt(scholarshipPrompt: string): string {
  return `You are an essay coach helping a high school student turn their interview answers into a scholarship essay first draft.

The scholarship's essay prompt is:
"""
${scholarshipPrompt}
"""

You will receive the full Socratic interview transcript (your questions and the student's answers).

Strict rules:
- Use ONLY material the student actually said. Do not invent names, places, dates, dialogue, statistics, feelings, or events. If a detail is missing, leave it out rather than fabricate.
- Write in first person ("I"), in the student's voice. Match the register of their answers — if they spoke plainly, write plainly. Do not over-polish into generic college-essay voice.
- Keep their phrasings and word choices where possible. The point is to organize *their* words, not replace them.
- Aim for ~450–550 words.

Respond with a single JSON object inside a \`\`\`json fenced code block, with this exact shape:

\`\`\`json
{
  "outline": "A short bulleted outline as a single string with newline-separated bullets, e.g. \\"- Hook: ...\\\\n- Anecdote: ...\\\\n- Reflection: ...\\\\n- Tie-back to prompt: ...\\"",
  "draft": "The full first-person draft as a single string with paragraph breaks as \\\\n\\\\n."
}
\`\`\`

Output ONLY that fenced block. No prose before or after.`;
}

/**
 * User message for the drafting call: hands Claude the transcript.
 */
export function draftUserMessage(turns: InterviewTurn[]): string {
  const transcript = turns
    .map(
      (t, i) =>
        `${t.role === "coach" ? "Coach" : "Student"} (turn ${i + 1}):\n${t.content}`,
    )
    .join("\n\n");
  return `Here is the full interview transcript:\n\n${transcript}\n\nNow produce the JSON outline and first draft per the instructions.`;
}

/**
 * Extract the fenced JSON block from a Claude draft response.
 * Throws if not parseable — caller should surface a retry-friendly error.
 */
export function parseDraftResponse(text: string): {
  outline: string;
  draft: string;
} {
  // Try fenced ```json block first; fall back to first {...} block.
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) {
    throw new Error("Draft response did not contain a JSON object");
  }
  const parsed = JSON.parse(raw);
  if (typeof parsed.outline !== "string" || typeof parsed.draft !== "string") {
    throw new Error("Draft JSON missing required fields");
  }
  return { outline: parsed.outline, draft: parsed.draft };
}
