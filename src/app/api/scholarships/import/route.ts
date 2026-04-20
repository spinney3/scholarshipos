/**
 * POST /api/scholarships/import
 *
 * Student's manual "add a scholarship" entry point. Three modes, selected
 * by the client based on which tab was used:
 *
 *   1. URL mode     — multipart field `mode=url` + `url=<https://...>`. We
 *                     fetch the page server-side, strip HTML to text, and
 *                     pass it through the same cleanup + keyword gate as
 *                     uploads before handing it to Claude.
 *
 *   2. Upload mode  — multipart field `mode=upload` + `file=<blob>`. We
 *                     auto-detect PDF / DOCX / TXT from the filename and
 *                     MIME hint, parse with the appropriate library
 *                     (pdf-parse, mammoth, or a native decoder), then run
 *                     the same downstream pipeline.
 *
 *   3. Paste mode   — multipart field `mode=paste` + `text=<raw text>`.
 *                     Student pastes the body of a counselor's email or a
 *                     PTA announcement directly. Cheapest path — no file
 *                     handling, no fetch — and dodges the "scanned PDF
 *                     OCR" failure mode entirely.
 *
 * In all three cases we:
 *   - authenticate via the student's Supabase session,
 *   - route text through src/lib/manual/extractText.ts for whitespace
 *     collapse, page-header dedup, and the scholarship-keyword gate
 *     (short-circuits obvious non-matches BEFORE we burn a Haiku call),
 *   - write the scholarship row with source='user_added' + created_by =
 *     auth.uid() so RLS keeps it private to this student,
 *   - normalize Claude's loose strings (amount, deadline) into the shapes
 *     the scholarships table expects,
 *   - create an application row in 'discovered' so the card lands
 *     directly on the Kanban board.
 *
 * We intentionally do NOT persist the raw upload. Extraction is one-shot:
 * pull the structured fields, discard the bytes. If future work wants to
 * let students re-view the flyer, Supabase Storage is the natural home.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyClaudeError } from "@/lib/anthropic";
import { extractOneScholarship } from "@/lib/manual/extractOne";
import { fetchUrlAsText, FetchUrlError } from "@/lib/manual/fetchUrl";
import { extractFromFile, extractFromPaste, ExtractError } from "@/lib/manual/extractText";
import { parseAmount, parseDeadline } from "@/lib/scraper/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // URL fetch + parse + one Haiku call

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB cap for uploads
const MAX_PASTE_CHARS = 5_000_000; // rough "5MB of text" ceiling for paste mode

type Mode = "url" | "upload" | "paste";

export async function POST(req: NextRequest) {
  // --- Auth ---------------------------------------------------------------
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // --- Parse the form -----------------------------------------------------
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Malformed form submission." },
      { status: 400 },
    );
  }

  const rawMode = (form.get("mode") ?? "").toString();
  if (rawMode !== "url" && rawMode !== "upload" && rawMode !== "paste") {
    return NextResponse.json(
      { error: "Expected mode=url, mode=upload, or mode=paste." },
      { status: 400 },
    );
  }
  const mode = rawMode as Mode;

  // --- Gather source text -------------------------------------------------
  // All three paths converge on a cleaned text blob + a URL string (which
  // may be empty for uploads/paste — MatchList hides the "view source"
  // link when url is empty).
  let sourceText: string;
  let sourceLabel: string;
  let sourceUrl = "";

  try {
    if (mode === "url") {
      const raw = (form.get("url") ?? "").toString();
      const fetched = await fetchUrlAsText(raw);
      // fetchUrlAsText already HTML-stripped. Running it back through the
      // paste-mode path gives us the same whitespace + keyword-gate
      // treatment as uploads — "URL that loads but isn't about a
      // scholarship" is a thing, and we shouldn't pay Claude to discover
      // it.
      const extracted = extractFromPaste(fetched.text);
      sourceText = extracted.text;
      sourceUrl = fetched.url;
      sourceLabel = `Source: pasted URL ${fetched.url}`;
    } else if (mode === "upload") {
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return NextResponse.json(
          { error: "Please choose a file to upload." },
          { status: 400 },
        );
      }
      if (file.size === 0) {
        return NextResponse.json(
          { error: "That file is empty." },
          { status: 400 },
        );
      }
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "File is too large (5MB max)." },
          { status: 413 },
        );
      }

      const bytes = Buffer.from(await file.arrayBuffer());
      const originalName = file instanceof File ? file.name : "upload";
      const mimeHint = file.type ?? "";

      const extracted = await extractFromFile({
        bytes,
        filename: originalName,
        mimeHint,
      });
      sourceText = extracted.text;
      sourceLabel = `Source: uploaded ${extracted.format.toUpperCase()} "${originalName}"`;
    } else {
      const raw = (form.get("text") ?? "").toString();
      if (!raw.trim()) {
        return NextResponse.json(
          { error: "Paste in the scholarship details first." },
          { status: 400 },
        );
      }
      if (raw.length > MAX_PASTE_CHARS) {
        return NextResponse.json(
          { error: "That's a lot of text — trim it down to the scholarship info." },
          { status: 413 },
        );
      }
      const extracted = extractFromPaste(raw);
      sourceText = extracted.text;
      sourceLabel = "Source: pasted text";
    }
  } catch (err) {
    if (err instanceof FetchUrlError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    if (err instanceof ExtractError) {
      // Short, clean 400s with the specific reason — used by the UI to
      // swap in a friendlier message for "not_scholarship" etc.
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Couldn't read that source: ${msg}` },
      { status: 400 },
    );
  }

  // --- Claude extraction --------------------------------------------------
  let extracted;
  try {
    extracted = await extractOneScholarship({
      text: sourceText,
      sourceLabel,
    });
  } catch (err) {
    const c = classifyClaudeError(err);
    return NextResponse.json(
      { error: c.message, code: c.code },
      { status: c.status },
    );
  }

  // --- Normalize into the scholarships schema ----------------------------
  const admin = createAdminClient();
  const amount = parseAmount(extracted.amount);
  const deadline = parseDeadline(extracted.deadline);

  const { data: insertedScholarship, error: insertErr } = await admin
    .from("scholarships")
    .insert({
      title: extracted.title.slice(0, 200),
      provider: extracted.provider.slice(0, 200),
      amount,
      deadline,
      description: extracted.description.slice(0, 500),
      eligibility_summary: extracted.eligibility.slice(0, 500),
      min_gpa: null,
      interests: [],
      // 'national' keeps the matcher from disqualifying user-added rows on
      // ZIP scope. The student is the only one who will ever see this row
      // anyway (RLS), so scope rules are redundant here.
      zip_scope: "national",
      url: sourceUrl, // empty for upload/paste; MatchList hides the link
      essay_prompt: extracted.essay_prompt,
      source: "user_added",
      created_by: user.id,
    })
    .select("id")
    .single();

  if (insertErr || !insertedScholarship) {
    return NextResponse.json(
      { error: `Couldn't save scholarship: ${insertErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // --- Drop it into the student's pipeline at 'discovered' ---------------
  const { error: appErr } = await supabase.from("applications").insert({
    user_id: user.id,
    scholarship_id: insertedScholarship.id,
    status: "discovered",
  });
  if (appErr) {
    // Scholarship already saved — surface the pipeline error so the UI can
    // prompt the student to retry from /matches.
    return NextResponse.json(
      {
        scholarship_id: insertedScholarship.id,
        warning: `Scholarship saved, but couldn't add it to your pipeline: ${appErr.message}. Visit /matches to add it manually.`,
      },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      scholarship_id: insertedScholarship.id,
      title: extracted.title,
      amount,
      deadline,
    },
    { status: 200 },
  );
}
