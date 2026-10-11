
/* ================================================================
 * STAGE 6 (2026-10-11): document export — REAL behavior tests.
 * ================================================================ */
export async function runExportTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): Promise<void> {
  section("document export (stage 6)");
  const JSZip = (await import("jszip")).default;
  const { buildDocx, buildPdf, digestOf, exportFilename, textOf } =
    await import("../src/lib/documents/export");
  type ExportArtifact = import("../src/lib/documents/export").ExportArtifact;

  const artifact: ExportArtifact = {
    title: "Bibliography — Photosynthesis",
    artifactType: "bibliography",
    sections: [{ heading: "Sources", items: ["Light reactions produce ATP."], sources: ["S1"] }],
    provenance: [{ sourceLabel: "S1", title: "Plant Biology", locator: "S1" }],
    honestNote: "Built from 1 included notebook source.",
    artifactId: "art-1",
    notebookId: "nb-1",
    createdAt: "2026-10-11T00:00:00.000Z",
  };

  const docx1 = await buildDocx(artifact);
  const docx2 = await buildDocx(artifact);
  assert(digestOf(docx1) === digestOf(docx2),
    "export: DOCX is deterministic — identical bytes for the identical stored artifact");
  const zip = await JSZip.loadAsync(docx1);
  const docXml = await zip.file("word/document.xml")!.async("string");
  assert(docXml.includes("Light reactions produce ATP.") && docXml.includes("Plant Biology"),
    "export: the DOCX contains the STORED artifact's exact section text and provenance");

  const pdf1 = buildPdf(artifact);
  const pdf2 = buildPdf(artifact);
  assert(digestOf(pdf1) === digestOf(pdf2),
    "export: PDF is deterministic — identical bytes for the identical stored artifact");
  const pdfText = pdf1.toString("latin1");
  assert(pdfText.startsWith("%PDF-1.4") && pdfText.includes("%%EOF") && pdfText.includes("Bibliography"),
    "export: the PDF is a valid structure and carries the stored artifact's title");
  assert(pdfText.includes("Plant Biology"),
    "export: the PDF embeds the provenance — sources are never dropped at export");

  assert(textOf(artifact).includes("(sources: S1)") && textOf(artifact).includes("art-1"),
    "export: the text rendering keeps per-section source labels and the artifact identity for verification");
  assert(exportFilename(artifact, "docx").endsWith(".docx") && !exportFilename(artifact, "docx").includes(" "),
    "export: export filenames are filesystem-safe");
}
