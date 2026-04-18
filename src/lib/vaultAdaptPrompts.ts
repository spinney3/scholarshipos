import type {
  AdaptationGuidance,
  VaultEssay,
  VaultPromptType,
} from "./types";
import { VAULT_PROMPT_TYPE_LABELS } from "./types";

/**
 * Prompts used when a student asks Claude how to adapt a past vault essay
 * to a new scholarship prompt.
 *
 * Design note (per project brief): this is NOT a rewriter. Claude must
 * not produce polished replacement prose — that's the "AI slop" path
 * that gets essays flagged. Claude gives *guidance* in Socratic form:
 * what to keep, what to rewrite (and why), what new questions to
 * answer. The student still writes the actual new essay.
 */

export function adaptSystemPrompt(): string {
  return `You are a thoughtful college counselor helping a high school student REUSE one of their past scholarship essays for a new prompt.

Strict ground rules:
- Do NOT rewrite the essay. Do NOT produce polished replacement prose. Do NOT generate sample paragraphs or "here's a possible opening."
- Your job is to help the student see (a) what from the old essay is still usable, (b) what needs to change and why, and (c) what new material they'll need to surface for the new prompt.
- In the "rewrite" section, describe WHAT needs to change and WHY, and ask a Socratic question about HOW — do not rewrite it for them.
- "new_angles" must be questions the student can answer, not suggestions of things for them to claim.
- Never invent facts about the student. Only reason from what's in their essay.

Respond with a single JSON object inside a \`\`\`json fenced code block, matching this exact shape:

\`\`\`json
{
  "summary": "One short paragraph on how the old essay relates to the new prompt and whether it's a strong starting point (2-4 sentences).",
  "keep": [
    "Specific passage, beat, or detail that still works (1 sentence each). Quote 3-8 words from the essay where helpful.",
    "..."
  ],
  "rewrite": [
    {
      "what": "Name the passage or beat that needs to change",
      "why": "Why it doesn't fit the new prompt",
      "how": "A Socratic question the student should answer to rewrite it in their own words"
    }
  ],
  "new_angles": [
    "A question the student should answer to surface material the old essay didn't cover but the new prompt asks for"
  ]
}
\`\`\`

Output ONLY that fenced block. No prose before or after.`;
}

export function adaptUserMessage(
  oldEssay: VaultEssay,
  newPrompt: { prompt_type: VaultPromptType; prompt_text: string },
): string {
  return `PAST ESSAY
Prompt type: ${VAULT_PROMPT_TYPE_LABELS[oldEssay.prompt_type]}
Original prompt:
"""
${oldEssay.prompt_text || "(no prompt recorded)"}
"""
Essay content:
"""
${oldEssay.content}
"""

NEW PROMPT
Prompt type: ${VAULT_PROMPT_TYPE_LABELS[newPrompt.prompt_type]}
Prompt text:
"""
${newPrompt.prompt_text}
"""

Produce the JSON adaptation guidance per the system rules.`;
}

/**
 * Extract the fenced JSON block from the adaptation response and validate
 * its shape. Throws with an informative message on malformed output so
 * the API route can surface a retryable error.
 */
export function parseAdaptationResponse(text: string): AdaptationGuidance {
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text.match(/\{[\s\S]*\}/)?.[0];
  if (!raw) {
    throw new Error("Adaptation response did not contain a JSON object");
  }
  const parsed = JSON.parse(raw);

  if (
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.keep) ||
    !Array.isArray(parsed.rewrite) ||
    !Array.isArray(parsed.new_angles)
  ) {
    throw new Error("Adaptation JSON missing required top-level fields");
  }

  const keep: string[] = parsed.keep.filter(
    (v: unknown): v is string => typeof v === "string",
  );
  const new_angles: string[] = parsed.new_angles.filter(
    (v: unknown): v is string => typeof v === "string",
  );
  const rewrite = parsed.rewrite
    .filter(
      (r: unknown): r is { what: string; why: string; how: string } =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as { what: unknown }).what === "string" &&
        typeof (r as { why: unknown }).why === "string" &&
        typeof (r as { how: unknown }).how === "string",
    )
    .map((r: { what: string; why: string; how: string }) => ({
      what: r.what,
      why: r.why,
      how: r.how,
    }));

  return {
    summary: parsed.summary,
    keep,
    rewrite,
    new_angles,
  };
}
