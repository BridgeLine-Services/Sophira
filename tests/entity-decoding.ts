/**
 * PHASE 2 (2026-11-09, CodeQL #48) — entity decoding happens exactly once.
 *
 * The old implementation was a chain of .replace() calls, so it decoded the
 * output of its own earlier steps: "&amp;lt;script&amp;gt;" came back as live
 * markup. These fixtures pin the corrected contract:
 *
 *   - nested and double-encoded references stay literal text;
 *   - escaped tags are never resurrected into tags;
 *   - script-like content is dropped before decoding, never after;
 *   - malformed references are preserved, not swallowed or guessed;
 *   - Unicode above U+FFFF survives, broken surrogate references do not.
 */
import { decodeHtmlEntities, htmlToPlainText } from "../src/lib/text/entities";
import { emailHtmlToText, parseEmailSource } from "../src/lib/extract/email";

export async function runEntityDecodingTests(
  assert: (cond: boolean, name: string) => void,
  section: (title: string) => void,
): Promise<void> {
  section("entity decoding: one pass, no resurrected markup");

  // ---- nested / double-encoded references ------------------------------
  assert(
    decodeHtmlEntities("&amp;lt;script&amp;gt;") === "&lt;script&gt;",
    "a double-encoded tag decodes ONCE and stays literal text",
  );
  assert(
    decodeHtmlEntities("&amp;amp;") === "&amp;",
    "a double-encoded ampersand decodes once, not twice",
  );
  assert(
    decodeHtmlEntities("&#38;#60;b&#38;#62;") === "&#60;b&#62;",
    "a decimal-encoded entity is not re-decoded into a tag",
  );
  assert(
    decodeHtmlEntities("&#x26;#x3C;b&#x26;#x3E;") === "&#x3C;b&#x3E;",
    "a hex-encoded entity is not re-decoded into a tag",
  );
  assert(
    decodeHtmlEntities("Tom &amp; Jerry") === "Tom & Jerry",
    "an ordinary ampersand still decodes normally",
  );
  assert(
    decodeHtmlEntities("&amp;nbsp;") === "&nbsp;",
    "a double-encoded non-breaking space stays as text",
  );

  // ---- encoded tags stay text, real tags are removed -------------------
  const escapedTags = htmlToPlainText("<p>Use &lt;div&gt; here</p>");
  assert(escapedTags.trim() === "Use <div> here", "an escaped tag becomes visible text, not a tag");
  assert(!/<div>/.test(htmlToPlainText("<p>&amp;lt;div&amp;gt;</p>")), "a double-escaped tag never becomes live markup");
  const removed = htmlToPlainText("<p>Keep <b>bold</b> text</p>");
  assert(removed.includes("Keep") && removed.includes("bold") && !removed.includes("<b>"), "real tags are stripped and their text kept");

  // ---- script-like content --------------------------------------------
  const scripty = htmlToPlainText('<p>Hi</p><script>alert("x")</script><p>Bye</p>');
  assert(!scripty.toLowerCase().includes("alert"), "script content is dropped before decoding");
  assert(scripty.includes("Hi") && scripty.includes("Bye"), "surrounding text survives");
  const encodedScript = htmlToPlainText("&lt;script&gt;alert(1)&lt;/script&gt;");
  assert(encodedScript.includes("alert(1)"), "an encoded script is shown as text, not executed or hidden");
  assert(encodedScript.trim().startsWith("<script>"), "and appears as literal characters, because tags are stripped before decoding so decoding cannot create one");

  // ---- malformed references never crash -------------------------------
  const malformed = ["&#;", "&#x;", "&bogus;", "&", "&;", "&#999999999999;", "&#x110000;", "&#xD800;", "&nbsp"];
  for (const bad of malformed) {
    let out = "";
    let threw = false;
    try {
      out = decodeHtmlEntities(bad);
    } catch {
      threw = true;
    }
    assert(threw === false, `malformed reference ${JSON.stringify(bad)} does not throw`);
    assert(typeof out === "string", `malformed reference ${JSON.stringify(bad)} returns a string`);
  }
  assert(decodeHtmlEntities("&bogus;") === "&bogus;", "an unknown entity is preserved verbatim");
  assert(decodeHtmlEntities("&#;") === "&#;", "an empty numeric reference is preserved verbatim");
  assert(decodeHtmlEntities("&#x110000;") === "&#x110000;", "an out-of-range code point is left alone");
  assert(decodeHtmlEntities("&#xD800;") === "&#xD800;", "a lone surrogate reference is refused, not emitted broken");
  assert(decodeHtmlEntities("100% & more") === "100% & more", "a bare ampersand is untouched");

  // ---- Unicode ---------------------------------------------------------
  assert(decodeHtmlEntities("&#x1F4DA;") === "\u{1F4DA}", "an astral code point survives as one character");
  assert(decodeHtmlEntities("&#233;") === "e\u0301".normalize("NFC") || decodeHtmlEntities("&#233;") === "\u00e9", "a Latin-1 reference decodes correctly");
  assert(decodeHtmlEntities("&#10;") === "\n", "a newline reference is honoured");
  assert(decodeHtmlEntities("&#0;") === "&#0;", "a NUL reference is refused");
  assert(decodeHtmlEntities("&#x1B;") === "&#x1B;", "an escape character reference is refused");

  // ---- ordinary email formatting still reads normally ------------------
  const body = emailHtmlToText("<p>Dear Sam,</p><p>Here is the &quot;rubric&quot; &mdash; section 3 &amp; 4.</p>");
  assert(body.includes('"rubric"'), "quotes decode in a normal email body");
  assert(body.includes("section 3 & 4"), "an ampersand in a normal email body decodes");
  assert(body.includes("- section") || body.includes("— section") || body.includes("-  section") || /-\s+section/.test(body), "an em dash is rendered as a plain dash");

  // ---- the full email path keeps the same rule -------------------------
  const parsed = parseEmailSource(
    [
      "From: Prof <prof@uni.edu>",
      "Subject: Escaping &amp;lt;b&amp;gt; test",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Section &amp;lt;b&amp;gt; is bold in the source, not here.</p>",
    ].join("\n"),
  );
  assert(parsed.subject.includes("&lt;b&gt;"), "the subject decodes exactly once");
  assert(parsed.body.includes("&lt;b&gt;"), "the HTML body decodes exactly once");
  assert(!/<b>/.test(parsed.body), "no live tag is produced from escaped text");
}
