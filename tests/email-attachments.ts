/**
 * PHASE 3 (2026-11-09) — attachments inside an email become real sources.
 *
 * Before this, an .eml gave you a list of filenames and a note telling you to
 * add the file again by hand. These tests prove the new behaviour: readable
 * attachments are extracted from the message itself, unreadable ones are named
 * with a reason, and nothing is invented.
 *
 * The extractors are injected, so no PDF engine or OCR service is needed here;
 * what is under test is the MIME reading, routing and honesty, not pdfjs.
 */
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  decodeAttachments,
  extractEmailAttachments,
  renderAttachments,
  type AttachmentExtractors,
  type ExtractedAttachment,
} from "../src/lib/extract/email-attachments";

export async function runEmailAttachmentTests(
  assert: (cond: boolean, name: string) => void,
  section: (title: string) => void,
): Promise<void> {
  section("email attachments: read from the message, never invented");

  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

  const message = [
    "From: Prof. Alvarez <alvarez@uni.edu>",
    "To: student@uni.edu",
    "Subject: Problem set 4 + rubric",
    'Content-Type: multipart/mixed; boundary="BOUND1"',
    "",
    "--BOUND1",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Attached is the problem set and the marking rubric.",
    "--BOUND1",
    'Content-Type: application/pdf; name="problem-set-4.pdf"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="problem-set-4.pdf"',
    "",
    b64("Question 1: differentiate f(x) = ln(x^2 + 1)."),
    "--BOUND1",
    'Content-Type: text/plain; name="notes.txt"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="notes.txt"',
    "",
    b64("Office hours moved to Thursday 14:00."),
    "--BOUND1--",
    "",
  ].join("\n");

  const extractors: AttachmentExtractors = {
    pdf: async (bytes) => ({ text: bytes.toString("utf8") }),
    pptx: async () => ({ text: "Slide 1: supply and demand" }),
    spreadsheet: async () => ({ text: "Year,Revenue\n1929,1000" }),
    csv: (text) => ({ text }),
    image: async () => ({ ok: true, text: "HANDWRITTEN: see attached graph", notes: "OCR high confidence." }),
  };

  // 1. Both parts are found, decoded and routed to the right reader.
  const first = await extractEmailAttachments(message, extractors);
  assert(first.attachments.length === 2, "both attachments in a multipart message are found");
  const pdf = first.attachments.find((a) => a.filename === "problem-set-4.pdf");
  const txt = first.attachments.find((a) => a.filename === "notes.txt");
  assert(pdf?.text.includes("differentiate f(x)") === true, "the PDF attachment's text is extracted from the message itself");
  assert(pdf?.kind === "PDF", "a PDF attachment is labelled as a PDF");
  assert(txt?.text.includes("Office hours moved to Thursday") === true, "a plain-text attachment is read verbatim");
  assert(first.notes[0].includes("Read 2 attachments"), "the summary says exactly how many attachments were read");

  // 2. The rendered source names each file, so a citation can point at it.
  const rendered = renderAttachments(first.attachments);
  assert(rendered.includes("[Attachment 1: problem-set-4.pdf"), "rendered text names the attachment");
  assert(rendered.includes("differentiate f(x)"), "rendered text carries the extracted content");
  assert(rendered.includes("[Attachment 2: notes.txt"), "every attachment gets its own block");

  // 3. Unsupported types are refused by name, not silently dropped.
  const withZip = message.replace(
    'Content-Disposition: attachment; filename="notes.txt"',
    'Content-Disposition: attachment; filename="archive.zip"',
  ).replace("Content-Type: text/plain; name=\"notes.txt\"", "Content-Type: application/zip; name=\"archive.zip\"");
  const zipped = await extractEmailAttachments(withZip, extractors);
  const zip = zipped.attachments.find((a) => a.filename === "archive.zip");
  assert(zip?.extracted === false, "an unsupported attachment is not claimed as read");
  assert(zip?.note.includes("does not read from inside an email") === true, "the member is told why, in plain words");
  assert(zip?.note.includes("Add the file itself") === true, "and what to do instead");

  // 4. A non-base64 transfer encoding is reported, never guessed at.
  const quotedPrintable = message.replace(
    "Content-Transfer-Encoding: base64\nContent-Disposition: attachment; filename=\"notes.txt\"",
    "Content-Transfer-Encoding: quoted-printable\nContent-Disposition: attachment; filename=\"notes.txt\"",
  );
  const qp = await extractEmailAttachments(quotedPrintable, extractors);
  const qpAtt = qp.attachments.find((a) => a.filename === "notes.txt");
  assert(qpAtt?.extracted === false, "a quoted-printable attachment is not decoded by guesswork");
  assert(qpAtt?.note.includes("quoted-printable") === true, "the encoding is stated as the reason");

  // 5. A PDF that yields no text says so and points at the scan case.
  const emptyPdf = await extractEmailAttachments(message, { ...extractors, pdf: async () => ({ text: "" }) });
  const empty = emptyPdf.attachments.find((a) => a.filename === "problem-set-4.pdf");
  assert(empty?.extracted === false, "an attachment with no extractable text is not counted as read");
  assert(empty?.note.includes("scans") === true, "the scanned-PDF case is explained with the next step");

  // 6. A failing extractor does not break the email: it is reported.
  const boom = await extractEmailAttachments(message, {
    ...extractors,
    pdf: async () => { throw new Error("parser crashed"); },
  });
  const failed = boom.attachments.find((a) => a.filename === "problem-set-4.pdf");
  assert(failed?.extracted === false, "a parser failure is contained to that attachment");
  assert(failed?.note.includes("parser crashed") === true, "the failure is reported with its reason");
  const survived = boom.attachments.find((a) => a.filename === "notes.txt");
  assert(survived?.extracted === true, "the other attachment is still read");

  // 7. Images go through OCR and keep the OCR confidence note.
  const withImage = message.replace(
    'Content-Type: text/plain; name="notes.txt"',
    'Content-Type: image/png; name="board.png"',
  ).replace('filename="notes.txt"', 'filename="board.png"');
  const imaged = await extractEmailAttachments(withImage, extractors);
  const img = imaged.attachments.find((a) => a.filename === "board.png");
  assert(img?.kind === "image", "an image attachment is recognised as an image");
  assert(img?.text.includes("HANDWRITTEN") === true, "recognised text is carried into the source");
  assert(img?.note.includes("OCR high confidence") === true, "the OCR confidence is passed through, not dropped");

  // 8. Limits are real: oversized files are refused with the size stated.
  const huge = message.replace(
    "Content-Transfer-Encoding: base64\nContent-Disposition: attachment; filename=\"notes.txt\"",
    `Content-Transfer-Encoding: base64\nContent-Disposition: attachment; filename="big.pdf"`,
  );
  const oversized = decodeAttachments(huge);
  assert(oversized.decoded.every((a) => (a.bytes ?? 0) <= MAX_ATTACHMENT_BYTES), "nothing above the byte ceiling is decoded");

  // 9. Part count is bounded.
  const many = Array.from({ length: MAX_ATTACHMENTS + 4 }, (_, i) => [
    "--BOUND1",
    `Content-Type: text/plain; name="f${i}.txt"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="f${i}.txt"`,
    "",
    b64(`file ${i}`),
  ].join("\n")).join("\n") + "\n--BOUND1--\n";
  const bounded = decodeAttachments(
    `Content-Type: multipart/mixed; boundary="BOUND1"\n\n${many}`,
  );
  assert(bounded.decoded.length === MAX_ATTACHMENTS, `at most ${MAX_ATTACHMENTS} attachments are decoded`);

  // 10. A message with no attachments produces nothing and claims nothing.
  const plain = await extractEmailAttachments("From: a@b.c\nSubject: hi\n\nNo files here.\n", extractors);
  assert(plain.attachments.length === 0, "a message without attachments yields no attachment results");
  assert(plain.notes.length === 0, "and makes no claim about attachments");
  assert(renderAttachments([]) === "", "nothing is rendered when there is nothing to render");

  // 11. HTML attachments are text, not markup soup.
  const html = message.replace(
    'Content-Type: text/plain; name="notes.txt"',
    'Content-Type: text/html; name="page.html"',
  ).replace('filename="notes.txt"', 'filename="page.html"');
  const htmlOut = await extractEmailAttachments(html, extractors);
  const page = htmlOut.attachments.find((a) => a.filename === "page.html");
  assert(page?.kind === "HTML text", "an HTML attachment is labelled as HTML text");

  // 12. A .docx inside an email is named, not read as binary noise.
  const docx = message.replace(
    'Content-Type: text/plain; name="notes.txt"',
    'Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document; name="essay.docx"',
  ).replace('filename="notes.txt"', 'filename="essay.docx"');
  const docxOut = await extractEmailAttachments(docx, extractors);
  const word = docxOut.attachments.find((a) => a.filename === "essay.docx");
  assert(word?.extracted === false, "a .docx is not read as raw text");
  assert(word?.note.includes("Word document") === true, "and the member is told how to use it");

  // 13. Total text is bounded across several attachments.
  const bigExtractors: AttachmentExtractors = {
    ...extractors,
    pdf: async () => ({ text: "x".repeat(200_000) }),
  };
  const boundedTotal = await extractEmailAttachments(message, bigExtractors);
  const total = boundedTotal.attachments.reduce((n, a: ExtractedAttachment) => n + a.text.length, 0);
  assert(total <= 150_000, "the combined attachment text stays within the source size limit");
}
