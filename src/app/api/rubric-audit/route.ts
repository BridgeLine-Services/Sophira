import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { aiChat, aiConfigured, AiNotConfiguredError, parseJsonLoose } from "@/lib/ai/client";
import {
  buildChecklist,
  auditDraft,
  mergeSemanticResults,
  failedCriteriaForRevision,
  type RubricAuditResult,
} from "@/lib/rubric";
import { wrapUntrusted } from "@/lib/ai/context";
import type { TeacherDoc } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Rubric compliance workflow (spec §6).
 *
 *  POST /api/rubric-audit { assignment_id, response_id, revision_of? }
 *    1. Loads the draft + assignment instructions + teacher rubric docs.
 *    2. Parses a structured checklist (word limits, sections, citations,
 *       bibliography, prohibited elements, …).
 *    3. Runs DETERMINISTIC validation first — code checks what code can.
 *    4. Only unresolved semantic criteria go to a separate AI evaluation
 *       pass, whose results are merged in and clearly labeled AI-assessed.
 *    5. Persists the audit with the response. A failed audit never says
 *       "meets the rubric" — the route returns the failed criteria list so
 *       the UI can offer a targeted revision.
 *
 *  GET /api/rubric-audit?response_id=…  → latest audit for a response.
 *  POST /api/rubric-audit/revision — see route file.
 */

