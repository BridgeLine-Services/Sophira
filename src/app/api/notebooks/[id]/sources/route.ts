import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { fetchAndVerify } from "@/lib/research/verify";
import { hashContent, ingestText, ingestPdf, ingestDocx, ingestImage, ingestWeb } from "@/lib/notebook/ingest";
import type { IngestResult } from "@/lib/notebook/ingest";
import type { NotebookSourceType } from "@/lib/notebook/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/notebooks/:id/sources — add a source.
 *   JSON  { source_type: 'teacher_instructions'|'assignment_instructions'|'user_notes'|'txt', title, text }
 *   JSON  { source_type: 'web_url', url }                     — fetched+verified for real
 *   JSON  { source_type: 'image', title, ocr_text? }          — images need OCR upstream; stored honestly without it
 *   FORM  (multipart) file upload: PDF / DOCX / TXT
 * The API never stores a search snippet as source content; web sources come
 * only from fetchAndVerify (dead URLs are refused).
 */

async function nextSourceId(supabase: Awaited<ReturnType<typeof createClient>>, notebookId: string): Promise<string> {
  const { data } = await supabase
    .from("notebook_sources")
    .select("source_id")
    .eq("notebook_id", notebookId);
  const used = new Set((data ?? []).map((r: { source_id: string }) => r.source_id));
  for (let i = 1; i <= 500; i++) {
    const label = `S${i}`;
    if (!used.has(label)) return label;
  }
  throw new Error("source label space exhausted");
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  const { data: notebook } = await supabase.from("notebooks").select("id").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!notebook) return NextResponse.json({ error: "Notebook not found." }, { status: 404 });

  let ingest: IngestResult;
  let overrideHash = "";

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });
    const name = (form.get("title") as string | null) || file.name || "Untitled";
    const bytes = Buffer.from(await file.arrayBuffer());
    if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
      try {
        const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as
          (b: Buffer) => Promise<{ text: string; numpages: number }>;
        const parsed = await pdfParse(bytes);
        // pdf-parse does not return per-page arrays reliably; split on form
        // feeds when present, else store whole-text with a single locator note.
        const pages = (parsed as unknown as { pages?: string[] }).pages;
        ingest = ingestPdf(name, { text: parsed.text, numpages: parsed.numpages, pages });
      } catch (e) {
        return NextResponse.json({ error: `PDF extraction failed: ${(e as Error).message}` }, { status: 422 });
      }
    } else if (/\.docx$/i.test(name) || file.type.includes("wordprocessingml")) {
      try {
        const mammoth = await import("mammoth");
        const { value: html } = await mammoth.convertToHtml({ buffer: bytes });
        const { docxHtmlToStructuredText } = await import("@/lib/extract/documents");
        ingest = ingestDocx(name, docxHtmlToStructuredText(html));
      } catch (e) {
        return NextResponse.json({ error: `DOCX extraction failed: ${(e as Error).message}` }, { status: 422 });
      }
    } else {
      const text = bytes.toString("utf8");
      ingest = ingestText(name, text, "txt");
    }
    overrideHash = hashContent(bytes.toString("base64").slice(0, 0) + bytes.length + name); // binary identity marker
  } else {
    let body: { source_type?: string; title?: string; text?: string; url?: string; ocr_text?: string | null };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    const type = (body.source_type || "") as NotebookSourceType;
    const title = (body.title || "").trim();
    if (type === "web_url") {
      const url = (body.url || "").trim();
      if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: "Provide a valid http(s) URL." }, { status: 400 });
      try {
        const page = await fetchAndVerify(url, { maxBytes: 2_000_000 });
        if (!page.ok || page.textChars < 400) {
          return NextResponse.json(
            { error: `URL did not retrieve as a readable page (${page.status}); dead or blocked URLs are never stored.`, verification: page.status },
            { status: 422 }
          );
        }
        ingest = ingestWeb({
          title: page.title || title || url,
          canonicalUrl: page.canonicalUrl,
          finalUrl: page.finalUrl,
          contentHash: page.hash,
          retrievedAt: new Date().toISOString(),
          extractedText: page.text,
          verificationStatus: page.status,
          notes: page.notes,
        });
      } catch (e) {
        return NextResponse.json({ error: `Retrieval failed: ${(e as Error).message} — no source was stored.` }, { status: 422 });
      }
    } else if (type === "image") {
      ingest = ingestImage(title || "Uploaded image", body.ocr_text ?? null);
    } else if (type === "teacher_instructions" || type === "assignment_instructions" || type === "user_notes" || type === "txt") {
      if (!body.text || !body.text.trim()) return NextResponse.json({ error: "Paste the text content." }, { status: 400 });
      ingest = ingestText(title || "Untitled note", body.text, type);
    } else {
      return NextResponse.json({ error: `Unsupported source type: ${type || "(missing)"}` }, { status: 400 });
    }
  }

  try {
    const sourceId = await nextSourceId(supabase, id);
    const row = {
      notebook_id: id,
      user_id: user.id,
      source_id: sourceId,
      title: ingest.title,
      source_type: ingest.sourceType,
      original_url: ingest.originalUrl,
      canonical_url: ingest.canonicalUrl,
      content_hash: overrideHash || ingest.contentHash,
      retrieved_at: ingest.retrievedAt,
      extracted_text: ingest.extractedText,
      page_metadata: ingest.pageMetadata,
      section_metadata: ingest.sectionMetadata,
      processing_status: ingest.processingStatus,
      verification_status: ingest.verificationStatus,
      included: true,
      pinned: false,
      retrieval_notes: ingest.notes,
    };
    const { data, error } = await supabase.from("notebook_sources").insert(row).select().single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ source: data, notes: ingest.notes });
  } catch (e) {
    return NextResponse.json({ error: `Could not store the source: ${(e as Error).message}` }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;
  const { data, error } = await supabase
    .from("notebook_sources")
    .select("*")
    .eq("notebook_id", id)
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: "Could not load sources." }, { status: 500 });
  return NextResponse.json({ sources: data ?? [] });
}
