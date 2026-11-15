import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { extractDocument, extractionMessage, type DocumentExtraction } from "@/lib/research/documents";
import { assessSource, summarizeSourceAssessment } from "@/lib/research/source-intelligence";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * A document the student supplies (directive 2026-11-15, Part 9).
 *
 *   POST /api/research/documents   { filename, content_base64, project_id? }
 *
 * The file is read on the server, the words are extracted, and — when a project is given —
 * the document joins the project's sources exactly like a verified web page, so it can be
 * cited and audited by the same code. Text that could not be read (a scan, a recording) is
 * reported as such and is NEVER stored as an empty source that looks like a dead link.
 *
 * Nothing about the file's contents is trusted as instruction: uploaded text is data.
 */

const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { filename?: string; content_base64?: string; project_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const filename = (body.filename || "").trim();
  const encoded = body.content_base64 || "";
  if (!filename || !encoded) {
    return NextResponse.json({ error: "Choose a file and try again." }, { status: 400 });
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Buffer.from(encoded, "base64"));
  } catch {
    return NextResponse.json({ error: "That file could not be read. Try adding it again." }, { status: 400 });
  }
  if (bytes.length === 0) return NextResponse.json({ error: "That file is empty." }, { status: 400 });
  if (bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: "That file is larger than 12 MB. Add a smaller copy or split it up." }, { status: 413 });
  }

  const extraction: DocumentExtraction = extractDocument(bytes, { filename });

  const projectId = (body.project_id || "").trim();
  const userId = guard.data.user.id;
  let sourceId: string | null = null;

  // Only a file whose words were actually read becomes a source. A scan or a recording is
  // returned to the student with what it needs; storing it as an empty source would create
  // a row that looks like a broken link for the rest of the project.
  if (projectId && extraction.status === "extracted") {
    const { data: project } = await supabase
      .from("research_projects")
      .select("id")
      .eq("id", projectId)
      .maybeSingle();
    if (!project) return NextResponse.json({ error: "Research project not found." }, { status: 404 });

    const intelligence = summarizeSourceAssessment(
      assessSource({
        url: `upload://${encodeURIComponent(filename)}`,
        title: extraction.metadata.title || filename,
        publisher: "uploaded document",
        byline: extraction.metadata.author,
        content: extraction.text.slice(0, 20_000),
      }),
    );

    const notes = [
      `Read from the file "${filename}" that you added.`,
      extractionMessage(extraction.status),
      ...extraction.notes,
    ];
    if (!intelligence.usable && intelligence.blockedReason) {
      notes.push(`Cannot be used as evidence: ${intelligence.blockedReason}`);
    }

    const { data: row, error } = await supabase
      .from("research_sources")
      .insert({
        user_id: userId,
        project_id: projectId,
        original_url: `upload://${encodeURIComponent(filename)}`,
        final_url: "",
        canonical_url: "",
        domain: "uploaded document",
        title: extraction.metadata.title || filename,
        listed_title: filename,
        author: extraction.metadata.author,
        publisher: "Uploaded by the student",
        publication_date: null,
        source_type: "document",
        doi: null,
        http_status: null,
        redirect_count: 0,
        // Read from the student's own file, so the words are certain even though the page
        // it came from is not a web address.
        verification_status: "verified",
        verification_notes: notes.join(" "),
        content_extract: extraction.text.slice(0, 60_000),
        content_chars: extraction.charCount,
        integrity_hash: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
        approval: "pending",
        authority_category: "document",
        authority_decision: { category: "document", tier: 0, tier_name: "Uploaded document", source_intelligence: intelligence, document: { kind: extraction.kind, page_count: extraction.pageCount, char_count: extraction.charCount } },
      })
      .select("id")
      .single();

    if (error) {
      return NextResponse.json({ error: "The file was read, but it could not be added to the project. Try again." }, { status: 500 });
    }
    sourceId = row?.id ?? null;
  }

  return NextResponse.json({
    data: {
      kind: extraction.kind,
      status: extraction.status,
      message: extractionMessage(extraction.status),
      filename: extraction.filename,
      char_count: extraction.charCount,
      page_count: extraction.pageCount,
      quotable: extraction.quotable,
      title: extraction.metadata.title,
      author: extraction.metadata.author,
      notes: extraction.notes,
      // A preview, not the whole document: enough to show the student the words were read.
      preview: extraction.text.slice(0, 600),
      source_id: sourceId,
    },
  });
}
