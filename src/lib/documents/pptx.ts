/**
 * POWERPOINT EXPORT (2026-10-11): real .pptx generation for stored notebook
 * artifacts, mirroring the deterministic DOCX/PDF builders.
 *
 * VERIFICATION AT EVERY STAGE:
 *   build  — the file is built FROM THE STORED ARTIFACT ROW (sections,
 *            provenance, honest note) — never regenerated from thin air.
 *   fit    — slide text uses shrink-to-fit so content stays readable; a
 *            section's bullets and sources never silently vanish.
 *   bound  — content slides are capped (PPTX_MAX_CONTENT_SLIDES) so an
 *            oversized request can never produce an unusable file; the
 *            cap is disclosed on the References slide.
 *   cite   — the References slide always carries the artifact's full
 *            provenance; an export can never silently drop its sources.
 *
 * The library (pptxgenjs) produces standards-based Office Open XML that
 * opens in PowerPoint, Keynote, and LibreOffice. Byte-level determinism is
 * NOT claimed (pptxgenjs stamps file metadata); STRUCTURAL determinism is:
 * the same artifact always yields the same slides, text, and order.
 */
import PptxGenJS from "pptxgenjs";
import type { ExportArtifact } from "./export";

export const PPTX_MAX_CONTENT_SLIDES = 40;

/** Total slides a build will produce for an artifact (used by tests + UI hints). */
export function presentationSlideCount(a: Pick<ExportArtifact, "sections">): number {
  return 2 + Math.min((a.sections ?? []).length, PPTX_MAX_CONTENT_SLIDES) + 1; // title + agenda + content + references
}

export async function buildPptx(a: ExportArtifact): Promise<Buffer> {
  if (!a || typeof a.title !== "string" || a.title.trim() === "") {
    throw new Error("PowerPoint export needs a title.");
  }
  const sections = (a.sections ?? []).filter(
    (s) => s && typeof s.heading === "string" && s.heading.trim() !== "",
  );
  if (sections.length === 0) {
    throw new Error("PowerPoint export needs at least one section with a heading.");
  }

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "Sophira";
  pptx.company = "Sophira";
  pptx.title = a.title;

  // Consistent theme: fixed palette, one accent, generous spacing.
  const INK = "1A202C";
  const SOFT = "4A5568";
  const ACCENT = "2F855A";
  const TITLE_STYLE = { x: 0.5, y: 0.35, w: 9, h: 0.9, fontSize: 28, bold: true, color: INK, fit: "shrink" } as const;
  const BODY_STYLE = { x: 0.5, y: 1.35, w: 9, h: 3.9, fontSize: 16, color: INK, fit: "shrink" } as const;

  // Slide 1 — title.
  const s1 = pptx.addSlide();
  s1.addText(a.title, { x: 0.5, y: 1.9, w: 9, h: 1.3, fontSize: 40, bold: true, color: INK, fit: "shrink" });
  if (a.artifactType) s1.addText(a.artifactType, { x: 0.5, y: 3.25, w: 9, h: 0.6, fontSize: 18, color: SOFT });
  s1.addText("Built by Sophira from your verified notebook sources.", { x: 0.5, y: 4.7, w: 9, h: 0.4, fontSize: 12, color: SOFT });
  s1.addNotes(
    [a.honestNote, `Presentation generated from notebook artifact ${a.artifactId} (${a.notebookId}).`]
      .filter(Boolean)
      .join("\n"),
  );

  // Slide 2 — agenda.
  const s2 = pptx.addSlide();
  s2.addText("Agenda", TITLE_STYLE);
  s2.addText(
    sections.map((sec) => ({ text: sec.heading, options: { bullet: true, breakLine: true } })),
    BODY_STYLE,
  );
  s2.addNotes("Agenda built from the artifact's stored sections.");

  // Content slides — one per section, bullets from the stored items,
  // sources always shown so provenance travels with the slide.
  const capped = sections.slice(0, PPTX_MAX_CONTENT_SLIDES);
  for (const sec of capped) {
    const slide = pptx.addSlide();
    slide.addText(sec.heading, TITLE_STYLE);
    if (sec.items.length > 0) {
      slide.addText(
        sec.items.map((t) => ({ text: t, options: { bullet: true, breakLine: true } })),
        BODY_STYLE,
      );
    }
    if (sec.sources.length > 0) {
      slide.addText(`Sources: ${sec.sources.join(", ")}`, {
        x: 0.5, y: 5.1, w: 9, h: 0.4, fontSize: 11, color: SOFT,
      });
    }
    slide.addNotes(`Section content from the stored artifact section "${sec.heading}".`);
  }

  // Final slide — references & provenance (always present).
  const last = pptx.addSlide();
  last.addText("References & provenance", TITLE_STYLE);
  const prov = a.provenance ?? [];
  const refLines = [
    ...prov.map((p) => ({
      text: `${p.sourceLabel}: ${p.title}${p.locator ? ` (${p.locator})` : ""}`,
      options: { bullet: true, breakLine: true },
    })),
  ];
  if (refLines.length === 0) {
    refLines.push({ text: "No provenance recorded for this artifact.", options: { bullet: false, breakLine: true } });
  }
  last.addText(refLines, BODY_STYLE);
  const footnotes: string[] = [];
  if (a.honestNote) footnotes.push(a.honestNote);
  if (sections.length > PPTX_MAX_CONTENT_SLIDES) {
    footnotes.push(
      `Only the first ${PPTX_MAX_CONTENT_SLIDES} sections are included so the presentation stays usable; ${sections.length - PPTX_MAX_CONTENT_SLIDES} section(s) were left out.`,
    );
  }
  if (footnotes.length > 0) {
    last.addText(footnotes.join("  "), { x: 0.5, y: 5.1, w: 9, h: 0.5, fontSize: 11, color: ACCENT, fit: "shrink" });
  }

  const data = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  return data;
}
