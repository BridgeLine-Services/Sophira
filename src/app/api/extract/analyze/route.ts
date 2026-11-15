import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { readUploadedFile } from "@/lib/extract/read";
import { analyzeDocument } from "@/lib/extract/analysis";
import { loadAcademicContext, bounded } from "@/lib/ai/academic-context";
import { documentAnalysisCapability } from "@/lib/capabilities/file-capabilities";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/extract/analyze - look closely at ONE document the student supplied.
 *
 * Directive 2026-11-15, part 3. Three rules shape this route:
 *
 *  1. ONE provider. The model pass goes through the same `aiChat` every other feature
 *     uses, with the same server-side provider plan and fallbacks. There is no second
 *     AI configuration, no separate key, and nothing a student must supply.
 *  2. THE SAME STUDENT. The academic context service supplies course, teacher, approved
 *     preferences and scope-filtered memory, exactly as the tutor and solver paths do.
 *  3. NO PRETENDING. Reading and analysing are separate results. If the reader worked and
 *     the model did not, the text is returned with an honest sentence about the analysis
 *     being unavailable. If the reader failed, nothing is sent to any model at all.
 *
 * Privacy: the file itself stays where it was - only the text Sophira extracted is sent,
 * and only because the student asked for this specific document to be looked at.
 */

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const user = guard.data.user;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Choose a file to look at and try again." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "The attached file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB — try splitting or compressing it.` }, { status: 413 });
  }

  const courseId = String(form.get("course_id") || "").trim() || null;
  const assignmentId = String(form.get("assignment_id") || "").trim() || null;

  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || "upload";

  // 1. Read the file first. If this fails there is nothing to analyse and nothing is sent
  //    to a model - refusing here is what keeps a failure from looking like an analysis.
  const extraction = await readUploadedFile(bytes, { mime: file.type || "", name: file.name });
  const provenance = (extraction.provenance ?? null) as { pages?: { page: number; text: string }[] } | null;

  if (!extraction.text.trim()) {
    return NextResponse.json(
      {
        error: extraction.notes,
        data: {
          file_name: safeName,
          extracted_text: "",
          confidence: extraction.confidence,
          notes: extraction.notes,
          analysis: null,
        },
      },
      { status: 415 }
    );
  }

  // 2. The same academic context every other AI path receives.
  let contextSections: string[] = [];
  try {
    const context = await loadAcademicContext(supabase, user.id, {
      mode: "document_analysis",
      courseId,
      assignmentId,
      isWritingTask: false,
    });
    contextSections = bounded(context.sections);
  } catch {
    // Context is an enhancement, never a blocker: a failed read means a less personal
    // answer, and the analysis still runs on the document itself.
    contextSections = [];
  }

  const outcome = await analyzeDocument({
    filename: safeName,
    text: extraction.text.slice(0, 60000),
    pages: provenance?.pages ?? null,
    contextSections,
    extractionNote: extraction.notes,
  });

  const data = {
    file_name: safeName,
    confidence: extraction.confidence,
    notes: extraction.notes,
    extracted_text: extraction.text.slice(0, 60000),
    provenance,
    analysis: outcome.ok
      ? {
          summary: outcome.summary,
          key_points: outcome.keyPoints,
          terms: outcome.terms,
          quotes: outcome.quotes,
          cautions: outcome.cautions,
          discarded_quotes: outcome.discardedQuotes,
          truncated: outcome.truncated,
          chars_analyzed: outcome.charsAnalyzed,
          where: outcome.where,
          model: outcome.model,
        }
      : null,
    capability: documentAnalysisCapability(),
    text_retained: true,
  };

  if (outcome.ok) return NextResponse.json({ data });

  const status = outcome.reason === "ai_not_configured" ? 503 : outcome.reason === "no_text" ? 415 : 502;
  return NextResponse.json(
    {
      error: outcome.message,
      // The words that WERE read are still returned, so a model failure never costs the
      // student their text.
      data,
    },
    { status }
  );
}
