import { decodeHtmlEntities } from "../text/entities";

/**
 * Email-as-source extraction (Phase 3, pure - no network, no mailbox provider).
 *
 * The problem this solves: teachers and tutors send the material that actually
 * matters by email. Until now a student had to copy it out by hand. This module
 * turns an exported message (.eml) or a pasted email into clean source text.
 *
 * The rules that keep it honest:
 *  - QUOTED REPLIES AND SIGNATURES ARE REMOVED, because a five-message thread
 *    would otherwise repeat the same instructions and inflate every citation.
 *    What was removed is reported in words, never hidden.
 *  - ATTACHMENTS ARE NAMED, NOT INVENTED. An attachment's contents are not in
 *    the message body, so it is listed with its filename and the student is told
 *    to add the file itself. Nothing pretends to have read it.
 *  - A BODY WITH NOTHING NEW SAYS SO. If stripping leaves no new text, the source
 *    is reported as empty rather than storing a thread with no substance.
 *  - NOTHING HERE DECODES UNTRUSTED CONTENT AGGRESSIVELY: base64 parts are only
 *    decoded for the selected text part, and an undecodable body degrades to a
 *    plain note instead of a guess.
 */

export interface ParsedEmail {
  from: string;
  to: string;
  cc: string;
  subject: string;
  /** ISO date when the header parsed, else null. */
  sentAt: string | null;
  messageId: string;
  body: string;
  /** True when the body had to be recovered from an HTML part. */
  htmlRecovered: boolean;
  attachments: { filename: string; mime: string; bytes: number | null }[];
  notes: string[];
}

export interface EmailThreadStripResult {
  text: string;
  removedQuotedChars: number;
  removedSignature: boolean;
  /** Plain-English description of what was trimmed. */
  note: string;
}

const MAX_BODY_CHARS = 120_000;

/**
 * Entity decoding now lives in src/lib/text/entities.ts as a SINGLE-PASS
 * decoder. The old chain of .replace() calls decoded its own output, so
 * "&amp;lt;script&amp;gt;" became live-looking markup (CodeQL #48).
 */
function decodeEntitiesBasic(input: string): string {
  return decodeHtmlEntities(input);
}

