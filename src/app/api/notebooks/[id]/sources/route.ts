import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { fetchAndVerify } from "@/lib/research/verify";
import { hashContent, ingestText, ingestPdf, ingestDocx, ingestImage, ingestWeb } from "@/lib/notebook/ingest";
import { emailToSource, parseEmailSource, stripEmailThread } from "@/lib/extract/email";
import { extractEmailAttachments, renderAttachments } from "@/lib/extract/email-attachments";
import { extractPdfText } from "@/lib/extract/pdf";
import { parseCsv, parsePptx, parseSpreadsheet } from "@/lib/extract/documents";
import { ocrImage } from "@/lib/extract/ocr";
import type { IngestResult } from "@/lib/notebook/ingest";
import type { NotebookSourceType } from "@/lib/notebook/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/notebooks/:id/sources — add a source.
 *   JSON  { source_type: 'teacher_instructions'|'assignment_instructions'|'user_notes'|'txt', title, text }
 *   JSON  { source_type: 'web_url', url }                     — fetched+verified for real
 *   JSON  { source_type: 'email', eml }                       — an exported .eml message, or
 *         { source_type: 'email', text, subject?, from?, date? } — pasted email text
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

  // One storage path for every ingestion branch below, so a new source type can
  // never bypass the RLS-scoped insert or the honest processing columns.
  const storeIngest = async (result: IngestResult, hashOverride: string) => {
    try {
      const sourceId = await nextSourceId(supabase, id);
      const row = {
        notebook_id: id,
        user_id: user.id,
        source_id: sourceId,
        title: result.title,
        source_type: result.sourceType,
        original_url: result.originalUrl,
        canonical_url: result.canonicalUrl,
        content_hash: hashOverride || result.contentHash,
        retrieved_at: result.retrievedAt,
        extracted_text: result.extractedText,
        page_metadata: result.pageMetadata,
        section_metadata: result.sectionMetadata,
        processing_status: result.processingStatus,
        verification_status: result.verificationStatus,
        included: true,
        pinned: false,
        retrieval_notes: result.notes,
      };
      const { data, error } = await supabase.from("notebook_sources").insert(row).select().single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ source: data, notes: result.notes });
    } catch (e) {
      return NextResponse.json({ error: `Could not store the source: ${(e as Error).message}` }, { status: 500 });
    }
  };

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided." }, { status: 400 });
    const name = (form.get("title") as string | null) || file.name || "Untitled";
    const bytes = Buffer.from(await file.arrayBuffer());

    // An exported email is a source in its own right: strip the thread and keep
    // only what is new, rather than importing five copies of the same message.
    if (/\.eml$/i.test(name) || file.type === "message/rfc822") {
      const parsed = parseEmailSource(bytes.toString("utf8"));
      const stripped = stripEmailThread(parsed.body);
      const emailSource = emailToSource(parsed, stripped);
      if (!emailSource.text.trim()) {
        return NextResponse.json({ error: emailSource.note || "That email had no readable text." }, { status: 422 });
      }
      ingest = ingestText(emailSource.title, emailSource.text, "user_notes");
      ingest.notes = [emailSource.note];
      return storeIngest(ingest, "");
    }

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
    let body: {
      source_type?: string;
      title?: string;
      text?: string;
      url?: string;
      ocr_text?: string | null;
      eml?: string;
      subject?: string;
      from?: string;
      date?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }
    // "email" is an ingestion path, not a stored source_type: it is stored as
    // user_notes, the closest allowed type, with its provenance in the notes.
    const type = (body.source_type || "") as NotebookSourceType | "email";
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
    } else if (type === "email") {
      const rawEmail = typeof body.eml === "string" && body.eml.trim()
        ? body.eml
        : [
            body.subject ? `Subject: ${body.subject}` : "",
            body.from ? `From: ${body.from}` : "",
            body.date ? `Date: ${body.date}` : "",
            "",
            body.text ?? "",
          ].filter(Boolean).join("\n");
      if (!rawEmail.trim()) {
        return NextResponse.json({ error: "Paste the email text or upload the .eml file." }, { status: 400 });
      }
      const parsed = parseEmailSource(rawEmail);
      const stripped = stripEmailThread(parsed.body);
      const emailSource = emailToSource(parsed, stripped);

      // Attachments are read through the same extractors as uploads. A mail
      // whose body is empty but which carries a readable PDF is still a source.
      const attachmentWork = await extractEmailAttachments(rawEmail, {
        pdf: async (bytes) => {
          const out = await extractPdfText(bytes);
          return { text: out.text, note: out.via === "none" ? "No PDF parser could read this file." : undefined };
        },
        pptx: async (bytes) => {
          const out = await parsePptx(bytes);
          return { text: out.text, note: out.notes || undefined };
        },
        spreadsheet: async (bytes) => {
          const out = await parseSpreadsheet(bytes);
          return { text: out.text, note: out.notes || undefined };
        },
        csv: (text) => {
          const out = parseCsv(text);
          return { text: out.text, note: out.notes || undefined };
        },
        image: async (bytes, mime) => {
          const out = await ocrImage(bytes, mime);
          return { ok: out.ok, text: out.text, notes: out.notes };
        },
      });

      const attachmentText = renderAttachments(attachmentWork.attachments);
      const combined = [emailSource.text.trim(), attachmentText].filter(Boolean).join("\n\n");

      if (!combined.trim()) {
        return NextResponse.json(
          {
            error:
              emailSource.note ||
              attachmentWork.notes[0] ||
              "That email had no readable text.",
          },
          { status: 422 },
        );
      }

      ingest = ingestText(emailSource.title, combined, "user_notes");
      ingest.notes = [emailSource.note, ...attachmentWork.notes].filter(Boolean);
    } else if (type === "image") {
      ingest = ingestImage(title || "Uploaded image", body.ocr_text ?? null);
    } else if (type === "teacher_instructions" || type === "assignment_instructions" || type === "user_notes" || type === "txt") {
      if (!body.text || !body.text.trim()) return NextResponse.json({ error: "Paste the text content." }, { status: 400 });
      ingest = ingestText(title || "Untitled note", body.text, type);
    } else {
      return NextResponse.json({ error: `Unsupported source type: ${type || "(missing)"}` }, { status: 400 });
    }
  }

  return storeIngest(ingest, overrideHash);
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
