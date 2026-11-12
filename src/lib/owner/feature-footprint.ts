/**
 * FEATURE FOOTPRINT (2026-11-11).
 *
 * The owner asked which features are actually being used. Sophira does not track people, and it
 * never will: there is no per-member usage log, and adding one would be surveillance of study.
 *
 * What it DOES have is real records - courses, notebooks, essays, research projects, lectures,
 * memories, typing attempts - and the honest aggregate question "how much of this exists?" has a
 * real answer: the number of stored rows.
 *
 * Three rules:
 *   1. COUNT ONLY. Every query asks the database for a count with head:true, so no member's row,
 *      text or file name ever reaches this process. There is nothing here to leak.
 *   2. A FAILED COUNT IS NULL, never 0. "Could not read" and "nothing stored" are different
 *      facts, and the page says which one it is.
 *   3. A FEATURE WITH NO RECORD IS NOT MEASURED, and it says so. AI Tutor, Math Solver, Writing
 *      Assistant, Document Export and Offline Mode write no per-feature record, so their usage is
 *      reported as not measured rather than guessed from the AI request count.
 *
 * Server-only (uses the service-role client, because row-level security would otherwise count
 * only the owner's own rows and understate the whole network).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { FeatureFootprint } from "./analytics-extended";
import { notMeasured } from "./analytics-extended";

interface Counter {
  key: string;
  label: string;
  table: string;
  /** What one row means, in the owner's words. */
  noun: string;
}

/** The tables that genuinely represent a feature's use. Each row is a real piece of work. */
const COUNTERS: Counter[] = [
  { key: "courses", label: "Courses", table: "courses", noun: "course" },
  { key: "assignments", label: "Assignments", table: "assignments", noun: "assignment" },
  { key: "responses", label: "Written responses", table: "responses", noun: "response" },
  { key: "essay-assistant", label: "Essay Assistant", table: "essay_sessions", noun: "essay session" },
  { key: "research-assistant", label: "Research Assistant", table: "research_projects", noun: "research project" },
  { key: "lecture-studio", label: "Lecture Studio", table: "media_transcripts", noun: "transcript" },
  { key: "notebooks", label: "Notebooks", table: "notebooks", noun: "notebook" },
  { key: "learning-memory", label: "Learning and Memory", table: "student_memories", noun: "remembered fact" },
  { key: "typing-calibration", label: "Typing Calibration", table: "typing_attempts", noun: "typing attempt" },
  { key: "canvas", label: "Canvas import", table: "canvas_assignments", noun: "imported assignment" },
  { key: "schedule", label: "Study plan", table: "work_schedules", noun: "planned session" },
  { key: "documents", label: "Uploaded documents", table: "academic_sources", noun: "source" },
];

/** Features that write no per-feature record. Said plainly, never estimated. */
const NOT_MEASURED: FeatureFootprint[] = [
  notMeasured(
    "ai-tutor",
    "AI Tutor",
    "Tutor conversations are not stored as a separate record, so Sophira cannot count them without reading members' conversations. It will not do that, so this is not measured.",
  ),
  notMeasured(
    "math-solver",
    "Math Solver",
    "Maths answers are produced and verified on demand and are not tagged as a feature in the record. Usage is not measured.",
  ),
  notMeasured(
    "writing-assistant",
    "Writing Assistant",
    "Writing help is part of the response and essay workflow and writes no separate record, so its usage is not measured.",
  ),
  notMeasured(
    "offline-mode",
    "Offline Mode",
    "Offline use happens on the member's own device. The server sees a later sync, not how much work was done offline, so this is not measured.",
  ),
  notMeasured(
    "document-export",
    "Document Export",
    "An export leaves as a file the member downloads. No server record is written per export, so this is not measured.",
  ),
];

function readable(value: string): string {
  return value.replace(/_/g, " ");
}

/** One table's row count, or null when it could not be counted. */
async function countRows(
  admin: { from: (table: string) => { select: (columns: string, opts: { count: "exact"; head: true }) => Promise<{ count: number | null; error: unknown }> } },
  table: string,
): Promise<number | null> {
  try {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true });
    if (error) return null;
    return typeof count === "number" && Number.isFinite(count) ? count : null;
  } catch {
    return null;
  }
}

export interface FootprintRead {
  entries: FeatureFootprint[];
  /** True when at least one count could be read. */
  anyRead: boolean;
  /** Plain reason when NOTHING could be counted. */
  reason: string | null;
}

/**
 * Read the footprint. `createClient` is injectable so the rule "counts only, never rows" can be
 * pinned in a test without a database.
 */
export async function loadFeatureFootprint(options: {
  createClient?: () => unknown;
} = {}): Promise<FootprintRead> {
  let admin: Parameters<typeof countRows>[0];
  try {
    const client = options.createClient ? options.createClient() : createAdminClient();
    admin = client as Parameters<typeof countRows>[0];
  } catch {
    return {
      entries: NOT_MEASURED,
      anyRead: false,
      reason:
        "This deployment cannot count stored records, so no footprint is shown. That is a limitation of where Sophira is running, not evidence that nothing is used.",
    };
  }

  const counts = await Promise.all(COUNTERS.map((c) => countRows(admin, c.table)));
  const entries: FeatureFootprint[] = COUNTERS.map((c, i) => {
    const count = counts[i];
    return {
      key: c.key,
      label: c.label,
      count,
      detail:
        count === null
          ? `Sophira could not count stored ${readable(c.noun)} records just now. That is not the same as none.`
          : `${count.toLocaleString("en-US")} stored ${readable(c.noun)} ${count === 1 ? "record" : "records"} in the network.`,
    };
  });

  const anyRead = counts.some((c) => c !== null);
  return {
    entries: [...entries, ...NOT_MEASURED],
    anyRead,
    reason: anyRead
      ? null
      : "Sophira could not count any stored records just now, so no footprint figure is shown. Nothing has been changed.",
  };
}