/** Minimal HTML to text, enough for an email body. */
export function emailHtmlToText(html: string): string {
  let out = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<h([1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  out = decodeEntitiesBasic(out);
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits a raw .eml into headers and a body, tolerating folded headers. */
export function splitEml(raw: string): { headers: Record<string, string>; body: string; contentType: string } {
  const normalized = raw.replace(/\r\n/g, "\n");
  const sepIndex = normalized.indexOf("\n\n");
  const headerBlock = sepIndex === -1 ? normalized : normalized.slice(0, sepIndex);
  const body = sepIndex === -1 ? "" : normalized.slice(sepIndex + 2);

  const unfolded = headerBlock.replace(/\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!headers[key]) headers[key] = value;
  }
  return { headers, body, contentType: headers["content-type"] ?? "text/plain" };
}

function decodeQuotedPrintable(input: string): string {
  return input
    .replace(/=\n/g, "")
    .replace(/=([0-9A-F]{2})/gi, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function decodeBase64Utf8(input: string): string {
  try {
    const cleaned = input.replace(/\s+/g, "");
    return Buffer.from(cleaned, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/** Picks the best text part from a simple (possibly single-part) message. */
function selectBody(raw: string, headers: Record<string, string>): { body: string; htmlRecovered: boolean; notes: string[] } {
  const notes: string[] = [];
  const ctype = (headers["content-type"] ?? "text/plain").toLowerCase();
  const encoding = (headers["content-transfer-encoding"] ?? "").toLowerCase();
  const { body: rawBody } = splitEml(raw);

  let text = rawBody;
  if (encoding.includes("quoted-printable")) text = decodeQuotedPrintable(rawBody);

  if (ctype.includes("multipart/")) {
    // Take the first plain part; fall back to the first HTML part.
    const parts = text.split(/\n--[-=_A-Za-z0-9.]+/);
    const plainPart = parts.find((p) => /content-type:\s*text\/plain/i.test(p));
    const htmlPart = parts.find((p) => /content-type:\s*text\/html/i.test(p));
    if (plainPart) {
      const partBody = plainPart.slice(plainPart.indexOf("\n\n") + 2);
      text = /base64/i.test(plainPart) ? decodeBase64Utf8(partBody) : partBody;
      if (encoding.includes("base64")) text = decodeBase64Utf8(rawBody);
    } else if (htmlPart) {
      const partBody = htmlPart.slice(htmlPart.indexOf("\n\n") + 2);
      const decoded = /base64/i.test(htmlPart) ? decodeBase64Utf8(partBody) : partBody;
      text = emailHtmlToText(decoded);
      notes.push("The message had no plain-text version, so the readable text was recovered from its HTML.");
      return { body: text.slice(0, MAX_BODY_CHARS), htmlRecovered: true, notes };
    } else {
      notes.push("The message is multipart but no readable text part was found, so the body is empty.");
      return { body: "", htmlRecovered: false, notes };
    }
  } else if (encoding.includes("base64")) {
    text = decodeBase64Utf8(rawBody);
    if (!text.trim()) notes.push("The message body was encoded in a way Sophira could not read, so it is empty.");
  }

  if (ctype.includes("text/html")) {
    text = emailHtmlToText(text);
    if (!notes.some((n) => n.includes("HTML"))) {
      notes.push("The message had no plain-text version, so the readable text was recovered from its HTML.");
    }
    return { body: text.slice(0, MAX_BODY_CHARS), htmlRecovered: true, notes };
  }
  return { body: text.slice(0, MAX_BODY_CHARS), htmlRecovered: false, notes };
}

function parseAddressHeader(value: string): string {
  if (!value) return "";
  // "Dana Lee <dana@x.edu>" -> "dana@x.edu"; "dana@x.edu" unchanged.
  const angle = value.match(/<([^>]+)>/);
  if (angle) return angle[1].trim().toLowerCase();
  return value.trim().toLowerCase();
}

function parseDateHeader(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Lists attachments from a raw message without decoding their contents. */
function extractAttachments(raw: string): { filename: string; mime: string; bytes: number | null }[] {
  const out: { filename: string; mime: string; bytes: number | null }[] = [];
  // Headers only: never attempt to decode the payload.
  const headerBlocks = raw.split(/\n--[-=_A-Za-z0-9.]+/).slice(1);
  for (const block of headerBlocks) {
    const head = block.split(/\n\n/)[0] ?? "";
    const disp = head.match(/content-disposition:[^\n]*filename\*?=(?:"([^"]+)"|([^\n;]+))/i);
    if (!disp) continue;
    const filename = (disp[1] ?? disp[2] ?? "").trim().replace(/^utf-8''/i, "");
    if (!filename) continue;
    const mime = (head.match(/content-type:\s*([^;\n]+)/i)?.[1] ?? "application/octet-stream").trim();
    const b64 = block.split(/\n\n/)[1] ?? "";
    const bytes = /base64/i.test(head) ? Math.round((b64.replace(/\s+/g, "").length * 3) / 4) : null;
    out.push({ filename, mime, bytes: bytes && bytes > 0 ? bytes : null });
  }
  return out.slice(0, 20);
}

export function parseEmailSource(raw: string): ParsedEmail {
  const notes: string[] = [];
  const trimmed = raw.replace(/\r\n/g, "\n").trim();
  if (!trimmed) {
    return {
      from: "", to: "", cc: "", subject: "", sentAt: null, messageId: "",
      body: "", htmlRecovered: false, attachments: [],
      notes: ["The message was empty, so there was nothing to read."],
    };
  }

  const looksLikeEml = /^(from|subject|date|to|content-type|mime-version):/im.test(trimmed.slice(0, 2000)) && trimmed.includes("\n");
  if (!looksLikeEml) {
    // A pasted email body: keep the text, do not invent headers.
    return {
      from: "", to: "", cc: "", subject: "", sentAt: null, messageId: "",
      body: trimmed.slice(0, MAX_BODY_CHARS), htmlRecovered: false, attachments: [],
      notes: ["This was treated as pasted email text: there were no message headers, so the sender and subject are unknown."],
    };
  }

  const { headers } = splitEml(trimmed);
  const selected = selectBody(trimmed, headers);
  notes.push(...selected.notes);
  const attachments = extractAttachments(trimmed);
  if (attachments.length > 0) {
    notes.push(
      `${attachments.length} attachment${attachments.length === 1 ? "" : "s"} (${attachments
        .map((a) => a.filename)
        .join(", ")}) — the file contents are not in the message, so add the file itself as a separate source to quote from it.`
    );
  }

  const subject = decodeEntitiesBasic((headers.subject ?? "").replace(/=\?[^?]+\?[Bb]\?([^?]+)\?=/g, (_m, b64) => {
    try {
      return Buffer.from(b64, "base64").toString("utf8");
    } catch {
      return "";
    }
  })).trim();

  return {
    from: parseAddressHeader(headers.from ?? ""),
    to: parseAddressHeader(headers.to ?? ""),
    cc: parseAddressHeader(headers.cc ?? ""),
    subject,
    sentAt: parseDateHeader(headers.date ?? ""),
    messageId: (headers["message-id"] ?? "").trim(),
    body: selected.body,
    htmlRecovered: selected.htmlRecovered,
    attachments,
    notes,
  };
}

/**
 * Removes quoted replies and the signature, because a long thread would
 * otherwise repeat the same instructions on every message.
 */
export function stripEmailThread(text: string): EmailThreadStripResult {
  const original = text ?? "";
  const lines = original.split("\n");
  const kept: string[] = [];
  let removed = 0;
  let signatureCut = false;
  let inQuotedHeaderBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Standard reply separators.
    if (/^-{2,}\s*original message\s*-{2,}$/i.test(trimmed)) {
      removed += lines.slice(i).join("\n").length;
      break;
    }
    if (/^_{5,}$/.test(trimmed)) {
      removed += lines.slice(i).join("\n").length;
      break;
    }
    // "On Mon, 9 Nov 2026 at 10:14, Dana Lee <dana@x.edu> wrote:"
    if (/^on .{5,120}\bwrote:$/i.test(trimmed)) {
      removed += lines.slice(i).join("\n").length;
      break;
    }
    // Outlook style header block: "From: ... Sent: ... To: ... Subject: ..."
    if (/^from:\s/i.test(trimmed) && lines.slice(i, i + 4).some((l) => /^sent:\s/i.test(l.trim()))) {
      inQuotedHeaderBlock = true;
      removed += lines.slice(i).join("\n").length;
      break;
    }
    if (inQuotedHeaderBlock) {
      removed += line.length;
      continue;
    }
    // The canonical signature delimiter.
    if (/^--\s*$/.test(trimmed)) {
      signatureCut = true;
      removed += lines.slice(i).join("\n").length;
      break;
    }
    // A whole quoted line.
    if (/^>/.test(trimmed)) {
      removed += line.length;
      continue;
    }
    kept.push(line);
  }

  const text2 = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const noteParts: string[] = [];
  if (removed > 0) noteParts.push("quoted replies from earlier messages were removed");
  if (signatureCut) noteParts.push("the sender's signature was removed");
  return {
    text: text2,
    removedQuotedChars: removed,
    removedSignature: signatureCut,
    note: noteParts.length > 0 ? noteParts.join(" and ") + "." : "",
  };
}

export type EmailContentVerdict = "ready" | "empty" | "quoted-only" | "attachment-only" | "too-short";

export interface EmailAssessment {
  verdict: EmailContentVerdict;
  memberNote: string;
  wordCount: number;
}

/** Judges what is actually left to quote from a message. */
export function assessEmailContent(input: {
  body: string;
  stripped: EmailThreadStripResult;
  attachments: { filename: string }[];
}): EmailAssessment {
  const words = input.stripped.text.split(/\s+/).filter(Boolean).length;
  if (words === 0) {
    if (input.attachments.length > 0) {
      return {
        verdict: "attachment-only",
        wordCount: 0,
        memberNote: `This message has no text of its own — only ${input.attachments
          .map((a) => a.filename)
          .join(", ")}. Add the attached file as its own source so Sophira can quote it.`,
      };
    }
    if (input.stripped.removedQuotedChars > 0) {
      return {
        verdict: "quoted-only",
        wordCount: 0,
        memberNote: "Everything in this message was a quoted reply to an earlier message, so there is nothing new to quote.",
      };
    }
    return { verdict: "empty", wordCount: 0, memberNote: "This message had no readable text, so nothing was stored from it." };
  }
  if (words < 8) {
    return {
      verdict: "too-short",
      wordCount: words,
      memberNote: `Only ${words} word${words === 1 ? "" : "s"} of new text: saved as-is, but there is very little to quote.`,
    };
  }
  const removedNote = input.stripped.note ? ` ${input.stripped.note.charAt(0).toUpperCase()}${input.stripped.note.slice(1)}` : "";
  return {
    verdict: "ready",
    wordCount: words,
    memberNote: `Read ${words} words of new text.${removedNote}`,
  };
}

export interface EmailSourceInput {
  title: string;
  text: string;
  from: string;
  subject: string;
  sentAt: string | null;
  attachments: { filename: string }[];
  note: string;
}

/** Title and provenance line for the stored source. */
export function emailToSource(input: ParsedEmail, stripped: EmailThreadStripResult): EmailSourceInput {
  const assessment = assessEmailContent({ body: input.body, stripped, attachments: input.attachments });
  const subject = input.subject.trim();
  const title = subject || (input.from ? `Email from ${input.from}` : "Email");
  const provenance = [
    input.from ? `From ${input.from}` : "",
    input.sentAt ? `sent ${input.sentAt.slice(0, 10)}` : "",
    input.attachments.length > 0 ? `${input.attachments.length} attachment(s) not imported` : "",
  ]
    .filter(Boolean)
    .join(", ");
  const note = [assessment.memberNote, provenance, ...input.notes].filter(Boolean).join(" ");
  return {
    title: title.slice(0, 200),
    text: stripped.text,
    from: input.from,
    subject,
    sentAt: input.sentAt,
    attachments: input.attachments,
    note,
  };
}
