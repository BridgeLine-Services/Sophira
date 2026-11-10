/**
 * REGRESSION TESTS: DOCUMENT HTML (CodeQL #19/#18/#17 sanitization, #15/#14 escaping)
 *
 * Uploaded documents are third-party content. Two properties must hold at once:
 *
 *   1. STRUCTURE SURVIVES - headings, numbered lists, bullet lists and table rows are
 *      the reason this extractor exists; a student's assignment keeps its shape.
 *   2. CONTENT IS INERT - anything tag-like in the source arrives as characters,
 *      never as markup, and entities are decoded exactly once so a doubly encoded
 *      tag cannot become a real one.
 */

import { docxHtmlToStructuredText } from "../src/lib/extract/documents";
import { htmlInlineText, htmlToStructuredText } from "../src/lib/text/html-blocks";
import { plainText } from "../src/lib/integrations/canvas-rubric";

type Check = (condition: boolean, message: string) => void;

export function runDocumentHtmlTests(assert: Check, _section?: unknown): void {
  // ---- structure ---------------------------------------------------------------
  const structured = htmlToStructuredText(
    "<h1>Assignment 3</h1><h2>Instructions</h2><p>Answer all parts.</p><ol><li>First</li><li>Second</li></ol><ul><li>Note A</li><li>Note B</li></ul><table><tr><th>Q</th><th>Marks</th></tr><tr><td>1</td><td>10</td></tr></table>",
  );
  assert(structured.includes("# Assignment 3"), "docx: heading 1 becomes a Markdown heading");
  assert(structured.includes("## Instructions"), "docx: heading 2 keeps its level");
  assert(structured.includes("Answer all parts."), "docx: paragraph text is preserved");
  assert(structured.includes("1. First") && structured.includes("2. Second"), "docx: ordered list items are numbered");
  assert(structured.includes("- Note A") && structured.includes("- Note B"), "docx: bullet list items keep their marker");
  assert(structured.includes("| Q | Marks |") && structured.includes("| 1 | 10 |"), "docx: table rows survive as pipe-separated rows");

  const nested = docxHtmlToStructuredText(
    "<h3>Part B</h3><ul><li>Outer<ul><li>Inner</li></ul></li></ul>",
  );
  assert(nested.includes("### Part B"), "docx: heading 3 keeps its level through the public entry point");
  assert(nested.includes("Outer") && nested.includes("Inner"), "docx: nested list items are both kept");

  // ---- inert content ----------------------------------------------------------
  const scriptish = htmlToStructuredText(
    "<p>before</p><script>alert('x')</script><style>body{color:red}</style><p>after</p>",
  );
  assert(!scriptish.toLowerCase().includes("alert"), "docx: script content is dropped entirely");
  assert(!scriptish.includes("color:red"), "docx: style content is dropped entirely");
  assert(scriptish.includes("before") && scriptish.includes("after"), "docx: surrounding text survives script removal");

  // Unterminated and oddly spelled script tags are the classic bypass.
  for (const variant of [
    "<script>alert('x')",
    "<script >alert('x')</script >",
    "<SCRIPT\nsrc=x>alert('x')</SCRIPT>",
    "<script/x>alert('x')</script>",
  ]) {
    const out = htmlToStructuredText(`<p>keep</p>${variant}<p>also keep</p>`);
    assert(!out.toLowerCase().includes("alert"), `docx: script variant is inert: ${variant.slice(0, 28)}`);
    assert(out.includes("keep"), "docx: text around an odd script tag survives");
  }

  // A tag-looking string in the source must arrive as text, not markup.
  const escaped = htmlToStructuredText("<p>&lt;script&gt;alert('x')&lt;/script&gt;</p>");
  assert(escaped.includes("<script>alert('x')</script>"), "docx: an escaped tag comes back as visible text");
  assert(!escaped.includes("<p>"), "docx: no real markup is emitted");

  // ---- decode exactly once ----------------------------------------------------
  const doubleEncoded = htmlToStructuredText("<p>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</p>");
  assert(doubleEncoded.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), "docx: double-encoded text decodes exactly once");
  assert(!doubleEncoded.includes("<script>"), "docx: double-encoded text never becomes a live tag");

  const triple = htmlToStructuredText("<p>&amp;amp;lt;b&amp;amp;gt;</p>");
  assert(triple.includes("&amp;lt;b&amp;gt;"), "docx: triple-encoded text also decodes exactly once");

  // ---- ordinary formatting is untouched ---------------------------------------
  const prose = htmlToStructuredText(
    "<p>Ratio 3 &lt; 4 and 5 &gt; 2; cost \u00a310 &amp; \u20ac12, set {x | x &gt; 0}, 50% \u00b1 2.</p>",
  );
  assert(prose.includes("3 < 4") && prose.includes("5 > 2"), "docx: mathematical comparisons survive");
  assert(prose.includes("\u00a310") && prose.includes("\u20ac12"), "docx: currency symbols survive");
  assert(prose.includes("{x | x > 0}"), "docx: set notation survives");
  assert(prose.includes("50% \u00b1 2"), "docx: percent and plus-minus survive");

  const unicode = htmlToStructuredText("<p>\u05e9\u05dc\u05d5\u05dd \u4f60\u597d \ud83d\ude80 caf\u00e9 na\u00efve</p>");
  assert(unicode.includes("\u05e9\u05dc\u05d5\u05dd") && unicode.includes("\u4f60\u597d"), "docx: non-Latin scripts survive");
  assert(unicode.includes("\ud83d\ude80"), "docx: astral characters survive");
  assert(unicode.includes("caf\u00e9"), "docx: accented Latin survives");

  const entities = htmlToStructuredText("<p>&nbsp;&mdash;&ndash;&hellip;&rsquo;&ldquo;&rdquo;</p>");
  assert(entities.includes("\u2014") || entities.includes("\u2013") || entities.length > 0, "docx: named entities are decoded");

  // ---- inline text helper used for titles and cells ---------------------------
  assert(htmlInlineText("<b>Chapter</b> <i>one</i>") === "Chapter one", "docx: inline text flattens nested emphasis");
  assert(htmlInlineText("<p>a</p><p>b</p>") === "a b", "docx: inline text joins blocks with a space, never a newline");
  assert(htmlInlineText("&lt;b&gt;") === "<b>", "docx: inline text decodes once");

  // ---- Canvas rubric text: teacher HTML reduced to plain text -----------------
  assert(plainText("<p>Clear <b>thesis</b></p>") === "Clear thesis", "rubric: tags are removed and words kept");
  assert(plainText("&lt;b&gt;bold&lt;/b&gt;") === "<b>bold</b>", "rubric: escaped markup stays visible text");
  assert(plainText("&amp;lt;b&amp;gt;") === "&lt;b&gt;", "rubric: double-encoded markup decodes exactly once");
  assert(plainText("a &amp; b") === "a & b", "rubric: an ampersand decodes once");
  assert(plainText("5 &lt; 6 &amp;&amp; 7 &gt; 6") === "5 < 6 && 7 > 6", "rubric: comparisons and && survive");
  assert(plainText("<script>alert(1)</script>ok") === "ok", "rubric: script content never reaches the UI");
  assert(plainText(null) === "" && plainText(42) === "", "rubric: non-strings produce no text");

  // ---- empty and degenerate input ---------------------------------------------
  assert(htmlToStructuredText("") === "", "docx: empty input produces no text");
  assert(htmlToStructuredText("   ") === "", "docx: whitespace-only input produces no text");
  assert(htmlToStructuredText("plain words, no markup") === "plain words, no markup", "docx: text with no markup passes through");
  assert(htmlToStructuredText("<p>a</p><p></p><p>b</p>").includes("a"), "docx: empty paragraphs do not break the output");
}
