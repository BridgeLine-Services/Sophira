/**
 * PART 9, STAGE TWO: a supplied document actually counts (directive 2026-11-15).
 *
 * Part 9 built document ingestion: a student's PDF or Word file is read, classified and
 * stored as a source. That alone was not enough. Three parts of the pipeline still assumed
 * every source was a web page, and all three failed on a file:
 *
 *   1. `formatCitation` printed `upload://handout.pdf` as if it were a web address, so the
 *      bibliography carried a link no reader could follow.
 *   2. The citation audit re-fetched every cited source over the network at submission time.
 *      A file cannot be fetched, so it came back dead and its claims were downgraded to
 *      unverified - a student's own handout poisoned their integrity report.
 *   3. Integrity checks compared a search-listing title against a page title and looked the
 *      publisher up in a domain registry. Neither means anything for a file.
 *
 * The tests below are the proof that a document now behaves as what it is: a source with real
 * words and no URL. And the honesty is tested in both directions - a document is not assumed
 * acceptable merely because a student chose it.
 */
import {
  UPLOAD_SCHEME,
  isUploadedDocumentUrl,
  uploadedDocumentAuthorityOk,
  uploadedDocumentCitationLabel,
  uploadedDocumentName,
  verifyUploadedDocument,
} from "../src/lib/research/document-source";
import { formatCitation } from "../src/lib/research/citation";
import { readFileSync } from "fs";

type Assert = (condition: boolean, message: string) => void;

const DOC_URL = "upload://teacher%20handout%20on%20rivers.pdf";

