/**
 * PHASE 3a — extraction provenance contract (2026-11-09).
 *
 * Proves the page-level provenance rules against the REAL extractor with
 * injected parsers (the production parsers need real PDF bytes; the
 * orchestration logic is what is under test here):
 *   - page numbers come from the parser, never invented;
 *   - a scanned page is reported as missing, never as an empty success;
 *   - offsets map back to the right page for quotations;
 *   - overall confidence is the WORST page (a partial read stays partial);
 *   - a fully failed read says so;
 *   - the existing response fields are unchanged (additive only).
 */
import { readFileSync } from "fs";
import {
  SCANNED_PAGE_CHARS,
  buildPdfProvenance,
  buildSingleSpanProvenance,
  describeProvenance,
  offsetToPage,
  pageConfidence,
  worstConfidence,
} from "../src/lib/extract/provenance";
import { extractPdfText } from "../src/lib/extract/pdf";

export async function runExtractionProvenanceTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); }
  };

  {
    // ---- confidence thresholds -------------------------------------------
    assert(pageConfidence(0) === "failed", "3a: an empty page is 'failed', not 'high'");
    assert(pageConfidence(SCANNED_PAGE_CHARS) === "low", "3a: a nearly-empty page is 'low'");
    assert(pageConfidence(200) === "medium", "3a: a short page is 'medium'");
    assert(pageConfidence(900) === "high", "3a: a full page is 'high'");
    assert(worstConfidence(["high", "high", "low"]) === "low", "3a: overall = the WORST page (partial reads stay partial)");
    assert(worstConfidence([]) === "failed", "3a: no pages = 'failed', never a default success");

    // ---- per-page provenance ---------------------------------------------
    const pageA = "Photosynthesis converts light into chemical energy through a series of reactions that take place inside chloroplasts. " +
      "The light reactions produce ATP and NADPH, which the Calvin cycle then uses to fix carbon dioxide into sugar.";
    const prov = buildPdfProvenance([
      { page: 1, text: pageA },
      { page: 2, text: "" },
      { page: 3, text: "A short but genuinely readable paragraph of notes appears on this third page." },
    ]);
    assert(prov.pages.length === 3 && prov.pages[2].page === 3, "3a: page numbers come from the parser (1,2,3) - never renumbered");
    assert(prov.scannedPages.length === 1 && prov.scannedPages[0] === 2, "3a: a page with no text layer is reported as scanned (page 2)");
    assert(prov.pages[1].note?.includes("OCR is not available") === true, "3a: the scanned page explains WHY its contents are missing");
    assert(prov.incomplete === true, "3a: a scanned page marks the document incomplete");
    assert(prov.confidence === "failed", "3a: the empty page drags overall confidence to 'failed' (honest worst case)");
    assert(prov.notes.some((n) => n.includes("original file is kept")), "3a: the member is told the original file is preserved");

    // ---- no invented page map --------------------------------------------
    const flat = buildPdfProvenance(null);
    assert(flat.pageMapCertain === false && flat.pages.length === 0, "3a: pdf-parse output does NOT invent page numbers");
    assert(flat.incomplete === true && flat.notes[0].includes("page numbers are not reliable"), "3a: the missing page map is stated in plain English");

    // ---- offset -> page (for quotations) ---------------------------------
    const lengths = [pageA.length + 2, 0 + 2, "A short but genuinely readable paragraph of notes appears on this third page.".length + 2];
    const mid = pageA.length + 2 + 30;
    assert(offsetToPage(flat, mid, lengths) === null, "3a: offsets are NOT mapped when there is no reliable page map");

    const certain = buildPdfProvenance(
      [
        { page: 1, text: pageA },
        { page: 2, text: "Second page text that is long enough to count as readable content for this test fixture." },
      ],
      { pageMapCertain: true }
    );
    const len2 = [pageA.length + 2, "Second page text that is long enough to count as readable content for this test fixture.".length + 2];
    assert(offsetToPage(certain, 5, len2) === 1, "3a: an excerpt from page 1 maps back to page 1");
    assert(offsetToPage(certain, pageA.length + 10, len2) === 2, "3a: an excerpt from page 2 maps back to page 2 (quotation provenance)");
    assert(offsetToPage(certain, 999999, len2) === 2, "3a: an out-of-range offset clamps to the last page, never null-noise");

    // ---- non-PDF kinds stay honest ---------------------------------------
    const docx = buildSingleSpanProvenance("docx", 500);
    assert(docx.kind === "docx" && docx.pageMapCertain === false, "3a: DOCX never claims page numbers it does not have");
    assert(docx.notes.some((n) => n.includes("page/layout numbering is not available")), "3a: DOCX says page numbering is unavailable");
    const empty = buildSingleSpanProvenance("image", 0);
    assert(empty.confidence === "failed" && empty.incomplete === true, "3a: an unreadable image is 'failed', not a quiet empty success");

    // ---- plain-English summary -------------------------------------------
    const text = describeProvenance(prov);
    assert(text.includes("Read 3 pages") && text.includes("no readable text"), "3a: the summary states pages read and missing pages");
    assert(!/100%|guaranteed accurate|is accurate|certain that/i.test(text) && text.includes("does not guarantee"), "3a: the summary never claims certainty or accuracy of contents");
    assert(describeProvenance(empty) === "Nothing could be read from this file.", "3a: nothing read = nothing claimed");

    // ---- the REAL extractor orchestration --------------------------------
    const big = pageA.repeat(2);
    const primaryOk = await extractPdfText(Buffer.from("x"), { primary: async () => big, fallback: async () => big });
    assert(primaryOk.via === "pdf-parse" && primaryOk.pages === null, "3a: when the primary parser succeeds, pages are null (honest), not fabricated");

    const fallbackPages = [
      { page: 1, text: big },
      { page: 2, text: "" },
    ];
    const viaFallback = await extractPdfText(Buffer.from("x"), {
      primary: async () => { throw new Error("Unknown compression method"); },
      fallback: async () => fallbackPages.map((p) => p.text).join("\n\n"),
      pages: async () => fallbackPages,
    });
    assert(viaFallback.via === "pdfjs" && Array.isArray(viaFallback.pages) && viaFallback.pages!.length === 2,
      "3a: the modern fallback reports real per-page text");
    const fbProv = buildPdfProvenance(viaFallback.pages ?? null);
    assert(fbProv.scannedPages.join(",") === "2", "3a: a scanned page found by the fallback is surfaced end-to-end");

    const bothFail = await extractPdfText(Buffer.from("x"), {
      primary: async () => { throw new Error("bad XRef"); },
      fallback: async () => { throw new Error("still bad"); },
      pages: async () => { throw new Error("no pages"); },
    });
    assert(bothFail.via === "none" && bothFail.text === "", "3a: both parsers failing reports 'none' - never a fabricated empty success");

    // ---- additive-only contract pins -------------------------------------
    const route = readFileSync("src/app/api/extract/route.ts", "utf8");
    assert(route.includes("provenance: buildPdfProvenance("), "3a: the extract route attaches provenance to PDF results");
    assert(route.includes('confidence: "failed"') && route.includes('text,'), "3a: the existing response fields (text/confidence/notes) are unchanged");
    const pdfSrc = readFileSync("src/lib/extract/pdf.ts", "utf8");
    assert(pdfSrc.includes("pages?: { page: number; text: string }[] | null"), "3a: PdfExtraction gains pages additively (optional field)");
    assert(pdfSrc.includes("pdf-parse cannot report page boundaries"), "3a: the primary path documents WHY pages are null");
  }

  return { passed, failed };
}
