import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { aiChat, aiConfigured, parseJsonLoose } from "@/lib/ai/client";
import {
  canDraft, nextSectionToDraft, allSectionsDrafted,
  type EssaySessionState, type OutlineSection,
} from "@/lib/essay/pipeline";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/essay/draft-section — stages SECTION DRAFTS → CITATION AUDIT →
 * RUBRIC AUDIT → STYLE AUDIT → FINAL VERIFICATION. One section per call —
 * an entire essay is NEVER generated as one opaque response. The outline
 * approval gate is enforced here AND in the pure engine.
 *
 * Sections are stored ONCE per section (never per character). The paced
 * reveal is a client-side local timer over already-generated text.
 */

interface SectionRow { id: string; draft: string | null; audits: { citation: string; rubric: string; style: string } | null }

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: { session_id?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.session_id) return NextResponse.json({ error: "session_id required." }, { status: 400 });

  const { data: session } = await supabase
    .from("essay_sessions")
    .select("*")
    .eq("id", body.session_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!session) return NextResponse.json({ error: "Essay session not found." }, { status: 404 });

  const outline: OutlineSection[] = session.outline ?? [];
  const rows: SectionRow[] = session.sections ?? [];
  const state: EssaySessionState = {
    outlineApproved: session.outline_approved === true,
    outline,
    sections: rows.map((r) => ({ id: r.id, draft: r.draft, audits: r.audits })),
    finalVerification: null,
  };

  // HARD GATE — no drafting before outline approval (structurally enforced)
  const gate = canDraft(state);
  if (!gate.allowed) return NextResponse.json({ error: gate.reason }, { status: 409 });

  const sectionId = nextSectionToDraft(state);
  if (!sectionId) {
    return NextResponse.json({ error: "All sections are already drafted — run final verification." }, { status: 409 });
  }
  const section = outline.find((o) => o.id === sectionId);
  if (!section) return NextResponse.json({ error: `Outline section ${sectionId} is missing.` }, { status: 500 });

  if (!aiConfigured()) return NextResponse.json({ error: "AI is not configured — sections cannot be drafted." }, { status: 503 });

  const plan = session.plan ?? {};
  const isResearch = (plan.sources ?? []).length > 0;
  const evidence = (plan.evidenceMap ?? []).filter((e: { label: string }) => section.evidenceLabels.includes(e.label));

  // SECTION DRAFT — one section only; prior sections provided as context
  const prior = state.sections
    .filter((s) => s.draft)
    .map((s) => `${s.id}: ${s.draft!.slice(0, 400)}…`)
    .join("\n");
  const draftPrompt = [
    "Write ONE section of a student's essay. Do not write any other section. Do not write an introduction to the whole essay unless this IS the introduction section.",
    `Section: "${section.title}" (${section.targetWords} words target).`,
    `Points to cover: ${section.points.join(" ; ")}.`,
    `Thesis the whole essay argues: ${plan.thesis ?? ""}`,
    prior ? `Sections already drafted (context only — do NOT repeat them):\n${prior}` : "This is the first section.",
    isResearch && evidence.length > 0
      ? `Evidence you may use (cite in-text as [${evidence.map((e: EvidenceRow) => e.label).join("], [")}]):\n${evidence.map((e: EvidenceRow) => `[${e.label}] "${e.sourceTitle}": ${e.passage}`).join("\n")}\nUse ONLY this evidence for factual claims; if a point has no supporting evidence, write that the evidence is missing rather than inventing support. Never invent quotations, statistics, authors, or dates.`
      : "No research sources are attached; make no factual claims that require citations.",
    `Teacher requirements to respect: ${(plan.teacherRequirements ?? []).map((t: TeacherRow) => t.requirement).join(" ; ") || "(none on file)"}`,
    'After the section text, output JSON: {"citation_audit":"...","rubric_audit":"...","style_audit":"..."} — one honest sentence each about THIS section (citations used or missing; how it maps to rubric criteria; style/voice consistency).',
  ].join("\n\n");
  const raw = await aiChat([
    { role: "system", content: "You are drafting one section of a student's essay in the student's own voice, at their academic level. You must not fabricate sources or quotations." },
    { role: "user", content: draftPrompt },
  ], { temperature: 0.4, maxTokens: 1200 });
  const { text: draftText, audits } = splitDraftAndAudits(raw);

  const newRows: SectionRow[] = [
    ...rows.filter((r) => r.id !== sectionId),
    { id: sectionId, draft: draftText, audits },
  ].sort((a, b) => outline.findIndex((o) => o.id === a.id) - outline.findIndex((o) => o.id === b.id));

  const drafted = allSectionsDrafted({ ...state, sections: newRows.map((r) => ({ id: r.id, draft: r.draft, audits: r.audits })) });

  // FINAL VERIFICATION — runs once, after the last section
  let finalVerification = session.final_verification;
  if (drafted) {
    const assembled = newRows.map((r) => r.draft ?? "").join("\n\n");
    const verdict = await aiChat([
      { role: "system", content: "You are a verifier, not an editor. Given an essay assembled from sections, check honestly: does it support the thesis, cover the outline, cite the listed sources without fabrication? Reply JSON: {\"status\":\"VERIFIED|NEEDS REVIEW\",\"note\":\"...\"}. Be strict; missing evidence or fabricated-looking support MUST be NEEDS REVIEW." },
      {
        role: "user",
        content: `Thesis: ${plan.thesis ?? ""}\nOutline: ${outline.map((o) => o.title).join(" ; ")}\nSources: ${(plan.sources ?? []).map((s: SourceRow) => `[${s.label}] ${s.title}`).join(" ; ") || "(none)"}\n\nEssay:\n${assembled.slice(0, 12000)}`,
      },
    ], { temperature: 0, maxTokens: 300, jsonMode: true });
    const parsed = parseJsonLoose<{ status?: string; note?: string }>(verdict);
    finalVerification = {
      status: parsed?.status === "VERIFIED" ? "VERIFIED" : "NEEDS REVIEW",
      note: parsed?.note ?? "The verifier could not produce a confident verdict — NEEDS REVIEW by default.",
    };
  }

  const { error } = await supabase
    .from("essay_sessions")
    .update({
      sections: newRows,
      stage: drafted ? "paced_presentation" : "section_drafts",
      status: drafted ? "verified" : "drafting",
      final_verification: finalVerification,
      updated_date: new Date().toISOString(),
    })
    .eq("id", session.id)
    .eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Could not save the section." }, { status: 500 });

  return NextResponse.json({
    data: {
      section: { id: sectionId, title: section.title, draft: draftText, audits },
      draftedCount: newRows.filter((r) => r.draft).length,
      totalSections: outline.length,
      allDrafted: drafted,
      finalVerification,
    },
  });
}

