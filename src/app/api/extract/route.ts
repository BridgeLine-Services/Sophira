import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { readUploadedFile, type Extraction } from "@/lib/extract/read";

export const runtime = "nodejs";

/**
 * POST /api/extract - read an uploaded file into text.
 *
 * 2026-11-15 (directive: provider-key optimisation, part 1): the reading itself moved to
 * `src/lib/extract/read.ts` so the AI-analysis route uses exactly the same extraction
 * instead of a copy. Response fields are unchanged and `provenance` is now also returned
 * (additive): it carries page numbers and, for a scanned PDF, which pages were read from
 * the page images and which still could not be read.
 *
 * A scanned PDF is read by the owner's OWN Tesseract service, never a paid vendor, and
 * only pages with no text layer are sent to it.
 */

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const supabase = createClient();
  // Full authorization chain: authenticated -> ACTIVE access -> own resource.
  // A revoked user must not be able to call account deletion directly.
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const user = guard.data.user;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart file upload." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file was attached." }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: "The attached file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 10 MB — try splitting or compressing it.` }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^\w.\-() ]+/g, "_").slice(0, 120) || "upload";

  let extraction: Extraction;
  try {
    extraction = await readUploadedFile(bytes, { mime: file.type || "", name: file.name });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not read this file." }, { status: 500 });
  }

  if (extraction.confidence === "failed") {
    // Honest failure: tell the user exactly what could not be read. Nothing is invented.
    return NextResponse.json({ error: extraction.notes, data: null }, { status: 415 });
  }

  // Store the original privately in the user's own storage folder.
  let storage_path: string | null = null;
  try {
    const admin = createAdminClient();
    const path = `${user.id}/${Date.now()}-${safeName}`;
    const { error: upErr } = await admin.storage.from("private-docs").upload(path, bytes, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (!upErr) storage_path = path;
  } catch {
    // Storage unavailable — the extraction is still useful; report honestly.
  }

  return NextResponse.json({
    data: {
      file_name: safeName,
      mime_type: file.type || null,
      storage_path,
      extracted_text: extraction.text.slice(0, 60000),
      confidence: extraction.confidence,
      notes: storage_path ? extraction.notes : extraction.notes + " (Note: the original file could not be saved to private storage — extracted text only.)",
      // Additive: page map plus what the scan reader did. Absent for formats without pages.
      ...(extraction.provenance ? { provenance: extraction.provenance } : {}),
    },
  });
}
