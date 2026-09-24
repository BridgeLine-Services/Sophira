import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { aiChat, aiConfigured, parseJsonLoose } from "@/lib/ai/client";

export const runtime = "nodejs";

const MAX_BYTES = 10 * 1024 * 1024;

interface Extraction {
  text: string;
  confidence: "high" | "medium" | "low" | "failed";
  notes: string;
}

async function extractText(bytes: Buffer, mime: string, name: string): Promise<Extraction> {
  const lower = name.toLowerCase();
  if (mime.startsWith("text/") || /\.(txt|md|csv|tex|json)$/.test(lower)) {
    const text = bytes.toString("utf8");
    return { text, confidence: "high", notes: "Plain text file read directly." };
  }

  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    try {
      const pdfParse = (await import("pdf-parse/lib/pdf-parse.js")).default as
        (b: Buffer) => Promise<{ text: string }>;
      const { text } = await pdfParse(bytes);
      const clean = (text || "").trim();
      if (clean.length < 80) {
        return {
          text: clean,
          confidence: "low",
          notes: "This PDF contained very little readable text. It may be a scanned image (no embedded text). Try exporting it as a text-based PDF, take a clear photo of the page, or paste the text.",
        };
      }
      return { text: clean, confidence: "high", notes: "Text extracted from PDF. Layout, tables, and math formatting may be imperfect — please review." };
    } catch {
      return { text: "", confidence: "failed", notes: "This PDF could not be read (it may be corrupted or password-protected). Try a different export or paste the text." };
    }
  }

  if (mime.startsWith("image/")) {
    if (!aiConfigured()) {
      throw new Error("AI vision is not configured, so I can't read text from images yet. Please type or paste the question instead.");
    }
    const dataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
    const raw = await aiChat(
      [
        { role: "system", content: "You transcribe academic documents from photos. Extract ALL visible text, questions, equations, and instructions EXACTLY as shown. Use plain text math notation (x^2, sqrt(x), a/b). HONESTY: if any part is blurry, cut off, or unreadable, list it in 'unreadable' — NEVER guess or fabricate missing text. Respond only with JSON: {\"text\": \"...\", \"confidence\": \"high|medium|low\", \"notes\": \"...\", \"unreadable\": [\"...\"]}" },
        { role: "user", content: "Extract the text from this image.", },
      ],
      { temperature: 0, maxTokens: 3000, jsonMode: true, images: [dataUrl] }
    );
    const parsed = parseJsonLoose<{ text?: string; confidence?: string; notes?: string; unreadable?: string[] }>(raw);
    if (!parsed || typeof parsed.text !== "string" || !parsed.text.trim()) {
      return { text: "", confidence: "failed", notes: "I could not read this image reliably. Please take a clearer photo (more light, no blur, text filling the frame) or type the question." };
    }
    const unread = (parsed.unreadable || []).filter(Boolean);
    const conf = (["high", "medium", "low"] as const).includes(parsed.confidence as "high") ? (parsed.confidence as "high" | "medium" | "low") : "low";
    const notes = [parsed.notes, unread.length ? `Unreadable parts: ${unread.join("; ")}` : null].filter(Boolean).join(" ") || "Transcribed from image.";
    return { text: parsed.text, confidence: unread.length ? (conf === "high" ? "medium" : conf) : conf, notes };
  }

  if (mime.includes("wordprocessingml") || lower.endsWith(".docx")) {
    // DOCX support (spec §11): mammoth converts to HTML, then we preserve
    // document structure (headings, lists, tables) as lightweight Markdown-ish
    // text instead of a wall of prose.
    try {
      const mammoth = await import("mammoth");
      const { value: html } = await mammoth.convertToHtml({ buffer: bytes });
      const text = docxHtmlToStructuredText(html);
      const clean = text.trim();
      if (clean.length < 80) {
        return { text: clean, confidence: "low", notes: "This Word document contained very little text (it may be mostly images). Try a PDF export, a photo of the page, or paste the text." };
      }
      return {
        text: clean,
        confidence: "high",
        notes: "Text extracted from the Word document with headings, lists, and tables preserved where possible. Equations embedded as images could not be read — check any math carefully.",
      };
    } catch {
      return { text: "", confidence: "failed", notes: "This Word document could not be read (it may be corrupted, or an older .doc format — only .docx is supported). Export it as PDF or paste the text." };
    }
  }

  return { text: "", confidence: "failed", notes: `Unsupported file type${mime ? ` (${mime})` : ""}. I can read PDFs, plain text, and images. You can always paste the text instead.` };
}


/**
 * Converts mammoth's HTML output to structured plain text, keeping document
 * structure visible: headings, ordered/unordered lists, and tables
 * (spec §11: "do not reduce every document to an unstructured wall of text").
 */
function docxHtmlToStructuredText(html: string): string {
  const inline = (h: string) =>
    h
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|h1|h2|h3|h4|h5|h6|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

  let out = "";
  // Headings -> Markdown-style #
  out = html.replace(/<h1[^>]*>(.*?)<\/h1>/gis, (_m: string, t: string) => `# ${inline(t)}\n`);
  out = out.replace(/<h2[^>]*>(.*?)<\/h2>/gis, (_m: string, t: string) => `## ${inline(t)}\n`);
  out = out.replace(/<h3[^>]*>(.*?)<\/h3>/gis, (_m: string, t: string) => `### ${inline(t)}\n`);
  out = out.replace(/<h[456][^>]*>(.*?)<\/h[456]>/gis, (_m: string, t: string) => `#### ${inline(t)}\n`);
  // Ordered lists -> numbered lines (preserves question numbering)
  let ol = 1;
  out = out.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gis, (_m: string, body: string) => {
    ol = 1;
    return body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gis, (_l: string, li: string) => `${ol++}. ${inline(li).trim()}\n`);
  });
  out = out.replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gis, (_m: string, body: string) =>
    body.replace(/<li[^>]*>([\s\S]*?)<\/li>/gis, (_l: string, li: string) => `- ${inline(li).trim()}\n`)
  );
  // Tables -> pipe rows
  out = out.replace(/<table[^>]*>([\s\S]*?)<\/table>/gis, (_m: string, body: string) => {
    const rows: string[] = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gis;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(body)) !== null) {
      const cellRe = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gis;
      const cells: string[] = [];
      let c: RegExpExecArray | null;
      while ((c = cellRe.exec(m[1])) !== null) cells.push(inline(c[1]).trim());
      rows.push(`| ${cells.join(" | ")} |`);
    }
    return rows.join("\n") + "\n";
  });

  // Paragraphs and anything left
  out = out.replace(/<p[^>]*>([\s\S]*?)<\/p>/gis, (_m: string, t: string) => `${inline(t).trim()}\n`);
  out = inline(out);
  // collapse 3+ newlines, tidy list numbering artifacts
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

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
    extraction = await extractText(bytes, file.type || "", file.name);
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
    },
  });
}
