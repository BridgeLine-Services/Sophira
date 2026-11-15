/**
 * DOCUMENTS AND MULTIMEDIA (directive 2026-11-15, Part 9).
 *
 * Part 9 asks that a student be able to put the things their assignment actually rests on
 * - a PDF the teacher handed out, a Word document they wrote, a scanned page, a recorded
 * lecture - into the research pipeline alongside web sources. Before this round the
 * pipeline only ever saw web pages: `fetchAndVerify` takes a URL and nothing else.
 *
 * WHAT THIS IS
 *  - A dependency-free text extractor for PDF and DOCX, plus plain text, Markdown, HTML
 *    and RTF. No new package, no new service, nothing to configure.
 *  - An honest account of what could NOT be read. A scanned PDF has no text layer; an
 *    audio file has no text at all. Both are reported as such, with what is needed to
 *    finish the job. Neither is ever reported as "no content" or as extracted text that
 *    was invented.
 *
 * WHAT THIS IS NOT
 *  - It is not an OCR engine and not a transcriber. Seeing a scan or a recording and
 *    saying "this needs OCR" is the honest report; pretending to read pixels would be a
 *    lie the student would carry into their bibliography.
 *  - It does not trust the document. Extracted text is data. Any instruction that
 *    appears inside an uploaded file is content to be quoted, never obeyed.
 */

import { inflateRawSync, inflateSync } from "zlib";

export type DocumentKind =
  | "pdf"
  | "docx"
  | "html"
  | "markdown"
  | "text"
  | "rtf"
  | "audio"
  | "image"
  | "unknown";

export type ExtractionStatus =
  /** Text was read out of the file. */
  | "extracted"
  /** The file was read and genuinely contains no text (e.g. a blank page). */
  | "empty"
  /** An image-based document: pixels, no text layer. Needs OCR, which is not wired. */
  | "needs_ocr"
  /** A recording: no text. Needs transcription, which is not wired. */
  | "needs_transcription"
  /** A format Sophira does not read. */
  | "unsupported"
  /** Readable format, unreadable bytes. */
  | "corrupt";

export interface DocumentMetadata {
  title: string | null;
  author: string | null;
  pageCount: number | null;
}

export interface DocumentExtraction {
  kind: DocumentKind;
  filename: string;
  status: ExtractionStatus;
  /** Normalised text, empty unless status is "extracted". */
  text: string;
  charCount: number;
  /** Page count when the file states one; never a guess from character count. */
  pageCount: number | null;
  metadata: DocumentMetadata;
  /** Plain-language notes for the student. No engineering vocabulary. */
  notes: string[];
  /** True only when there is text a citation could quote. */
  quotable: boolean;
}

/* ------------------------------------------------------------------ */
/* Detection                                                           */
/* ------------------------------------------------------------------ */

function startsWithBytes(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) if (bytes[offset + i] !== sig[i]) return false;
  return true;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i]);
  return out;
}

/**
 * Identifies a file by what is inside it, not by what it is called. A .pdf that is really
 * a photo is treated as a photo, because the bytes are the only thing that cannot lie.
 */
export function detectDocumentKind(bytes: Uint8Array, filename = ""): DocumentKind {
  const lower = filename.toLowerCase();

  if (startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    // A zip. A .docx is a zip whose entries include word/.
    return "docx";
  }
  if (startsWithBytes(bytes, [0x49, 0x44, 0x33])) return "audio"; // ID3 (mp3)
  if (startsWithBytes(bytes, [0x4f, 0x67, 0x67, 0x53])) return "audio"; // OggS
  if (startsWithBytes(bytes, [0x66, 0x4c, 0x61, 0x43])) return "audio"; // fLaC
  if (startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && ascii(bytes, 8, 4) === "WAVE") return "audio";
  if (ascii(bytes, 4, 4) === "ftyp") return "audio"; // m4a/mp4 container
  if (startsWithBytes(bytes, [0xff, 0xfb]) || startsWithBytes(bytes, [0xff, 0xf3])) return "audio";

  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "image"; // JPEG
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image"; // PNG
  if (startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38])) return "image"; // GIF
  if (startsWithBytes(bytes, [0x42, 0x4d])) return "image"; // BMP
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image";

  if (lower.endsWith(".rtf") || ascii(bytes, 0, 5) === "{\\rtf") return "rtf";

  const head = ascii(bytes, 0, 1024).toLowerCase();
  if (head.includes("<!doctype html") || head.includes("<html")) return "html";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".txt") || lower.endsWith(".csv") || lower.endsWith(".tex")) return "text";

  // Last resort: is it readable text at all?
  const sample = bytes.subarray(0, Math.min(bytes.length, 2048));
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return "unknown";
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  if (sample.length && control / sample.length < 0.02) return "text";
  return "unknown";
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&#39;": "'",
  "&nbsp;": " ",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => XML_ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

