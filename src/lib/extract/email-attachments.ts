/**
 * EMAIL ATTACHMENTS AS REAL SOURCES (Phase 3, 2026-11-09).
 *
 * Until now an .eml was read for its body only: attachments arrived as a list
 * of filenames with a note telling the member to add the file again by hand.
 * That meant the most quotable part of an email (the professor's rubric PDF,
 * the problem set, the annotated slides) was unusable.
 *
 * This module decodes the attachments Sophira can already read and turns each
 * one into text through the SAME extractors the upload path uses, so:
 *
 *   - a PDF/PPTX/XLSX/CSV/plain-text attachment is read from the email itself;
 *   - nothing is invented: an unreadable attachment is reported by name and
 *     reason, and the member is told to add it as its own source instead;
 *   - the work is bounded (file count, bytes, characters) so one careless email
 *     cannot exhaust a request;
 *   - every result says where it came from, so a quote can point at the
 *     attachment rather than the message body.
 *
 * MIME parsing here is deliberately small and defensive: it reads parts that
 * declare a filename, decodes base64 only, and never executes or renders
 * anything it finds.
 */

export interface AttachmentDescriptor {
  filename: string;
  mime: string;
  bytes: number | null;
  /** The declared transfer encoding, lowercased. */
  encoding: string;
}

export interface DecodedAttachment extends AttachmentDescriptor {
  data: Buffer | null;
}

export interface ExtractedAttachment {
  filename: string;
  mime: string;
  bytes: number | null;
  /** What kind of content this turned out to be, in plain words. */
  kind: string;
  /** Extracted text, or "" when the file could not be read. */
  text: string;
  /** Plain-English provenance or reason it is empty. */
  note: string;
  /** True when the text came from a real extraction (not a placeholder). */
  extracted: boolean;
}

export interface AttachmentExtraction {
  attachments: ExtractedAttachment[];
  /** Plain-English summary lines for the email's own notes. */
  notes: string[];
}

/** Hard limits: one email must never turn into unbounded work. */
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENT_CHARS = 60_000;
export const MAX_TOTAL_ATTACHMENT_CHARS = 150_000;

/** Extractor dependencies, injected so tests never need pdfjs or a network. */
export interface AttachmentExtractors {
  pdf: (bytes: Buffer) => Promise<{ text: string; note?: string }>;
  pptx: (bytes: Buffer) => Promise<{ text: string; note?: string }>;
  spreadsheet: (bytes: Buffer) => Promise<{ text: string; note?: string }>;
  csv: (text: string) => { text: string; note?: string };
  image: (bytes: Uint8Array, mime: string) => Promise<{ ok: boolean; text: string; notes: string }>;
}

const TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/tab-separated-values",
  "application/json",
  "text/html",
]);

function normalizeMime(mime: string, filename: string): string {
  const declared = (mime || "").split(";")[0].trim().toLowerCase();
  if (declared && declared !== "application/octet-stream") return declared;
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf": return "application/pdf";
    case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "csv": return "text/csv";
    case "txt": return "text/plain";
    case "md": return "text/markdown";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    default: return declared || "application/octet-stream";
  }
}

function decodeFilename(raw: string): string {
  // RFC 2231: filename*=utf-8''lecture%201.pdf
  const encoded = raw.match(/utf-8''([^;\n]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through to the plain value */
    }
  }
  return raw.replace(/^"|"$/g, "").trim();
}

/**
 * Reads the parts of a raw message that declare a filename.
 *
 * Only base64 payloads are decoded. A part with any other encoding is reported
 * with its encoding rather than guessed at, because a half-decoded file would
 * produce text that looks authoritative and is wrong.
 */