export async function GET(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  const responseId = request.nextUrl.searchParams.get("response_id");
  if (!responseId) return NextResponse.json({ error: "Missing response id." }, { status: 400 });

  const { data: audit } = await supabase
    .from("rubric_audits")
    .select("*")
    .eq("response_id", responseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return NextResponse.json({ data: { audit: audit ?? null } });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;

  let body: { assignment_id?: string; response_id?: string; revision_of?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const assignmentId = (body.assignment_id || "").trim();
  const responseId = (body.response_id || "").trim();
  if (!assignmentId || !responseId) {
    return NextResponse.json({ error: "Missing assignment or response id." }, { status: 400 });
  }

  // Load the draft + assignment (RLS scopes both to the requesting user).
  const { data: response } = await supabase
    .from("responses")
    .select("id, assignment_id, content")
    .eq("id", responseId)
    .eq("user_id", guard.data.user.id)
    .single();
  if (!response || !response.content) {
    return NextResponse.json({ error: "Response not found." }, { status: 404 });
  }
  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, teacher_id, instructions_text, task_type, output_type, title")
    .eq("id", assignmentId)
    .eq("user_id", guard.data.user.id)
    .single();
  if (!assignment) return NextResponse.json({ error: "Assignment not found." }, { status: 404 });

  // Teacher rubric + official-instruction documents (existing system).
  let teacherDocs: TeacherDoc[] = [];
  if (assignment.teacher_id) {
    // Hostile audit fix 2026-10-06: rubrics/official_instructions live on
    // teacher_profiles (0001), NOT on teachers — the old query silently
    // returned nothing. Explicit user ownership on both rows.
    const { data: teacherRow } = await supabase
      .from("teachers")
      .select("id")
      .eq("id", assignment.teacher_id)
      .eq("user_id", guard.data.user.id)
      .single();
    const { data: teacher } = teacherRow
      ? await supabase
          .from("teacher_profiles")
          .select("rubrics, official_instructions")
          .eq("teacher_id", assignment.teacher_id)
          .eq("user_id", guard.data.user.id)
          .single()
      : { data: null };
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
  if (checklist.criteria.length === 0) {
    return NextResponse.json(
      {
        error:
          "No rubric or structured requirements were found for this assignment — add the rubric, requirements, or teacher documents first, then audit.",
      },
      { status: 400 }
    );
  }

  // Step 1: deterministic audit — the model never "declares" these.
  let audit = auditDraft(response.content, checklist);

  // Step 2: semantic pass ONLY for criteria code cannot check.
  let aiAssessed = false;
  const semantic = audit.results.filter((r) => r.status === "needs_semantic");
  if (semantic.length > 0 && aiConfigured()) {
    try {
      const semanticCriteria = checklist.criteria.filter((c) =>
        semantic.some((s) => s.id === c.id)
      );
      const prompt = [
        "You are auditing a student's draft against specific rubric criteria. For EACH numbered criterion, judge ONLY that criterion: respond with a JSON array like",
        '[{"id":"<criterion id>","status":"satisfied|partial|not_satisfied","evidence":"quote or describe the exact draft evidence","requiredCorrection":"what to fix, or empty string"}].',
        "Base every judgment on the actual draft text. Quote real evidence — do not invent quotes. If the draft genuinely does not address a criterion, mark it not_satisfied.",
        "",
        "CRITERIA:",
        ...semanticCriteria.map((c) => `[${c.id}] ${c.label}${c.params.detail ? `\nRubric excerpt: ${wrapUntrusted("rubric excerpt", String(c.params.detail))}` : ""}`),
        "",
        "DRAFT:",
        wrapUntrusted("draft", response.content.slice(0, 24000)),
      ].join("\n");
      const raw = await aiChat(
        [
          { role: "system", content: "You are a precise, honest rubric auditor. Judge only the listed criteria against the actual draft. Output only JSON." },
          { role: "user", content: prompt },
        ],
        { temperature: 0, maxTokens: 3000 }
      );
      const parsed = parseJsonLoose(raw);
      if (Array.isArray(parsed)) {
        const merged = (parsed as { id?: string; status?: string; evidence?: string; requiredCorrection?: string }[])
          .filter((x) => x && typeof x.id === "string")
          .map((x) => ({
            id: x.id as string,
            status: (["satisfied", "partial", "not_satisfied"].includes(String(x.status)) ? x.status : "partial") as
              | "satisfied" | "partial" | "not_satisfied",
            evidence: String(x.evidence ?? "").slice(0, 500),
            requiredCorrection: String(x.requiredCorrection ?? "").slice(0, 500),
          }));
        audit = mergeSemanticResults(audit, merged);
        aiAssessed = true;
      }
    } catch (e) {
      if (e instanceof AiNotConfiguredError) {
        return NextResponse.json({ error: "The AI service is not configured on the server." }, { status: 503 });
      }
      // Semantic failure is honest, not fatal: keep the deterministic results
      // and record that semantic checks could not run.
      audit = {
        ...audit,
        results: audit.results.map((r) =>
          r.status === "needs_semantic"
            ? { ...r, evidence: "Semantic evaluation could not run (AI error) — deterministic checks are still valid." }
            : r
        ),
      };
    }
  } else if (semantic.length > 0) {
    audit = {
      ...audit,
      results: audit.results.map((r) =>
        r.status === "needs_semantic"
          ? { ...r, evidence: "Semantic evaluation unavailable (AI not configured) — deterministic checks are still valid." }
          : r
      ),
    };
  }

  // Step 3: persist with the response.
  const { data: saved, error } = await supabase
    .from("rubric_audits")
    .insert({
      user_id: guard.data.user.id,
      assignment_id: assignmentId,
      response_id: responseId,
      word_count: audit.wordCount,
      checklist,
      results: audit,
      ai_assessed: aiAssessed,
      revision_of: body.revision_of || null,
    })
    .select("id, created_at")
    .single();
  if (error || !saved) {
    return NextResponse.json({ error: "Could not save the audit: " + (error?.message ?? "unknown") }, { status: 500 });
  }

  const failedInstruction = failedCriteriaForRevision(audit);
  return NextResponse.json({
    data: {
      audit_id: saved.id,
      audit,
      ai_assessed: aiAssessed,
      needs_revision: !audit.summary.allPassed,
      failed_criteria: failedInstruction,
    },
  });
}

export type { RubricAuditResult };