/** PATCH /api/essay/draft-section — approve or edit the outline (gate). */
export async function PATCH(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: { session_id?: string; outline?: OutlineSection[]; approved?: boolean };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.session_id) return NextResponse.json({ error: "session_id required." }, { status: 400 });

  const update: Record<string, unknown> = { updated_date: new Date().toISOString() };
  if (Array.isArray(body.outline) && body.outline.length > 0) {
    update.outline = body.outline;
    update.plan = undefined; // keep plan; outline replaced below
  }
  if (body.approved === true) {
    update.outline_approved = true;
    update.status = "drafting";
    update.stage = "section_drafts";
  } else {
    update.outline_approved = false;
    update.status = "awaiting_outline_approval";
  }
  delete update.plan;

  const { data, error } = await supabase
    .from("essay_sessions")
    .update(update)
    .eq("id", body.session_id)
    .eq("user_id", user.id)
    .select("id, outline, outline_approved")
    .single();
  if (error) return NextResponse.json({ error: "Could not update the outline." }, { status: 500 });
  return NextResponse.json({ data });
}

interface EvidenceRow { label: string; sourceTitle: string; passage: string }
interface TeacherRow { requirement: string }
interface SourceRow { label: string; title: string }

function splitDraftAndAudits(raw: string): { text: string; audits: SectionRow["audits"] } {
  const marker = raw.lastIndexOf("{");
  if (marker >= 0) {
    const tail = raw.slice(marker);
    const parsed = parseJsonLoose<{ citation_audit?: string; rubric_audit?: string; style_audit?: string }>(tail);
    if (parsed && (parsed.citation_audit || parsed.rubric_audit || parsed.style_audit)) {
      return {
        text: raw.slice(0, marker).trim(),
        audits: {
          citation: parsed.citation_audit ?? "citation audit not produced",
          rubric: parsed.rubric_audit ?? "rubric audit not produced",
          style: parsed.style_audit ?? "style audit not produced",
        },
      };
    }
  }
  return { text: raw.trim(), audits: { citation: "citation audit not produced", rubric: "rubric audit not produced", style: "style audit not produced" } };
}