export function decodeAttachments(raw: string): { decoded: DecodedAttachment[]; skipped: AttachmentDescriptor[] } {
  const normalised = raw.replace(/\r\n/g, "\n");
  const decoded: DecodedAttachment[] = [];
  const skipped: AttachmentDescriptor[] = [];

  // Part boundaries are the message's own delimiter, not a guess.
  const boundary = normalised.match(/^\s*boundary="?([^";\n]+)"?/im)?.[1];
  const parts = boundary
    ? normalised.split(new RegExp(`\\n--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:--)?\\s*\\n`)).slice(1)
    : normalised.split(/\n--[-=_A-Za-z0-9.]+\n/).slice(1);

  for (const part of parts) {
    const split = part.indexOf("\n\n");
    if (split < 0) continue;
    const head = part.slice(0, split);
    const payload = part.slice(split + 2);

    const disposition = head.match(/content-disposition:([^\n]*)/i)?.[1] ?? "";
    if (!/attachment|inline/i.test(disposition)) continue;
    const filenameMatch = disposition.match(/filename\*?=("[^"]+"|[^;\n]+)/i);
    if (!filenameMatch) continue;
    const filename = decodeFilename(filenameMatch[1]);
    if (!filename) continue;

    const mime = normalizeMime(head.match(/content-type:\s*([^\n]+)/i)?.[1] ?? "", filename);
    const encoding = (head.match(/content-transfer-encoding:\s*([^\n]+)/i)?.[1] ?? "").trim().toLowerCase();
    const base64Body = payload.replace(/\s+/g, "");
    const declaredBytes = /base64/i.test(encoding) ? Math.round((base64Body.length * 3) / 4) : null;

    if (!/base64/i.test(encoding)) {
      skipped.push({ filename, mime, bytes: declaredBytes, encoding: encoding || "unknown" });
      continue;
    }
    if (declaredBytes !== null && declaredBytes > MAX_ATTACHMENT_BYTES) {
      skipped.push({ filename, mime, bytes: declaredBytes, encoding: "base64" });
      continue;
    }
    let data: Buffer | null = null;
    try {
      data = Buffer.from(base64Body, "base64");
      if (data.length === 0) data = null;
    } catch {
      data = null;
    }
    if (data) decoded.push({ filename, mime, bytes: data.length, encoding: "base64", data });
    else skipped.push({ filename, mime, bytes: declaredBytes, encoding: "base64" });
  }

  return { decoded: decoded.slice(0, MAX_ATTACHMENTS), skipped };
}

