/**
 * EXPORTING A COMPLETED ASSIGNMENT RUN (2026-11-15, directive Part 6).
 *
 * What "delivery" means here, precisely:
 *  - The student gets the document as a file they own, with their title and structure.
 *  - The file carries an honest provenance block: what sources were used, what the final check
 *    actually said, and which limitations were recorded. That is transparency about how the
 *    text was produced, not a claim of human authorship and not a concealment of AI assistance.
 *  - A run that is not complete cannot be exported as a finished document; the route refuses
 *    with the reason instead of handing back a half-document named like a finished one.
 *
 * Pure: no database, no clock, no file system. The route writes the bytes.
 */
import { canClaimCompletion, draftedSections, type RunRecord } from "./autonomous";

export const EXPORT_FORMATS = ["md", "txt"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);
}

/** A filename a student can recognise in their downloads folder. */
export function exportFilename(run: RunRecord, format: ExportFormat): string {
  const base = (run.request.title || run.request.question || "assignment")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "assignment";
  const date = run.created_date.slice(0, 10);
  return `${base}-${date}.${format}`;
}

export interface ExportResult {
  ok: boolean;
  /** Present when ok is false: why the document cannot be delivered. */
  reason?: string;
  body?: string;
  filename?: string;
  contentType?: string;
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/**
 * Render the finished document. Refuses — with the same reason the state machine would give —
 * when the run is not complete, so an export can never outrun the completion gate.
 */
export function renderExport(run: RunRecord, format: ExportFormat): ExportResult {
  const decision = canClaimCompletion(run);
  if (!decision.allowed) return { ok: false, reason: decision.reason };

  const title = run.request.title?.trim() || run.plan?.title || run.request.question.slice(0, 80);
  const lines: string[] = [];

  if (format === "md") {
    lines.push(`# ${title}`, "");
    if (run.request.genre) lines.push(`*${run.request.genre}*`, "");
  } else {
    lines.push(title.toUpperCase(), "");
  }

  for (const outline of run.outline) {
    const section = run.sections.find((s) => s.id === outline.id);
    if (!section?.draft) continue;
    if (format === "md") lines.push(`## ${section.title ?? outline.title}`, "");
    else lines.push(`${section.title ?? outline.title}`, "");
    lines.push(section.draft.trim(), "");
  }

  // Provenance, stated plainly. Same content in both formats so nothing is hidden by choosing one.
  const verdict = run.final_verification;
  lines.push(format === "md" ? "---" : "----------", "");
  lines.push("About this draft");
  lines.push("");
  lines.push(`Prepared with Sophira on ${run.created_date.slice(0, 10)}.`);
  lines.push(`Sections written: ${draftedSections(run).length} of ${run.outline.length}.`);
  const sources = run.plan?.sources ?? [];
  lines.push(
    sources.length > 0
      ? `Sources used: ${sources.map((s) => `${s.title}${s.url ? ` (${s.url})` : ""}`).join("; ")}.`
      : "No research sources were used; this draft makes no cited factual claims.",
  );
  lines.push(
    verdict
      ? `Final check: ${verdict.status}. ${verdict.note}`
      : "Final check: not recorded.",
  );
  const limitations = run.findings.filter((f) => f.severity === "limitation");
  if (limitations.length > 0) {
    lines.push(`Limitations recorded during the run: ${limitations.map((l) => l.text).join(" ")}`);
  }
  lines.push("");
  lines.push("This is a draft to read, edit and submit as your own work. Check the facts before you rely on it.");

  return {
    ok: true,
    body: lines.join("\n"),
    filename: exportFilename(run, format),
    contentType: CONTENT_TYPES[format],
  };
}
