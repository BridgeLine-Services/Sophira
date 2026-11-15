/**
 * A DOCUMENT THE STUDENT SUPPLIED, seen by the rest of the research pipeline (Part 9).
 *
 * An uploaded file is a real source with real words, but it is not a web page, and three
 * parts of the pipeline assumed every source was one:
 *
 *   1. The citation formatter printed `upload://handout.pdf` as if it were a web address.
 *   2. The citation audit re-fetched every cited source over the network at submission
 *      time, so a document came back "dead" and its claims were downgraded to unverified.
 *   3. Integrity checks compared a search-listing title against a page title and looked the
 *      publisher up in a domain registry - neither of which means anything for a file the
 *      student chose from their own computer.
 *
 * Everything here answers one question honestly: "is this source a file, and if so, what is
 * the true thing to say about it?" No network, no guessing, no fake URL.
 */

/** Every supplied document's stored address starts with this scheme. */
export const UPLOAD_SCHEME = "upload://";

/** True when this source is a file the student supplied rather than a page on the web. */
export function isUploadedDocumentUrl(url: string | null | undefined): boolean {
  return typeof url === "string" && url.startsWith(UPLOAD_SCHEME);
}

/** The file's name, decoded, for anything that needs to show it. Never a URL. */
export function uploadedDocumentName(url: string | null | undefined): string {
  if (!isUploadedDocumentUrl(url)) return "";
  const raw = String(url).slice(UPLOAD_SCHEME.length);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * What a bibliography says about a supplied file. A bare `upload://` address is not
 * something a reader could follow, so the honest entry names the file and says who supplied
 * it. Nothing about a publisher, a date or a retrieval URL is invented.
 */
export function uploadedDocumentCitationLabel(url: string | null | undefined): string {
  const name = uploadedDocumentName(url);
  return name ? `Handout supplied by the student (${name})` : "Document supplied by the student";
}

/**
 * Whether a supplied document may stand as evidence for a claim.
 *
 * The decision was already made when the file was read: the Part 5 classifier stored its
 * verdict as `source_intelligence`. A satire PDF or a retracted paper is refused here for the
 * same reason a web page is refused. A file with no stored verdict is treated as NOT
 * satisfying an authority requirement - the pipeline never assumes a document is acceptable
 * merely because a student chose it.
 */
export function uploadedDocumentAuthorityOk(source: { authority_decision?: unknown } | null | undefined): boolean {
  const decision = source?.authority_decision as
    | { teacher_required?: boolean; source_intelligence?: { usable?: boolean } }
    | null
    | undefined;
  if (!decision) return false;
  if (decision.teacher_required === true) return true;
  return decision.source_intelligence?.usable === true;
}

/**
 * The result of re-checking a supplied document at submission time.
 *
 * A file cannot be re-fetched, so "is it still live?" is the wrong question. The question that
 * can be answered truthfully is: is the copy Sophira read still in the record, and does it
 * still carry words? That is what this returns, and its note says exactly that.
 */
export function verifyUploadedDocument(source: { content_extract?: unknown; integrity_hash?: unknown }): {
  status: "verified" | "failed";
  reachable: boolean;
  contentChars: number;
  notes: string;
} {
  const text = typeof source?.content_extract === "string" ? source.content_extract : "";
  const hash = typeof source?.integrity_hash === "string" ? source.integrity_hash : "";
  const chars = text.trim().length;
  if (chars === 0) {
    return {
      status: "failed",
      reachable: false,
      contentChars: 0,
      notes: "The stored copy of this file has no words in it, so it cannot support a citation.",
    };
  }
  return {
    status: "verified",
    reachable: true,
    contentChars: chars,
    notes: hash
      ? "This is a file you supplied, not a web page, so there is no address to re-check. The copy Sophira read is still in your project and matches the file you added."
      : "This is a file you supplied, not a web page, so there is no address to re-check. The copy Sophira read is still in your project.",
  };
}
