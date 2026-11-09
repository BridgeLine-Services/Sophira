import { readFileSync } from "fs";
import path from "path";
import {
  assessEmailContent,
  emailHtmlToText,
  emailToSource,
  parseEmailSource,
  stripEmailThread,
} from "../src/lib/extract/email";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

const EML = [
  "From: Dana Lee <dana.lee@school.edu>",
  "To: student@example.com",
  "Subject: Week 6 - Cell cycle lab report",
  "Date: Mon, 9 Nov 2026 08:15:00 -0800",
  "Message-ID: <abc123@school.edu>",
  "MIME-Version: 1.0",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Hi Sam,",
  "",
  "The lab report is due Friday 13 November by 5pm. Please include the mitosis",
  "phases and a labelled diagram of each stage.",
  "",
  "Thanks,",
  "Dana",
  "-- ",
  "Dana Lee | Biology Department | school.edu",
  "",
  "On Sun, 8 Nov 2026 at 19:02, Sam <student@example.com> wrote:",
  "> When is the lab report due?",
].join("\n");

export async function runEmailSourceTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) {
      passed++;
      console.log("  ✓ " + name);
    } else {
      failed++;
      console.log("  ✗ " + name);
    }
  };
  const section = (name: string) => console.log("\n" + name);

  section("email source: headers are read, not guessed");

  const parsed = parseEmailSource(EML);
  assert(parsed.from === "dana.lee@school.edu", "email: the sender address is read from the header");
  assert(parsed.subject === "Week 6 - Cell cycle lab report", "email: the subject is read");
  assert(parsed.sentAt !== null && parsed.sentAt.startsWith("2026-11-09"), "email: the date header becomes a real timestamp");
  assert(parsed.messageId.includes("abc123"), "email: the message id is kept for provenance");
  assert(parsed.body.includes("due Friday 13 November"), "email: the body text is kept");

  const noHeaders = parseEmailSource("Hey, the essay is due Monday. Thanks!");
  assert(noHeaders.from === "" && noHeaders.subject === "", "email: pasted text with no headers does not invent a sender");
  assert(noHeaders.notes.some((n) => n.includes("no message headers")), "email: pasted text says its headers are unknown");
  assert(noHeaders.body.includes("essay is due Monday"), "email: pasted text is still usable");

  const empty = parseEmailSource("   ");
  assert(empty.notes.some((n) => n.includes("empty")), "email: an empty message is reported as empty, not stored");

  section("email source: quoted replies and signatures are removed");

  const stripped = stripEmailThread(parsed.body);
  assert(stripped.text.includes("due Friday 13 November"), "email: the new content survives stripping");
  assert(!stripped.text.includes("When is the lab report due?"), "email: the quoted earlier message is removed");
  assert(!stripped.text.includes("Biology Department"), "email: the signature block is removed");
  assert(stripped.removedQuotedChars > 0, "email: the removed amount is measured, not assumed");
  assert(stripped.removedSignature, "email: the signature removal is recorded");
  assert(stripped.note.includes("quoted replies") && stripped.note.includes("signature"),
    "email: the member is told exactly what was trimmed");

  const outlook = stripEmailThread(
    ["Please resubmit with the diagram.", "", "-----Original Message-----", "From: student@example.com", "Sent: Sunday", "the diagram is attached"].join("\n")
  );
  assert(outlook.text === "Please resubmit with the diagram.", "email: an Outlook original-message block is cut cleanly");
  assert(!outlook.text.includes("the diagram is attached"), "email: the old message does not leak into the new one");

  const headerBlock = stripEmailThread(["See below.", "", "From: Dana Lee", "Sent: 9 November 2026", "To: Sam", "Subject: lab"].join("\n"));
  assert(headerBlock.text === "See below.", "email: an Outlook header block without the dashes is cut");

  const inlineQuotes = stripEmailThread(["Agreed, Friday works.", "> can we do Friday?", "> yes"].join("\n"));
  assert(inlineQuotes.text === "Agreed, Friday works.", "email: inline quoted lines are removed");
  assert(!inlineQuotes.note.includes("signature"), "email: no signature is claimed when none was found");

  const untouched = stripEmailThread("Just one clean message with no quoting at all.");
  assert(untouched.text === "Just one clean message with no quoting at all." && untouched.note === "",
    "email: a clean message is left exactly as it is, with no note");

  section("email source: html-only messages are recovered and said so");

  const html = emailHtmlToText("<html><head><style>p{color:red}</style></head><body><h1>Essay plan</h1><p>Use three sources.</p><ul><li>intro</li><li>body</li></ul><script>alert(1)</script></body></html>");
  assert(html.includes("Essay plan"), "email: headings survive html conversion");
  assert(html.includes("- intro"), "email: list items become readable bullets");
  assert(!html.includes("color:red") && !html.includes("alert"), "email: styles and scripts are stripped");

  const htmlEml = [
    "From: tutor@school.edu",
    "Subject: Rubric",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>The rubric weights argument at <b>60%</b>.</p>",
  ].join("\n");
  const htmlParsed = parseEmailSource(htmlEml);
  assert(htmlParsed.htmlRecovered, "email: an html-only message is flagged as recovered from html");
  assert(htmlParsed.body.includes("60%"), "email: the html body text is usable");
  assert(htmlParsed.notes.some((n) => n.includes("HTML")), "email: the member is told the text came from html");

  section("email source: attachments are named, never read");

  const withAttachment = [
    "From: dana@school.edu",
    "Subject: Handout",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="BOUND"',
    "",
    "--BOUND",
    "Content-Type: text/plain",
    "",
    "Handout attached for Thursday.",
    "--BOUND",
    'Content-Disposition: attachment; filename="week6.pdf"',
    "Content-Type: application/pdf",
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERi0xLjQK",
    "--BOUND--",
  ].join("\n");
  const attParsed = parseEmailSource(withAttachment);
  assert(attParsed.attachments.length === 1, "email: one attachment is detected");
  assert(attParsed.attachments[0].filename === "week6.pdf", "email: the attachment filename is reported");
  assert(attParsed.notes.some((n) => n.includes("week6.pdf")), "email: the attachment is named in the notes");
  assert(attParsed.notes.some((n) => n.includes("not in the message")), "email: it says attachment contents were not read");
  assert(!attParsed.body.includes("JVBERi0"), "email: attachment bytes never become source text");

  section("email source: content verdicts are honest");

  const ready = assessEmailContent({ body: parsed.body, stripped, attachments: [] });
  assert(ready.verdict === "ready" && ready.wordCount > 8, "email: a real message is ready with a real word count");
  assert(ready.memberNote.includes("words of new text"), "email: the member sees how much text was read");

  const onlyQuoted = assessEmailContent({
    body: "> old\n> older",
    stripped: stripEmailThread("> old\n> older"),
    attachments: [],
  });
  assert(onlyQuoted.verdict === "quoted-only", "email: a reply with nothing new is called quoted-only");
  assert(onlyQuoted.memberNote.includes("nothing new"), "email: quoted-only is explained in plain words");

  const attachmentOnly = assessEmailContent({
    body: "",
    stripped: stripEmailThread(""),
    attachments: [{ filename: "notes.docx" }],
  });
  assert(attachmentOnly.verdict === "attachment-only", "email: an attachment-only message is distinguished");
  assert(attachmentOnly.memberNote.includes("notes.docx"), "email: the file to add is named explicitly");

  const short = assessEmailContent({ body: "ok thanks", stripped: stripEmailThread("ok thanks"), attachments: [] });
  assert(short.verdict === "too-short", "email: a two-word reply is called too short to quote");

  section("email source: title and provenance");

  const source = emailToSource(parsed, stripped);
  assert(source.title === "Week 6 - Cell cycle lab report", "email: the subject becomes the source title");
  assert(source.note.includes("dana.lee@school.edu"), "email: the sender is recorded in the provenance note");
  assert(source.note.includes("2026-11-09"), "email: the sent date is recorded");
  const untitled = emailToSource({ ...parsed, subject: "" }, stripped);
  assert(untitled.title.startsWith("Email from dana.lee@school.edu"), "email: a message with no subject gets an honest fallback title");
  const longSubject = emailToSource({ ...parsed, subject: "x".repeat(400) }, stripped);
  assert(longSubject.title.length === 200, "email: an enormous subject is capped");

  section("email source: route integration");

  const routeSrc = read("src/app/api/notebooks/[id]/sources/route.ts");
  assert(routeSrc.includes("parseEmailSource("), "email route: the tested parser is used, not a copy");
  assert(routeSrc.includes("stripEmailThread("), "email route: threads are stripped before storing");
  assert(routeSrc.includes('type === "email"'), "email route: an email can be ingested as JSON");
  assert(routeSrc.includes("message/rfc822"), "email route: an exported .eml file is accepted");
  assert(routeSrc.includes("const storeIngest = async"), "email route: every ingestion path shares one storage step");
  assert(routeSrc.includes('"user_notes"'), "email route: stored under an allowed source type, not an invented one");
  assert(routeSrc.includes("if (!emailSource.text.trim())"), "email route: an empty email is refused instead of stored");
  assert(read("src/lib/extract/email.ts").includes("Buffer.from"), "email: decoding is server-side only");
  assert(!routeSrc.includes("console.log(body"), "email route: message content is never logged");

  return { passed, failed };
}
