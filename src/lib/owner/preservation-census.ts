/**
 * Record census shared by the CLI snapshot (`scripts/member-preservation.mjs`) and the owner-facing
 * check (2026-11-03).
 *
 * The CLI could already compare row counts across 47 user-data tables, but only someone with a
 * terminal could run it. An owner who has never opened a terminal - the person this application is
 * for - had no way to ask "is my data still here", so the check that matters most was the least
 * reachable one.
 *
 * The counting is separated from the network on purpose: `fetchImpl` is injected, so the parsing
 * (which is where an "empty table" and a "missing table" get confused) is unit-tested against fake
 * PostgREST responses instead of assumed. A wrong answer here is worse than no answer, because it
 * would report data safe.
 */

/** Kept identical to CENSUS_TABLES in scripts/member-preservation.mjs; a test fails on drift. */
export const CENSUS_TABLES: readonly string[] = [
  "profiles", "invitations", "invitation_requests",
  "teachers", "teacher_profiles", "courses",
  "workload_selections", "assignments", "assignment_files",
  "rubric_audits", "feedback", "writing_samples",
  "writing_profiles", "essay_sessions", "responses",
  "notebooks", "notebook_sources", "notebook_notes",
  "notebook_questions", "notebook_artifacts", "notebook_evidence",
  "study_materials", "research_projects", "research_sources",
  "research_claims", "research_citations", "research_queries",
  "research_verifications", "academic_sources", "learning_patterns",
  "student_memories", "student_memory_evidence", "document_history",
  "provider_connections", "subject_preferences", "typing_attempts",
  "typing_profiles", "work_schedules", "work_sessions",
  "schedule_executions", "member_notifications", "notification_preferences",
  "canvas_courses", "canvas_assignments", "canvas_sync_events",
  "profile_versions", "profile_update_proposals",
];

export type CensusResponse = {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
};
export type CensusFetch = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<CensusResponse>;

export type TableCount = {
  table: string;
  /** null when the table could not be counted - never 0, which means "exists and is empty". */
  rows: number | null;
  problem?: "missing" | "forbidden" | "unreachable" | "no count returned";
  status?: number;
};

export type CensusResult = {
  counts: Record<string, number>;
  problems: TableCount[];
  checked: number;
  expected: number;
  /** True only when every table answered with a real count. */
  complete: boolean;
};

/**
 * Exact row count for one table, from PostgREST's content-range header.
 *
 * A 404 is reported as `missing`, not swallowed: an absent table is exactly the kind of damage this
 * check exists to find. A `*` total means the count was never computed, which is also a finding -
 * silently treating it as zero would report a destroyed database as an empty one.
 */
export async function countTable(
  fetchImpl: CensusFetch,
  baseUrl: string,
  apiKey: string,
  table: string,
): Promise<TableCount> {
  const url = `${baseUrl.replace(/\/+$/, "")}/rest/v1/${table}?select=id&limit=1`;
  let res: CensusResponse;
  try {
    res = await fetchImpl(url, {
      headers: { apikey: apiKey, Authorization: `Bearer ${apiKey}`, Prefer: "count=exact" },
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return { table, rows: null, problem: "unreachable" };
  }
  if (res.status === 404) return { table, rows: null, problem: "missing", status: 404 };
  if (res.status === 401 || res.status === 403) return { table, rows: null, problem: "forbidden", status: res.status };
  if (!res.ok) return { table, rows: null, problem: "unreachable", status: res.status };

  const total = (res.headers.get("content-range") ?? "").split("/")[1];
  if (total === undefined || total === "*" || total.trim() === "") {
    return { table, rows: null, problem: "no count returned", status: res.status };
  }
  const n = Number(total);
  if (!Number.isFinite(n)) return { table, rows: null, problem: "no count returned", status: res.status };
  return { table, rows: n };
}

/** Count every table, tolerating individual failures but never hiding them. */
export async function runCensus(
  fetchImpl: CensusFetch,
  baseUrl: string,
  apiKey: string,
  tables: readonly string[] = CENSUS_TABLES,
): Promise<CensusResult> {
  const results = await Promise.all(tables.map((t) => countTable(fetchImpl, baseUrl, apiKey, t)));
  const counts: Record<string, number> = {};
  const problems: TableCount[] = [];
  for (const r of results) {
    if (r.rows === null) problems.push(r);
    else counts[r.table] = r.rows;
  }
  return {
    counts,
    problems,
    checked: Object.keys(counts).length,
    expected: tables.length,
    complete: problems.length === 0,
  };
}

/** Plain-language sentence for the owner. No table names, no jargon, no numbers it cannot back. */
export function censusMessage(result: CensusResult): string {
  if (result.complete) {
    return `All ${result.checked} areas of your records answered with a real count. Nothing is missing.`;
  }
  if (result.checked === 0) {
    return "Sophira could not read any of your records just now, so this check proves nothing. Try again in a minute.";
  }
  const missing = result.problems.filter((p) => p.problem === "missing");
  if (missing.length > 0) {
    return `${missing.length} area${missing.length === 1 ? " is" : "s are"} missing from the database entirely. `
      + "This is real damage, not a slow connection. Restore from a backup before adding anything new.";
  }
  return `${result.problems.length} of ${result.expected} areas could not be counted just now, `
    + "so this check is incomplete. Nothing here proves data was lost - run it again.";
}
