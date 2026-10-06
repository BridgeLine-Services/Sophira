import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { buildChecklist, countWords, type RubricAuditResult } from "@/lib/rubric";
import { buildReadiness, type ReadinessRubricAudit } from "@/lib/readiness";
import type { TeacherDoc } from "@/lib/types";

export const runtime = "nodejs";

/**
 * Submission readiness (audit item H1): GET /api/readiness?assignment_id=…
 *
 * Aggregates the systems that already exist — draft, independent
 * verification, teacher method compliance, the rubric audit, and research
 * integrity — into one mechanical verdict. Nothing is re-checked here from
 * scratch and nothing is guessed: every input comes from a stored record,
 * and the verdict is computed by buildReadiness (pure, unit-tested).
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const assignmentId = request.nextUrl.searchParams.get("assignment_id");
  if (!assignmentId) return NextResponse.json({ error: "Missing assignment id." }, { status: 400 });

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, teacher_id, instructions_text")
    .eq("id", assignmentId)
    .eq("user_id", guard.data.user.id)
    .single();
  if (!assignment) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });

  // Latest draft for this assignment (RLS scopes rows to this user).
  const { data: response } = await supabase
    .from("responses")
    .select("id, content, verification")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Latest persisted rubric audit for this assignment.
  const { data: audit } = await supabase
    .from("rubric_audits")
    .select("results, ai_assessed")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Research project linked to this assignment (0012: project.assignment_id).
  const { data: project } = await supabase
    .from("research_projects")
    .select("id, status, research_integrity")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Does this assignment define rubric/instruction criteria at all?
  // Same checklist builder the rubric audit uses — never a second opinion.
  let teacherDocs: TeacherDoc[] = [];
  if (assignment.teacher_id) {
    const { data: teacher } = await supabase
      .from("teachers")
      .select("rubrics, official_instructions")
      .eq("id", assignment.teacher_id)
      .single();
    if (teacher) {
      teacherDocs = [
        ...((teacher.rubrics as TeacherDoc[]) ?? []),
        ...((teacher.official_instructions as TeacherDoc[]) ?? []),
      ].filter((d) => d && !d.archived);
    }
  }
  const checklist = buildChecklist({
    rubricText: teacherDocs.map((d) => `${d.title}\n${d.content}`).join("\n\n"),
    instructionsText: assignment.instructions_text || "",
    teacherDocs: [],
  });

  const verification = (response?.verification ?? null) as
    | { status?: string | null; checks?: { name: string; passed: boolean; method?: string }[]; method_compliance?: { status?: string | null; notes?: string | null } }
    | null;

  let rubricAudit: ReadinessRubricAudit | null = null;
  if (audit) {
    const r = (audit.results ?? {}) as RubricAuditResult;
    rubricAudit = {
      passed: r.summary?.passed ?? 0,
      partial: r.summary?.partial ?? 0,
      failed: r.summary?.failed ?? 0,
      needsSemantic: r.summary?.needsSemantic ?? 0,
      allPassed: Boolean(r.summary?.allPassed),
      aiAssessed: Boolean(audit.ai_assessed),
    };
  }

  const integrity = (project?.research_integrity ?? null) as
    | { research_complete?: boolean; claims_supported?: number; claims_total?: number; urls_resolve?: number; urls_total?: number }
    | null;

  const readiness = buildReadiness({
    hasDraft: Boolean(response?.content),
    draftWords: response?.content ? countWords(response.content) : 0,
    verification: verification
      ? {
          status: verification.status ?? null,
          failedChecks: (verification.checks ?? [])
            .filter((c) => c.method === "computational" && c.passed === false)
            .map((c) => c.name),
        }
      : null,
    methodCompliance: verification?.method_compliance
      ? { status: verification.method_compliance.status ?? null, notes: verification.method_compliance.notes ?? null }
      : null,
    hasRubricCriteria: checklist.criteria.length > 0,
    rubricAudit,
    research: project
      ? {
          linked: true,
          researchComplete: integrity ? (integrity.research_complete === true) : null,
          claimsSupported: integrity?.claims_supported ?? null,
          claimsTotal: integrity?.claims_total ?? null,
          urlsResolve: integrity?.urls_resolve ?? null,
          urlsTotal: integrity?.urls_total ?? null,
        }
      : null,
  });

  return NextResponse.json({ data: readiness });
}
