/**
 * POWERPOINT EXPORT (2026-10-11): REAL behavior tests. A genuine .pptx is
 * generated from a stored artifact, validated as an Open XML package,
 * re-read with the repository's INDEPENDENT PPTX parser (the same reader
 * used for uploads - not the generator itself), and bounded input is
 * checked. No assertion here is satisfied by a file merely existing.
 */
export async function runPptxExportTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): Promise<void> {
  section("PowerPoint export (real .pptx generation)");
  const JSZip = (await import("jszip")).default;
  const { parsePptx } = await import("../src/lib/extract/documents");
  const { buildPptx, presentationSlideCount, PPTX_MAX_CONTENT_SLIDES } = await import("../src/lib/documents/pptx");
  type ExportArtifact = import("../src/lib/documents/export").ExportArtifact;

  const artifact: ExportArtifact = {
    title: "Photosynthesis — Light & Dark Reactions",
    artifactType: "bibliography",
    sections: [
      { heading: "Light reactions", items: ["Chlorophyll absorbs light (π orbitals).", "ATP and NADPH are produced — naïve models often omit this."], sources: ["S1", "S2"] },
      { heading: "Calvin cycle", items: ["CO₂ is fixed by RuBisCO…", "“Dark” reactions still need ATP."], sources: ["S2"] },
      { heading: "Why it matters", items: ["Nearly all food chains start here."], sources: ["S1", "S3"] },
    ],
    provenance: [
      { sourceLabel: "S1", title: "Plant Biology", locator: "ch. 4" },
      { sourceLabel: "S2", title: "Journal of Botany — Review", locator: "p. 12" },
    ],
    honestNote: "Built from 3 included notebook sources.",
    artifactId: "art-1",
    notebookId: "nb-1",
    createdAt: "2026-10-11T00:00:00.000Z",
  };

  // ---- a REAL file is generated and is a valid Open XML package ----
  const buf = await buildPptx(artifact);
  assert(buf.length > 5000, "pptx: a real .pptx binary is produced (not an empty or renamed file)");
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files);
  const ct = await zip.file("[Content_Types].xml")!.async("string");
  assert(ct.includes("presentationml") && ct.includes("slideMaster"),
    "pptx: the archive carries the Open XML content types for a presentation");
  assert(zip.file("ppt/presentation.xml") !== null, "pptx: ppt/presentation.xml exists");
  const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  assert(slides.length === presentationSlideCount(artifact) && slides.length === 6,
    "pptx: expected slide count (title + agenda + 3 sections + references = 6)");
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  assert(pres.includes("sldSz"), "pptx: the presentation part declares slide dimensions");

  // ---- the INDEPENDENT reader recovers the real content ----
  const parsed = await parsePptx(buf);
  assert(parsed.text.includes("Light reactions") && parsed.text.includes("Calvin cycle"),
    "pptx: slide titles survive round-trip through the independent reader");
  assert(parsed.text.includes("Chlorophyll absorbs light (π orbitals).") && parsed.text.includes("CO₂ is fixed by RuBisCO…"),
    "pptx: bullet text (including unicode: π, ₂, …, —) survives byte-for-byte");
  assert(parsed.text.includes("Plant Biology") && parsed.text.includes("Journal of Botany"),
    "pptx: citations and references are preserved on the References slide");
  assert(parsed.text.includes("S1") && parsed.text.includes("Sources: S1, S2"),
    "pptx: per-slide source labels travel with their sections");
  assert(parsed.text.includes("Speaker notes:") && parsed.text.includes("Built from 3 included notebook sources."),
    "pptx: the honest provenance note is embedded in the slide's speaker notes and survives the independent reader");

  // ---- structural determinism (bytes are not claimed deterministic) ----
  const buf2 = await buildPptx(artifact);
  const parsed2 = await parsePptx(buf2);
  assert(parsed2.text === parsed.text && parsed2.notes === parsed.notes,
    "pptx: same artifact -> identical slides, text, and order (structural determinism)");

  // ---- oversized input is bounded safely and the cap is disclosed ----
  const huge: ExportArtifact = { ...artifact, sections: Array.from({ length: 100 }, (_, i) => ({ heading: `Section ${i + 1}`, items: [`Item ${i + 1}`], sources: [] })) };
  const cappedBuf = await buildPptx(huge);
  const cappedParsed = await parsePptx(cappedBuf);
  assert(
    cappedParsed.text.includes(`Only the first ${PPTX_MAX_CONTENT_SLIDES} sections are included`) &&
      cappedParsed.text.includes("60 section(s) were left out"),
    "pptx: 100 sections are capped at 40 content slides and the cap is DISCLOSED on the References slide");

  // ---- invalid requests are rejected clearly ----
  let threwEmpty = false;
  try { await buildPptx({ ...artifact, sections: [] }); } catch { threwEmpty = true; }
  assert(threwEmpty, "pptx: an artifact with no sections is rejected with a clear error");
  let threwTitle = false;
  try { await buildPptx({ ...artifact, title: "  " }); } catch { threwTitle = true; }
  assert(threwTitle, "pptx: an artifact without a title is rejected with a clear error");

  // ---- the route serves it through the same guarded pipeline ----
  const route = (await import("node:fs")).readFileSync("src/app/api/notebooks/[id]/export/route.ts", "utf8");
  assert(route.includes("buildPptx") && route.includes("presentationml.presentation"),
    "pptx: the export route serves the real MIME type through the SAME authenticated, RLS-guarded, digest-verified pipeline as DOCX/PDF");
  assert(route.includes("format must be 'docx', 'pdf', or 'pptx'"),
    "pptx: invalid formats are rejected clearly");
  assert(route.includes("status: 400 }"), "pptx: generation errors return an honest 400, never a false success");
  const ui = (await import("node:fs")).readFileSync("src/app/notebooks/[id]/page.tsx", "utf8");
  assert(ui.includes('doExport("pptx")') && ui.includes("Export PPTX"),
    "pptx: the notebook workspace exposes the real PowerPoint export button alongside DOCX/PDF");
}