function humanSize(bytes: number | null): string {
  if (bytes === null) return "size unknown";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clip(text: string): { text: string; clipped: boolean } {
  const clean = text.trim();
  if (clean.length <= MAX_ATTACHMENT_CHARS) return { text: clean, clipped: false };
  return { text: clean.slice(0, MAX_ATTACHMENT_CHARS), clipped: true };
}

/** Reads one decoded attachment through the extractor for its type. */
async function readOne(
  att: DecodedAttachment,
  extractors: AttachmentExtractors,
): Promise<ExtractedAttachment> {
  const base = {
    filename: att.filename,
    mime: att.mime,
    bytes: att.bytes,
  };

  if (!att.data) {
    return {
      ...base,
      kind: "unreadable",
      text: "",
      extracted: false,
      note: `“${att.filename}” could not be decoded from the message, so it was not read.`,
    };
  }

  try {
    if (att.mime === "application/pdf") {
      const out = await extractors.pdf(att.data);
      const { text, clipped } = clip(out.text);
      return {
        ...base,
        kind: "PDF",
        text,
        extracted: text.length > 0,
        note: text.length === 0
          ? `“${att.filename}” (PDF, ${humanSize(att.bytes)}) contained no selectable text${out.note ? `: ${out.note}` : ""}. If the pages are scans, add the file itself as a source so OCR can run on it.`
          : `“${att.filename}” (PDF, ${humanSize(att.bytes)}): read ${text.length.toLocaleString()} characters${clipped ? `, the first ${MAX_ATTACHMENT_CHARS.toLocaleString()} kept` : ""}.${out.note ? ` ${out.note}` : ""}`,
      };
    }

    if (att.mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation") {
      const out = await extractors.pptx(att.data);
      const { text, clipped } = clip(out.text);
      return {
        ...base,
        kind: "slides",
        text,
        extracted: text.length > 0,
        note: text.length === 0
          ? `“${att.filename}” (slides) had no readable text.`
          : `“${att.filename}” (slides, ${humanSize(att.bytes)}): read ${text.length.toLocaleString()} characters${clipped ? ", truncated" : ""}.${out.note ? ` ${out.note}` : ""}`,
      };
    }

    if (
      att.mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      att.mime === "application/vnd.ms-excel"
    ) {
      const out = await extractors.spreadsheet(att.data);
      const { text, clipped } = clip(out.text);
      return {
        ...base,
        kind: "spreadsheet",
        text,
        extracted: text.length > 0,
        note: text.length === 0
          ? `“${att.filename}” (spreadsheet) had no readable cells.`
          : `“${att.filename}” (spreadsheet, ${humanSize(att.bytes)}): read ${text.length.toLocaleString()} characters${clipped ? ", truncated" : ""}.${out.note ? ` ${out.note}` : ""}`,
      };
    }

    if (att.mime.startsWith("image/")) {
      const out = await extractors.image(att.data, att.mime);
      const { text, clipped } = clip(out.text);
      return {
        ...base,
        kind: "image",
        text,
        extracted: out.ok && text.length > 0,
        note: out.ok && text.length > 0
          ? `“${att.filename}” (image, ${humanSize(att.bytes)}): text recognised${clipped ? ", truncated" : ""}. ${out.notes}`.trim()
          : `“${att.filename}” (image, ${humanSize(att.bytes)}) could not be read as text: ${out.notes || "no text found"}. Add the image itself as a source if you need to quote it.`,
      };
    }

    if (TEXT_MIMES.has(att.mime) || att.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const asText = att.data.toString("utf8");
      if (att.mime === "text/csv") {
        const out = extractors.csv(asText);
        const { text, clipped } = clip(out.text);
        return {
          ...base,
          kind: "CSV",
          text,
          extracted: text.length > 0,
          note: `“${att.filename}” (CSV, ${humanSize(att.bytes)}): read ${text.length.toLocaleString()} characters${clipped ? ", truncated" : ""}.${out.note ? ` ${out.note}` : ""}`,
        };
      }
      if (att.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        // A .docx is a zip, not text: reading it as UTF-8 would produce noise.
        return {
          ...base,
          kind: "document",
          text: "",
          extracted: false,
          note: `“${att.filename}” is a Word document. Sophira reads Word files when they are added as their own source, so add the file itself to quote from it.`,
        };
      }
      const { text, clipped } = clip(asText);
      return {
        ...base,
        kind: att.mime === "text/html" ? "HTML text" : "text",
        text,
        extracted: text.length > 0,
        note: `“${att.filename}” (${att.mime}, ${humanSize(att.bytes)}): read ${text.length.toLocaleString()} characters${clipped ? ", truncated" : ""}.`,
      };
    }

    return {
      ...base,
      kind: "unsupported",
      text: "",
      extracted: false,
      note: `“${att.filename}” is ${att.mime}, which Sophira does not read from inside an email. Add the file itself as a source if you need to quote it.`,
    };
  } catch (err) {
    return {
      ...base,
      kind: "failed",
      text: "",
      extracted: false,
      note: `“${att.filename}” could not be read (${err instanceof Error ? err.message : "unknown error"}). Add the file itself as a source if you need to quote it.`,
    };
  }
}

/**
 * Extracts text from every readable attachment in a raw message.
 *
 * Returns the per-attachment results plus summary lines the email source can
 * carry, so the member sees exactly what was read and what was not.
 */
export async function extractEmailAttachments(
  raw: string,
  extractors: AttachmentExtractors,
): Promise<AttachmentExtraction> {
  const { decoded, skipped } = decodeAttachments(raw);
  const notes: string[] = [];

  const attachments: ExtractedAttachment[] = [];
  for (const att of decoded) {
    attachments.push(await readOne(att, extractors));
  }

  for (const s of skipped) {
    const tooBig = s.bytes !== null && s.bytes > MAX_ATTACHMENT_BYTES;
    attachments.push({
      filename: s.filename,
      mime: s.mime,
      bytes: s.bytes,
      kind: "skipped",
      text: "",
      extracted: false,
      note: tooBig
        ? `“${s.filename}” (${humanSize(s.bytes)}) is larger than the ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB limit for reading inside an email. Add the file itself as a source.`
        : `“${s.filename}” was not read because its transfer encoding (${s.encoding}) is not base64, and guessing at it could produce wrong text. Add the file itself as a source.`,
    });
  }

  const read = attachments.filter((a) => a.extracted);
  if (attachments.length > 0) {
    notes.push(
      read.length > 0
        ? `Read ${read.length} attachment${read.length === 1 ? "" : "s"} from the email itself: ${read.map((a) => a.filename).join(", ")}. Quoted text from them is marked by file name.`
        : `The email had ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}, none of which could be read. Each one is named below with the reason.`,
    );
  }

  // Bound the total so a mail with several long attachments stays usable.
  let budget = MAX_TOTAL_ATTACHMENT_CHARS;
  for (const att of attachments) {
    if (!att.text) continue;
    if (att.text.length > budget) {
      att.text = att.text.slice(0, Math.max(0, budget));
      att.note += " Cut short so the source stays within the size limit.";
    }
    budget -= att.text.length;
  }

  return { attachments, notes };
}

/**
 * Renders the extracted attachments into the source text.
 *
 * Headings name the file, so a citation can point at the attachment rather than
 * the message body, and unreadable files are stated rather than omitted.
 */
export function renderAttachments(attachments: ExtractedAttachment[]): string {
  if (attachments.length === 0) return "";
  const blocks: string[] = [];
  attachments.forEach((att, i) => {
    blocks.push(
      [
        `[Attachment ${i + 1}: ${att.filename} (${att.kind}${att.bytes !== null ? `, ${humanSize(att.bytes)}` : ""})]`,
        att.note,
        att.text ? att.text : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  });
  return blocks.join("\n\n");
}