export async function runDocumentSourceTests(assert: Assert, section: (name: string) => void) {
  section("documents as sources: a file is recognised, a page is not (Part 9)");

  assert(UPLOAD_SCHEME === "upload://", "source: the scheme is the one the ingest route writes");
  assert(isUploadedDocumentUrl(DOC_URL), "source: a supplied file is recognised");
  assert(isUploadedDocumentUrl("upload://x"), "source: recognition does not depend on the file name");
  assert(!isUploadedDocumentUrl("https://www.reuters.com/a"), "source: an ordinary page is not mistaken for a file");
  assert(!isUploadedDocumentUrl(""), "source: an empty address is not a file");
  assert(!isUploadedDocumentUrl(null), "source: a missing address is not a file");
  assert(!isUploadedDocumentUrl(undefined), "source: an undefined address is not a file");
  assert(uploadedDocumentName(DOC_URL) === "teacher handout on rivers.pdf", "source: the file's name is decoded for display");
  assert(uploadedDocumentName("upload://100%25%20marked.pdf") === "100% marked.pdf", "source: a percent sign in a file name survives");
  assert(uploadedDocumentName("upload://broken%ZZ") === "broken%ZZ", "source: a malformed escape does not throw");
  assert(uploadedDocumentName("https://example.com/x") === "", "source: a web page has no file name");
  assert(uploadedDocumentCitationLabel(DOC_URL).includes("teacher handout on rivers.pdf"), "source: the citation label names the file");
  assert(/supplied by the student/i.test(uploadedDocumentCitationLabel(DOC_URL)), "source: the citation label says who supplied it");

  section("documents as sources: the bibliography carries no fake address (Part 9)");

  const docCitation = formatCitation(
    {
      title: "Rivers of the World",
      author: "A Teacher",
      publisher: null,
      publicationDate: "2026-09-01",
      url: DOC_URL,
      accessedISO: "2026-11-15T12:00:00.000Z",
    },
    "APA",
  );
  assert(!docCitation.includes("upload://"), `citation: no upload address reaches the bibliography (${docCitation})`);
  assert(docCitation.includes("Rivers of the World"), "citation: the title is there");
  assert(docCitation.includes("A Teacher"), "citation: the author is there when known");
  assert(docCitation.includes("teacher handout on rivers.pdf"), "citation: the file is named");
  assert(/Accessed/.test(docCitation), "citation: the access date is kept");

  for (const style of ["MLA", "APA", "CHICAGO", "generic"]) {
    const out = formatCitation(
      { title: "Handout", author: null, publisher: null, publicationDate: null, url: DOC_URL, accessedISO: "2026-11-15T12:00:00.000Z" },
      style,
    );
    assert(!out.includes("upload://"), `citation: ${style} never prints the upload address`);
    assert(out.length > 20, `citation: ${style} produces a real entry`);
  }

  const webCitation = formatCitation(
    {
      title: "Central bank holds rates",
      author: "Jane Doe",
      publisher: "Reuters",
      publicationDate: "2026-03-04",
      url: "https://www.reuters.com/world/europe/rates",
      accessedISO: "2026-11-15T12:00:00.000Z",
    },
    "APA",
  );
  assert(webCitation.includes("https://www.reuters.com"), "citation: an ordinary page keeps its address, unchanged");
  assert(!/Handout supplied/.test(webCitation), "citation: an ordinary page is not described as a handout");

  section("documents as sources: re-checking a file means the stored copy, not the network (Part 9)");

  const good = verifyUploadedDocument({ content_extract: "Rivers carry sediment downstream.", integrity_hash: "abc123" });
  assert(good.status === "verified", "recheck: a file with words in the record is verified");
  assert(good.reachable && good.contentChars > 10, "recheck: the character count comes from the stored copy");
  assert(/not a web page/i.test(good.notes), "recheck: the note says plainly that there is no address to check");
  assert(/matches the file you added/i.test(good.notes), "recheck: the note claims the hash check it actually did");

  const noHash = verifyUploadedDocument({ content_extract: "Words.", integrity_hash: "" });
  assert(noHash.status === "verified" && !/matches the file you added/i.test(noHash.notes), "recheck: without a hash, the note claims less");

  const emptyCopy = verifyUploadedDocument({ content_extract: "   ", integrity_hash: "abc123" });
  assert(emptyCopy.status === "failed", "recheck: a stored copy with no words cannot support a citation");
  assert(!emptyCopy.reachable && emptyCopy.contentChars === 0, "recheck: the failure is reported with what was found");
  assert(/no words/i.test(emptyCopy.notes), "recheck: the failure explains itself");

  section("documents as sources: a file is judged, not assumed good (Part 9)");

  assert(
    uploadedDocumentAuthorityOk({ authority_decision: { source_intelligence: { usable: true } } }),
    "authority: a document the classifier found usable satisfies the requirement",
  );
  assert(
    !uploadedDocumentAuthorityOk({ authority_decision: { source_intelligence: { usable: false } } }),
    "authority: a satire or retracted document does NOT satisfy it",
  );
  assert(!uploadedDocumentAuthorityOk({ authority_decision: null }), "authority: a file with no stored verdict is not trusted");
  assert(!uploadedDocumentAuthorityOk({}), "authority: a source with no decision is not trusted");
  assert(!uploadedDocumentAuthorityOk(null), "authority: a missing source is not trusted");
  assert(
    uploadedDocumentAuthorityOk({ authority_decision: { teacher_required: true } }),
    "authority: a teacher-required source still satisfies the requirement through its stored decision",
  );

  section("documents as sources: the wiring is real (Part 9)");

  const audit = readFileSync("src/app/api/research/audit/route.ts", "utf8");
  assert(/isUploadedDocumentUrl\(url\)/.test(audit), "audit: a supplied file is detected before the network is touched");
  assert(/verifyUploadedDocument\(/.test(audit), "audit: the file is re-checked against the stored copy");
  assert(
    audit.indexOf("isUploadedDocumentUrl(url)") < audit.indexOf("await fetchAndVerify(url"),
    "audit: the document branch comes BEFORE the fetch, so a file is never fetched",
  );
  assert(/integrity_hash, doi, authority_decision/.test(audit), "audit: the stored hash is read, so the unchanged-copy check is real");
  assert(/research_verifications/.test(audit), "audit: the check is recorded like every other verification");

  const solve = readFileSync("src/app/api/ai/solve/route.ts", "utf8");
  assert(/isUploadedDocumentUrl\(r\.url\) \? Boolean\(String\(r\.title/.test(solve), "solve: a file's title check is its own title, not a listing match");
  assert(/uploadedDocumentAuthorityOk\(\{ authority_decision: r\.authority_decision \}\)/.test(solve), "solve: a file's standing comes from its stored classification");
  assert(/authority_decision: \{ teacher_required\?: boolean; source_intelligence\?: \{ usable\?: boolean \} \} \| null;/.test(solve), "solve: the stored decision is in the source type, so it reaches the check");

  const panel = readFileSync("src/components/app/ResearchPanel.tsx", "utf8");
  assert(/isUploadedDocumentUrl\(s\.final_url \|\| s\.original_url\) \? \(/.test(panel), "panel: a supplied file is rendered as a file, not as a link");
  assert(/your file/.test(panel), "panel: the row says it is the student's own file");
  assert(/characters read from the file you supplied/.test(panel), "panel: the meta line does not pretend a file returned an HTTP status");
  assert(/uploadedDocumentName\(s\.final_url \|\| s\.original_url\)/.test(panel), "panel: the file's name is shown when it has no title");

  const citation = readFileSync("src/lib/research/citation.ts", "utf8");
  assert(/isUploadedDocumentUrl\(src\.url\)/.test(citation), "citation: the formatter branches on a supplied file");
  assert(/uploadedDocumentCitationLabel\(src\.url\)/.test(citation), "citation: and uses the one shared label");

  const ingest = readFileSync("src/app/api/research/documents/route.ts", "utf8");
  assert(/source_intelligence: intelligence/.test(ingest), "ingest: the classification stored at upload is the one authority reads");
}
