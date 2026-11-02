/**
 * CANVAS RUBRIC DISPLAY (Phase 4, 2026-11-02).
 *
 * The Canvas sync has stored `rubric` since migration 0041 but nothing ever showed it,
 * so students could not see the grading criteria their teacher published. This module
 * turns that stored, UNTRUSTED JSON into a small, safe model.
 *
 * Rules that matter:
 *  - Never invent a rubric. No criteria in, no criteria out. No "typical" criteria, no
 *    generated performance levels, no guessed point values.
 *  - Canvas descriptions may contain HTML. Everything is reduced to plain text here, so
 *    the UI renders text rather than markup from a third party.
 *  - Bounded: a hostile or broken payload cannot produce thousands of rows or megabytes
 *    of text. Counts and lengths are capped, and invalid numbers become null (unknown)
 *    rather than 0 (which would look like a real zero-point criterion).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface RubricRating {
  description: string;
  longDescription: string | null;
  points: number | null;
}

export interface RubricCriterion {
  id: string;
  description: string;
  longDescription: string | null;
  points: number | null;
  ratings: RubricRating[];
}

export const RUBRIC_LIMITS = { criteria: 40, ratings: 10, textChars: 600 } as const;

/** Reduce third-party HTML-ish text to a single plain-text line. */
export function plainText(value: unknown): string {
  if (typeof value !== "string") return "";
  const withoutTags = value.replace(/<[^>]*>/g, " ");
  const decoded = withoutTags
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&apos;/gi, "'");
  return decoded.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Long text keeps its wording but is bounded and still plain. */
function boundedText(value: unknown, limit: number = RUBRIC_LIMITS.textChars): string | null {
  const text = plainText(value);
  if (!text) return null;
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/** Points must be a real, finite, non-negative number. Anything else is unknown. */
function points(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseRatings(raw: unknown): RubricRating[] {
  return asArray(raw).slice(0, RUBRIC_LIMITS.ratings).map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      description: plainText(r.description) || "Level",
      longDescription: boundedText(r.long_description ?? r.longDescription),
      points: points(r.points),
    };
  });
}

/**
 * Accepts either the array Canvas returns or an object wrapping `criteria`, because the
 * sync stores `rubric ?? rubric_settings` and both shapes occur in Canvas payloads.
 */
export function parseRubric(raw: unknown): RubricCriterion[] {
  if (raw === null || raw === undefined) return [];
  const source = Array.isArray(raw)
    ? raw
    : asArray((raw as Record<string, unknown>).criteria ?? (raw as Record<string, unknown>).rubric);

  return source.slice(0, RUBRIC_LIMITS.criteria).map((item, index) => {
    const c = (item ?? {}) as Record<string, unknown>;
    return {
      id: typeof c.id === "string" && c.id ? c.id : `criterion-${index + 1}`,
      // Titles are bounded too: a 5,000-character "title" from a broken payload must not
      // become a wall of text on the student's workspace.
      description: boundedText(c.description ?? c.title, 160) || "Untitled criterion",
      longDescription: boundedText(c.long_description ?? c.longDescription),
      points: points(c.points),
      ratings: parseRatings(c.ratings),
    };
  });
}

/**
 * Total available points, or null when any criterion has unknown points. A partial total
 * would understate the assignment, so it is better to show nothing than a wrong number.
 */
export function rubricPointsTotal(criteria: RubricCriterion[]): number | null {
  if (criteria.length === 0) return null;
  let total = 0;
  for (const c of criteria) {
    if (c.points === null) return null;
    total += c.points;
  }
  return Math.round(total * 100) / 100;
}

/** Only real https links from Canvas are shown; anything else renders as no link. */
export function safeCanvasUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export interface CanvasAssignmentContext {
  canvasTitle: string;
  htmlUrl: string | null;
  pointsPossible: number | null;
  submissionTypes: string[];
  dueAt: string | null;
  criteria: RubricCriterion[];
  attachmentNames: string[];
  /** 'missing' means Canvas no longer lists it; the student's work is still kept. */
  syncState: string;
}

const FRIENDLY_SUBMISSION: Record<string, string> = {
  online_text_entry: "Typed in Canvas",
  online_upload: "File upload",
  online_url: "Web link",
  media_recording: "Audio or video",
  on_paper: "On paper",
  none: "No submission required",
};

export function submissionTypeLabel(raw: string): string {
  return FRIENDLY_SUBMISSION[raw] ?? "Submission type set by your teacher";
}

function attachmentNames(raw: unknown): string[] {
  return asArray(raw)
    .slice(0, 20)
    .map((item) => plainText((item as Record<string, unknown>)?.display_name ?? (item as Record<string, unknown>)?.filename))
    .filter((name) => name.length > 0);
}

/**
 * Load the Canvas details for one Sophira assignment, for one signed-in student.
 * Filters on user_id explicitly as well as relying on RLS: two independent reasons a
 * student cannot read another student's course data.
 */
export async function loadCanvasContext(
  supabase: SupabaseClient,
  userId: string,
  assignmentId: string,
): Promise<CanvasAssignmentContext | null> {
  const { data, error } = await supabase
    .from("canvas_assignments")
    .select("title, html_url, points_possible, submission_types, due_at, rubric, attachments, sync_state")
    .eq("user_id", userId)
    .eq("sophira_assignment_id", assignmentId)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as Record<string, unknown>;
  return {
    canvasTitle: plainText(row.title) || "Canvas assignment",
    htmlUrl: safeCanvasUrl(row.html_url),
    pointsPossible: points(row.points_possible),
    submissionTypes: asArray(row.submission_types).map((t) => String(t)).slice(0, 6),
    dueAt: typeof row.due_at === "string" ? row.due_at : null,
    criteria: parseRubric(row.rubric),
    attachmentNames: attachmentNames(row.attachments),
    syncState: typeof row.sync_state === "string" ? row.sync_state : "active",
  };
}
