/**
 * POST /api/scholarships/import
 *
 * Student's manual "add a scholarship" entry point. Two modes, selected by
 * the client based on which tab was used:
 *
 *   1. URL mode  — multipart field `mode=url` + `url=<https://...>`. We
 *      fetch the page server-side, strip HTML to text, and hand it to
 *      Claude for single-scholarship extraction.
 *
 *   2. PDF mode  — multipart field `mode=pdf` + `file=<PDF blob>`. We
 *      parse the PDF to text with pdf-parse, then run the same extraction.
 *
 * In both cases we:
 *   - authenticate via the student's Supabase session,
 *   - write the scholarship row with source='user_added' + created_by=user.id
 *     so RLS keeps it private to this student,
 *   - normalize Claude's loose strings (amount, deadline) into the shapes the
 *     scholarships table expects,
 *   - create an application row in 'discovered' so the card lands directly
 *     on the Kanban board.
 *
 * We intentionally do NOT persist the uploaded PDF. Extraction is one-shot:
 * we pull the structured fields we need and discard the bytes. If future
 * work wants to let students re-view the flyer, Supabase Storage is the
 * natural home for it.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyClaudeError } from "@/lib/anthropic";
import { extractOneScholarship } from "@/lib/manual/extractOne";
import { fetchUrlAsText, FetchUrlError } from "@/lib/manual/fetchUrl";
import { parseAmount, parseDeadline } from "@/lib/scraper/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30; // URL fetch + pdf-parse + one Haiku call

const MAX_PDF_BYTES = 5 * 1024 * 1024; // 5MB cap enforced server-side

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

  const mode = form.get("mode");
  if (mode !== "url" && mode !== "pdf") {
    return NextResponse.json(
      { error: "Expected mode=url or mode=pdf." },
      { status: 400 },
    );
  }

  // --- Gather source text -------------------------------------------------
  let sourceText: string;
  let sourceLabel: string;
  let sourceUrl = ""; // stored on the scholarship row; may be empty for PDFs

  try {
    if (mode === "url") {
      const raw = (form.get("url") ?? "").toString();
      const fetched = await fetchUrlAsText(raw);
      sourceText = fetched.text;
      sourceUrl = fetched.url;
      sourceLabel = `Source: pasted URL ${fetched.url}`;
    } else {
      const file = form.get("file");
      if (!(file instanceof Blob)) {
        return NextResponse.json(
          { error: "Please choose a PDF to upload." },
          { status: 400 },
        );
      }
      if (file.size === 0) {
        return NextResponse.json(
          { error: "That PDF is empty." },
          { status: 400 },
        );
      }
      if (file.size > MAX_PDF_BYTES) {
        return NextResponse.json(
          { error: "PDF is too large (5MB max)." },
          { status: 413 },
        );
      }
      // file.type can be missing on mobile uploads — don't enforce strictly,
      // but reject if it's clearly something else.
      if (file.type && !/pdf/i.test(file.type)) {
        return NextResponse.json(
          { error: "Only PDF files are supported on this tab." },
          { status: 400 },
        );
      }

      const buf = Buffer.from(await file.arrayBuffer());
      sourceText = await pdfToText(buf);
      const originalName = file instanceof File ? file.name : "flyer.pdf";
      sourceLabel = `Source: uploaded PDF "${originalName}"`;
    }
  } catch (err) {
    if (err instanceof FetchUrlError) {
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

  if (!sourceText || sourceText.trim().length < 30) {
    return NextResponse.json(
      {
        error:
          "We couldn't pull any readable text out of that source. Try a different URL or upload the PDF manually.",
      },
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
      url: sourceUrl, // empty string for PDF uploads; MatchList hides the link
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
    // Scholarship already saved — we still report success for the scholarship
    // but surface the pipeline error so the UI can prompt the student to
    // retry from /matches.
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

/**
 * Parse a PDF Buffer to plain text. Imported via the deep path
 * `pdf-parse/lib/pdf-parse.js` to skip the package's index.js which runs a
 * self-test against a bundled sample PDF at module-load — that self-test
 * breaks under Next.js's bundler because the sample file isn't included
 * in the serverless function trace. The deep path is the community-standard
 * workaround and pdf-parse's maintainers document it.
 */
async function pdfToText(buf: Buffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as (
    data: Buffer,
  ) => Promise<{ text: string }>;
  const result = await pdfParse(buf);
  return (result.text ?? "").replace(/\s+/g, " ").trim();
}
