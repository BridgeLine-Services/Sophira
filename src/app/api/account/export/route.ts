import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";

export const runtime = "nodejs";

/**
 * Data export (privacy: user control over personal data).
 *
 * Returns EVERY user-owned database record for the signed-in user as a single
 * JSON document, using the RLS-scoped client — the database policies
 * themselves guarantee that only the user's own rows are ever read
 * (defense in depth on top of the authorization chain below).
 *
 * Scope notes (honest limits, by design):
 * - Uploaded FILE BINARIES (assignment photographs/uploads) are stored in a
 *   private storage bucket; this export includes their database records
 *   (paths, names, types) but not the bytes themselves.
 * - provider_usage is operational server telemetry, not user academic
 *   content, and is not included.
 * - Each table is capped at 10,000 rows; if a cap is hit the per-table entry
 *   carries "truncated": true so the export never lies about completeness.
 */
const USER_TABLES = [
  "profiles",
  "profile_versions",
  "profile_update_proposals",
  "courses",
  "teachers",
  "teacher_profiles",
  "assignments",
  "assignment_files",
  "responses",
  "feedback",
  "writing_profiles",
  "writing_samples",
  "essay_sessions",
  "learning_patterns",
  "typing_attempts",
  "typing_profiles",
  "work_schedules",
  "schedule_executions",
  "work_sessions",
  "rubric_audits",
  "study_materials",
  "academic_sources",
  "research_projects",
  "research_queries",
  "research_sources",
  "research_citations",
  "research_claims",
  "research_verifications",
  "notebooks",
  "notebook_notes",
  "notebook_sources",
  "notebook_questions",
  "notebook_evidence",
  "notebook_artifacts",
  "student_memories",
  "subject_preferences",
  "student_memory_evidence",
] as const;

const ROW_CAP = 10000;

export async function GET() {
  const supabase = createClient();
  // Full authorization chain: authenticated -> ACTIVE access -> own data.
  // RLS additionally scopes every read to the caller's own rows.
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const user = guard.data.user;

  const exportData: Record<string, unknown> = {
    format: "sophira-data-export",
    version: 1,
    exported_at: new Date().toISOString(),
    user: { id: user.id, email: user.email ?? null },
  };
  const tables: Record<string, unknown> = {};
  let truncated_any = false;

  for (const table of USER_TABLES) {
    const { data, error } = await supabase.from(table).select("*").limit(ROW_CAP);
    if (error) {
      // A read failure must be reported honestly, never silently omitted.
      tables[table] = { error: `Could not read this table: ${error.message}` };
      continue;
    }
    if (data.length === ROW_CAP) truncated_any = true;
    tables[table] = { rows: data, truncated: data.length === ROW_CAP };
  }
  exportData["tables"] = tables;
  exportData["truncated_any"] = truncated_any;

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-disposition": `attachment; filename="sophira-data-export-${user.id}.json"`,
      "cache-control": "no-store",
    },
  });
}
