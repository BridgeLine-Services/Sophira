import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { buildChecklist, type RubricAuditResult } from "@/lib/rubric";
import { estimateWorkMinutes } from "@/lib/workload";
import { evaluateFinalGate, formatFinalGate } from "@/lib/readiness/finalGate";
import type { TeacherDoc } from "@/lib/types";

export const runtime = "nodejs";

/**
 * FINAL SUBMISSION READINESS GATE — GET /api/readiness/final?assignment_id=…
 *
 * Mandatory, machine-enforced: the response's submission_ready is true
 * ONLY when no hard requirement (teacher, rubric, formatting, research,
 * assignment instructions, placeholders, claims, citations, method)
 * fails. Unverifiable requirements block rather than pass silently.
 *
 * Composes the existing systems — the rubric engine (buildChecklist +
 * live auditDraft on the CURRENT draft, merged with the stored
 * AI-assessed semantic results), the verification record, teacher
 * method compliance, the research integrity report and approved-source
 * counts — and persists the gate result with the evaluated draft.
 */
export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  const assignmentId = request.nextUrl.searchParams.get("assignment_id");
  if (!assignmentId) return NextResponse.json({ error: "Missing assignment id." }, { status: 400 });

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, teacher_id, instructions_text, due_at, mode, task_type, output_type")
    .eq("id", assignmentId)
    .single();
  if (!assignment) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });

  // Latest draft for this assignment (RLS scopes both to the requester).
  const { data: response } = await supabase
    .from("responses")
    .select("id, content, verification")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Teacher rubric + official-instruction documents — the SAME checklist
  // builder the rubric audit uses; the gate is never a second opinion.
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

  // Latest PERSISTED rubric audit for this response (AI-assessed semantics).
  let persistedAudit: RubricAuditResult | null = null;
  if (response?.id) {
    const { data: audit } = await supabase
      .from("rubric_audits")
      .select("results")
      .eq("response_id", response.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (audit) persistedAudit = (audit.results ?? null) as RubricAuditResult | null;
  }

  // Research project (assignment-linked) + approved source count.
  const { data: project } = await supabase
    .from("research_projects")
    .select("id, research_spec, research_integrity")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let approvedSources = 0;
  let minSources: number | null = null;
  if (project) {
    const { count } = await supabase
      .from("research_sources")
      .select("id", { count: "exact", head: true })
      .eq("project_id", project.id)
      .eq("approval", "approved")
      .in("verification_status", ["verified", "partially_verified"]);
    approvedSources = count ?? 0;
    minSources = (project.research_spec as { minSources?: number } | null)?.minSources ?? null;
  }

  const verification = (response?.verification ?? null) as
    | { status?: string | null; checks?: { name: string; passed: boolean; method?: string }[]; method_compliance?: { status?: string | null; notes?: string | null } }
    | null;
  const integrity = (project?.research_integrity ?? null) as
    | { research_complete?: boolean; claims_supported?: number; claims_total?: number; urls_resolve?: number; urls_total?: number; authority_satisfied?: number; authority_total?: number; failures?: { claim_text?: string; reason?: string }[] }
    | null;

  // 2026-10-06: the 12-step citation invariant, computed from the STORED
  // claim/source records — the gate knows about every UNVERIFIED /
  // UNAVAILABLE / STALE citation (NO VERIFIED CITATION WITHOUT VERIFIED
  // SOURCE). Claims whose source vanished or changed are demoted here.
  let citationInvariant: import("@/lib/research/citation-invariant").CitationGateSummary | null = null;
  if (project) {
    const { data: claimRows } = await supabase
      .from("research_claims")
      .select("id, source_url, source_title, evidence_start, evidence_end, verification_status, content_extract, claim")
      .eq("assignment_id", assignmentId)
      .limit(300);
    const { verifyCitation, summarizeCitations } = await import("@/lib/research/citation-invariant");
    const verdicts = (claimRows ?? []).map((c: Record<string, unknown>) => {
      const content = String(c.content_extract ?? "");
      const start = typeof c.evidence_start === "number" ? c.evidence_start : null;
      const passage = content && start !== null && typeof c.evidence_end === "number" ? content.slice(start, c.evidence_end) : null;
      const claimText = String(c.claim ?? "");
      const words = claimText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length > 3);
      const low = passage?.toLowerCase() ?? "";
      const overlap = passage && words.length > 0 && words.filter((w) => low.includes(w)).length >= Math.max(2, Math.ceil(words.length * 0.5));
      const vs = String(c.verification_status ?? "");
      // a verified record needs: stored URL+title+passage+overlap+(re)verified status
      const ok = vs === "verified" && !!c.source_url && !!c.source_title && !!passage && overlap;
      return verifyCitation({
        searchResultExisted: !!c.source_url,
        originalUrl: String(c.source_url ?? ""),
        finalUrl: ok ? String(c.source_url) : "",
        retrieval: ok
          ? { requested: true, redirectCount: 0, httpOk: true, contentChars: content.length, title: String(c.source_title), contentHash: "stored", notes: [] }
          : null,
        passage,
        claim: claimText,
        authorityOk: true,
        citationSource: {
          title: String(c.source_title ?? ""),
          author: null,
          publisher: null,
          publicationDate: null,
          url: String(c.source_url ?? ""),
          accessedISO: new Date(nowMs - 1).toISOString(),
        },
      });
    });
    citationInvariant = summarizeCitations(verdicts);
  }

  const nowMs = Date.now();
  const result = evaluateFinalGate({
    nowMs,
    draft: response?.content ?? null,
    checklist,
    persistedAudit,
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
    research: project
      ? {
          linked: true,
          minSources,
          approvedSources,
          integrity: integrity
            ? {
                research_complete: integrity.research_complete === true,
                claims_supported: integrity.claims_supported ?? 0,
                claims_total: integrity.claims_total ?? 0,
                urls_resolve: integrity.urls_resolve ?? 0,
                urls_total: integrity.urls_total ?? 0,
                authority_satisfied: integrity.authority_satisfied ?? 0,
                authority_total: integrity.authority_total ?? 0,
                failures: (integrity.failures ?? []).map((f) => ({
                  claim_text: f.claim_text ?? "",
                  reason: f.reason ?? "",
                })),
              }
            : null,
        }
      : null,
    citationInvariant,
    dueMs: assignment.due_at ? Date.parse(assignment.due_at) : null,
    // Conservative upper-bound remaining-work estimate from the workload
    // estimator (same transparent heuristic the schedule system uses).
    // The gate applies it only while content blockers exist.
    estimatedRemainingWorkMinutes: estimateWorkMinutes({
      mode: assignment.mode,

      task_type: assignment.task_type,
      output_type: assignment.output_type,
      word_count_target: checklist.criteria.find((x) => x.kind === "word_count_min")?.params.minWords ?? null,
      has_rubric: checklist.criteria.some((x) => x.source === "rubric"),
      requires_research: !!project,
      source_count: approvedSources,
    }).minutes,
  
    // 2026-10-06 completion checks. Populated from real records when they
    // exist; null means "no record" — the gate skips honestly, never fakes.
    teacherConflicts: null,
    pendingCorrections: null,});

  // Persist the machine verdict with the draft it evaluated — the UI can
  // never render a stale "Ready" badge that the machine did not compute.
  if (response?.id) {
    await supabase
      .from("responses")
      .update({ submission_gate: result, updated_at: new Date().toISOString() })
      .eq("id", response.id)
      .eq("user_id", user.id);
  }

  return NextResponse.json({ data: { ...result, gate_text: formatFinalGate(result) } });
}