/** One whitespace convention everywhere, so character counts mean something. */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

/** Decodes a PDF literal string: \( \) \\ \n \r \t \b \f \ooo. */
function decodePdfString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (next === undefined) break;
    if (next === "n") { out += "\n"; i += 1; continue; }
    if (next === "r") { out += "\n"; i += 1; continue; }
    if (next === "t") { out += " "; i += 1; continue; }
    if (next === "b" || next === "f") { i += 1; continue; }
    if (next === "(" || next === ")" || next === "\\") { out += next; i += 1; continue; }
    if (/[0-7]/.test(next)) {
      let octal = "";
      let j = i + 1;
      while (j < raw.length && octal.length < 3 && /[0-7]/.test(raw[j])) {
        octal += raw[j];
        j += 1;
      }
      out += String.fromCharCode(parseInt(octal, 8));
      i = j - 1;
      continue;
    }
    if (next === "\n") { i += 1; continue; }
    out += next;
    i += 1;
  }
  return out;
}

/** Decodes a PDF hex string <48656c6c6f>. */
function decodePdfHex(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  let out = "";
  for (let i = 0; i + 1 < clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

interface PdfScan {
  text: string;
  streams: number;
  decodedStreams: number;
  imageOnly: boolean;
  encrypted: boolean;
}

/**
 * Reads the text-showing operators out of every content stream it can decode.
 *
 * This is deliberately narrow. A PDF stores text as positioning plus `Tj`/`TJ` operators in
 * streams that are usually Flate-compressed. Reading those operators recovers the text of a
 * born-digital document, which is the case that matters for an assignment. Text drawn as an
 * image cannot be recovered this way, and that is what `imageOnly` reports.
 */
export function scanPdf(bytes: Uint8Array): PdfScan {
  const raw = latin1(bytes);
  const encrypted = /\/Encrypt\b/.test(raw);
  let text = "";
  let streams = 0;
  let decodedStreams = 0;
  let sawImage = false;

  let cursor = 0;
  while (cursor < raw.length) {
    const streamAt = raw.indexOf("stream", cursor);
    if (streamAt === -1) break;
    // The dictionary immediately before the keyword says how the bytes are encoded.
    const dictStart = Math.max(0, streamAt - 1200);
    const dict = raw.slice(dictStart, streamAt);
    let dataStart = streamAt + 6;
    if (raw[dataStart] === "\r") dataStart += 1;
    if (raw[dataStart] === "\n") dataStart += 1;
    const endAt = raw.indexOf("endstream", dataStart);
    if (endAt === -1) break;
    streams += 1;
    if (/\/Subtype\s*\/Image\b/.test(dict)) sawImage = true;

    const slice = bytes.subarray(dataStart, endAt);
    let decoded: string | null = null;
    if (/\/FlateDecode\b/.test(dict)) {
      try {
        decoded = latin1(inflateSync(slice));
        decodedStreams += 1;
      } catch {
        decoded = null;
      }
    } else if (!/\/Filter\b/.test(dict)) {
      decoded = latin1(slice);
      decodedStreams += 1;
    }

    if (decoded) {
      const pieces: string[] = [];
      const showText = /\(((?:\\.|[^\\()])*)\)\s*(?:Tj|'|")/g;
      let m: RegExpExecArray | null;
      while ((m = showText.exec(decoded)) !== null) pieces.push(decodePdfString(m[1]));
      const showArray = /\[((?:[^\][\\]|\\.)*)\]\s*TJ/g;
      while ((m = showArray.exec(decoded)) !== null) {
        const inner = m[1];
        const parts: string[] = [];
        const str = /\(((?:\\.|[^\\()])*)\)/g;
        let s: RegExpExecArray | null;
        while ((s = str.exec(inner)) !== null) parts.push(decodePdfString(s[1]));
        const hex = /<([0-9a-fA-F\s]+)>/g;
        let h: RegExpExecArray | null;
        while ((h = hex.exec(inner)) !== null) parts.push(decodePdfHex(h[1]));
        if (parts.length) pieces.push(parts.join(""));
      }
      const hexShow = /<([0-9a-fA-F\s]+)>\s*Tj/g;
      while ((m = hexShow.exec(decoded)) !== null) pieces.push(decodePdfHex(m[1]));
      if (pieces.length) text += `${pieces.join(" ")}\n`;
    }

    cursor = endAt + 9;
  }

  return { text: normalizeExtractedText(text), streams, decodedStreams, imageOnly: sawImage && !text.trim(), encrypted };
}

function pdfPageCount(bytes: Uint8Array): number | null {
  const raw = latin1(bytes.subarray(0, Math.min(bytes.length, 4_000_000)));
  const counts = [...raw.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  if (!counts.length) return null;
  const max = Math.max(...counts);
  return Number.isFinite(max) && max > 0 ? max : null;
}

/* ------------------------------------------------------------------ */
/* ZIP (DOCX) - read without a dependency                              */
/* ------------------------------------------------------------------ */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  // The end-of-central-directory record sits at the end; scan backwards for its signature.
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 66_000);
  for (let i = bytes.length - 22; i >= floor; i -= 1) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(eocd + 10, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  let at = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (bytes[at] !== 0x50 || bytes[at + 1] !== 0x4b || bytes[at + 2] !== 0x01 || bytes[at + 3] !== 0x02) break;
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    entries.push({ name: ascii(bytes, at + 46, nameLength), method, compressedSize, localOffset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(bytes: Uint8Array, entry: ZipEntry): Buffer | null {
  const at = entry.localOffset;
  if (bytes[at] !== 0x50 || bytes[at + 1] !== 0x4b || bytes[at + 2] !== 0x03 || bytes[at + 3] !== 0x04) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  const dataStart = at + 30 + nameLength + extraLength;
  const data = bytes.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) {
    try {
      return inflateRawSync(data);
    } catch {
      return null;
    }
  }
  return null;
}

export function extractDocxText(bytes: Uint8Array): { text: string; title: string | null; author: string | null } | null {
  const entries = readZipEntries(bytes);
  if (!entries.length) return null;
  const doc = entries.find((e) => e.name === "word/document.xml");
  if (!doc) return null;
  const xml = readZipEntry(bytes, doc);
  if (!xml) return null;

  const source = xml.toString("utf8");
  // Paragraphs become lines; tabs and breaks become spaces. Runs (w:t) are joined in order.
  const paragraphs = source.split(/<\/w:p>/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const runs = [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decodeEntities(m[1]));
    const line = normalizeExtractedText(runs.join("")).replace(/\n/g, " ");
    if (line) lines.push(line);
  }

  let title: string | null = null;
  let author: string | null = null;
  const core = entries.find((e) => e.name === "docProps/core.xml");
  if (core) {
    const coreXml = readZipEntry(bytes, core)?.toString("utf8") ?? "";
    title = /<dc:title>([\s\S]*?)<\/dc:title>/.exec(coreXml)?.[1]?.trim() || null;
    author = /<dc:creator>([\s\S]*?)<\/dc:creator>/.exec(coreXml)?.[1]?.trim() || null;
    if (title) title = decodeEntities(title);
    if (author) author = decodeEntities(author);
  }

  return { text: normalizeExtractedText(lines.join("\n")), title, author };
}

/* ------------------------------------------------------------------ */
/* HTML, RTF, plain text                                              */
/* ------------------------------------------------------------------ */

export function extractHtmlText(html: string): { text: string; title: string | null } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? null;
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return { text: normalizeExtractedText(decodeEntities(stripped)), title: title ? decodeEntities(title) : null };
}

export function extractRtfText(rtf: string): string {
  const body = rtf
    .replace(/\\'([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\{\\\*[\s\S]*?\}/g, " ")
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\[a-z]+-?\d*\s?/gi, " ")
    .replace(/[{}]/g, " ");
  return normalizeExtractedText(body);
}

/* ------------------------------------------------------------------ */
/* The one entry point                                                */
/* ------------------------------------------------------------------ */

export interface ExtractOptions {
  filename?: string;
  /** Stops extraction past this many characters. Protects memory on a huge file. */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 120_000;

/**
 * Reads what it can and says plainly what it could not. Every status is a true statement
 * about the file; none of them is a guess.
 */
export function extractDocument(bytes: Uint8Array, options: ExtractOptions = {}): DocumentExtraction {
  const filename = options.filename ?? "uploaded file";
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const kind = detectDocumentKind(bytes, filename);
  const base: DocumentExtraction = {
    kind,
    filename,
    status: "unsupported",
    text: "",
    charCount: 0,
    pageCount: null,
    metadata: { title: null, author: null, pageCount: null },
    notes: [],
    quotable: false,
  };

  const finish = (partial: Partial<DocumentExtraction>): DocumentExtraction => {
    const merged = { ...base, ...partial };
    const text = partial.text !== undefined ? normalizeExtractedText(partial.text) : "";
    const clipped = text.length > maxChars ? text.slice(0, maxChars) : text;
    const notes = [...merged.notes];
    if (text.length > maxChars) notes.push(`Only the first ${maxChars.toLocaleString()} characters were kept; the file is longer.`);
    return {
      ...merged,
      text: clipped,
      charCount: clipped.length,
      quotable: merged.status === "extracted" && clipped.length > 0,
      notes,
      metadata: { ...merged.metadata, title: merged.metadata.title, author: merged.metadata.author, pageCount: merged.pageCount },
    };
  };

  if (kind === "pdf") {
    const scan = scanPdf(bytes);
    const pages = pdfPageCount(bytes);
    if (scan.encrypted) {
      return finish({
        status: "unsupported",
        notes: ["This file is password-protected, so Sophira could not read it. Open it in a reader and save or print an unlocked copy, then add that."],
        pageCount: pages,
      });
    }
    if (!scan.streams) {
      return finish({
        status: "corrupt",
        notes: ["The file is called a PDF but its contents could not be read. It may be incomplete or damaged."],
      });
    }
    if (!scan.text.trim()) {
      return finish({
        status: scan.imageOnly ? "needs_ocr" : "empty",
        pageCount: pages,
        notes: scan.imageOnly
          ? [
              "This PDF is a scan or a set of images, so it holds no text Sophira can quote. Reading it needs optical character recognition, which is not switched on for this installation.",
              "If you have the original document or a text version, add that instead: a transcript is more reliable to cite than a machine-guessed scan.",
            ]
          : [
              "The file was read successfully and contains no selectable text. If you expected words here, it is probably a scan saved as an image.",
            ],
      });
    }
    return finish({
      status: "extracted",
      text: scan.text,
      pageCount: pages,
      notes: scan.decodedStreams < scan.streams
        ? [`${scan.streams - scan.decodedStreams} of ${scan.streams} sections of this PDF could not be decoded, so some text may be missing.`]
        : [],
    });
  }

  if (kind === "docx") {
    const doc = extractDocxText(bytes);
    if (!doc) {
      return finish({
        status: "corrupt",
        notes: [
          "The file is a zip archive but not a Word document Sophira can read. Only .docx is supported; an older .doc must be saved as .docx or PDF first.",
        ],
      });
    }
    if (!doc.text.trim()) {
      return finish({ status: "empty", metadata: { title: doc.title, author: doc.author, pageCount: null }, notes: ["The document contains no text."] });
    }
    return finish({
      status: "extracted",
      text: doc.text,
      metadata: { title: doc.title, author: doc.author, pageCount: null },
      notes: ["Formatting, images, tables and footnotes are not included: only the words were read."],
    });
  }

  if (kind === "html") {
    const page = extractHtmlText(latin1(bytes));
    if (!page.text.trim()) return finish({ status: "empty", notes: ["The page contains no readable text."] });
    return finish({ status: "extracted", text: page.text, metadata: { title: page.title, author: null, pageCount: null } });
  }

  if (kind === "rtf") {
    const text = extractRtfText(latin1(bytes));
    if (!text.trim()) return finish({ status: "empty", notes: ["The document contains no text."] });
    return finish({ status: "extracted", text });
  }

  if (kind === "text" || kind === "markdown") {
    const text = normalizeExtractedText(latin1(bytes));
    if (!text.trim()) return finish({ status: "empty", notes: ["The file is empty."] });
    return finish({ status: "extracted", text });
  }

  if (kind === "image") {
    return finish({
      status: "needs_ocr",
      notes: [
        "This is a picture, so it contains no text Sophira can quote. Reading it needs optical character recognition, which is not switched on for this installation.",
        "Nothing is guessed from an image: a wrongly guessed word in a quotation would be worse than no quotation.",
      ],
    });
  }

  if (kind === "audio") {
    return finish({
      status: "needs_transcription",
      notes: [
        "This is a recording, so it contains no text. Turning speech into a transcript needs a transcription service, which is not switched on for this installation.",
        "Any notes you already took from the recording can be added as a text document instead.",
      ],
    });
  }

  return finish({
    status: "unsupported",
    notes: ["Sophira reads PDF, Word (.docx), plain text, Markdown, HTML and RTF. This file is something else, so nothing was read from it."],
  });
}

/** A short, honest sentence for a status, for use anywhere the raw status would leak. */
export function extractionMessage(status: ExtractionStatus): string {
  switch (status) {
    case "extracted":
      return "Words were read from this file.";
    case "empty":
      return "The file was read and contains no text.";
    case "needs_ocr":
      return "This file is an image or a scan, so it has no text to quote.";
    case "needs_transcription":
      return "This is a recording, so it has no text until it is transcribed.";
    case "unsupported":
      return "Sophira cannot read this kind of file.";
    case "corrupt":
      return "The file could not be read. It may be damaged or incomplete.";
  }
}
