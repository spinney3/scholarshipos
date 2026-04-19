import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ESSAY_MODEL, classifyClaudeError, getAnthropic } from "@/lib/anthropic";
import {
  adaptSystemPrompt,
  adaptUserMessage,
  parseAdaptationResponse,
} from "@/lib/vaultAdaptPrompts";
import type { VaultEssay, VaultPromptType } from "@/lib/types";
import { VAULT_PROMPT_TYPE_OPTIONS } from "@/lib/types";

const VALID_TYPES = new Set<VaultPromptType>(
  VAULT_PROMPT_TYPE_OPTIONS.map((o) => o.value),
);

/**
 * POST /api/vault/adapt
 * Body: { essayId: string, prompt_type: VaultPromptType, prompt_text: string }
 *
 * Asks Claude to produce structured adaptation guidance (keep / rewrite /
 * new_angles) for reusing the given past vault essay against a new prompt.
 * Does NOT rewrite the essay — that would violate the project's "coach,
 * not ghostwriter" ethics rule.
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
    essayId?: string;
    prompt_type?: string;
    prompt_text?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.essayId) {
    return NextResponse.json({ error: "essayId is required" }, { status: 400 });
  }
  if (
    typeof body.prompt_type !== "string" ||
    !VALID_TYPES.has(body.prompt_type as VaultPromptType)
  ) {
    return NextResponse.json(
      { error: "prompt_type is required and must be valid" },
      { status: 400 },
    );
  }
  if (typeof body.prompt_text !== "string" || body.prompt_text.trim().length < 10) {
    return NextResponse.json(
      { error: "prompt_text must be at least 10 characters" },
      { status: 400 },
    );
  }

  const { data: essay, error: essayErr } = await supabase
    .from("vault_essays")
    .select("*")
    .eq("id", body.essayId)
    .single();

  if (essayErr || !essay) {
    return NextResponse.json({ error: "Essay not found" }, { status: 404 });
  }
  if (essay.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const oldEssay = essay as VaultEssay;
  if (oldEssay.content.trim().length === 0) {
    return NextResponse.json(
      { error: "Cannot adapt an empty essay" },
      { status: 409 },
    );
  }

  try {
    const anthropic = getAnthropic();
    const msg = await anthropic.messages.create({
      model: ESSAY_MODEL,
      max_tokens: 1500,
      system: adaptSystemPrompt(),
      messages: [
        {
          role: "user",
          content: adaptUserMessage(oldEssay, {
            prompt_type: body.prompt_type as VaultPromptType,
            prompt_text: body.prompt_text,
          }),
        },
      ],
    });
    const text = msg.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");
    const guidance = parseAdaptationResponse(text);
    return NextResponse.json({ guidance });
  } catch (e) {
    const c = classifyClaudeError(e);
    return NextResponse.json(
      { error: c.message, code: c.code },
      { status: c.status },
    );
  }
}
