import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AiNotConfiguredError, aiChat, aiConfigured, parseJsonLoose } from "@/lib/ai/client";

export const runtime = "nodejs";
export const maxDuration = 300;

const DOC_KINDS = ["official", "rubric", "example", "correction"] as const;
type DocKind = (typeof DOC_KINDS)[number];

const KIND_PROMPT: Record<DocKind, string> = {
  official: "This is an official instruction document supplied by the teacher (syllabus, instructions sheet, formatting rules). Extract the teacher's requirements.",
  rubric: "This is a rubric or grading criteria document. Extract what the teacher rewards and penalizes, as requirements.",
  example: "This is a teacher-provided worked example. Infer the method, notation, step structure, and level of detail the teacher demonstrates — label inferred items, do not present them as quoted rules.",
  correction: "This is feedback or corrections the teacher gave on graded work. Convert it into concrete requirements for future work. Only include what the feedback actually supports.",
};

const FIELDS = [
  "required_methods", "required_steps", "preferred_notation", "units_sig_figs",
  "formatting_requirements", "citation_requirements", "essay_structure",
  "lab_report_requirements", "preferred_terminology", "show_work_rules",
  "calculator_rules", "allowed_tools", "prohibited_tools",
] as const;

/**
 * Extracts structured teacher requirements from a pasted document.
 * Creates a PENDING proposal — nothing changes until the student approves it.
 */
export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "AI is not configured yet. An administrator needs to set the OPENAI_API_KEY environment variable. Your document text is preserved on this screen." },
      { status: 503 }
    );
  }

  let body: { teacher_id?: string; kind?: DocKind; title?: string; content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const teacher_id = body.teacher_id;
  const kind = DOC_KINDS.includes(body.kind as DocKind) ? (body.kind as DocKind) : null;
  const title = (body.title || "").trim();
  const content = (body.content || "").trim();

  if (!teacher_id) return NextResponse.json({ error: "Missing teacher." }, { status: 400 });
  if (!kind) return NextResponse.json({ error: "Choose what kind of document this is." }, { status: 400 });
  if (content.length < 30) {
    return NextResponse.json({ error: "Please paste more of the document (at least 30 characters) so I have something to work with." }, { status: 400 });
  }
  if (content.length > 30000) {
    return NextResponse.json({ error: "That's a long document. Please paste the most relevant section (up to 30,000 characters)." }, { status: 413 });
  }

  const { data: teacher } = await supabase.from("teachers").select("id, name").eq("id", teacher_id).single();
  if (!teacher) return NextResponse.json({ error: "Teacher not found." }, { status: 404 });

  let rules: Partial<Record<(typeof FIELDS)[number], string>> | null = null;
  try {
    const raw = await aiChat(
      [
        {
          role: "system",
          content: `You extract structured teaching requirements from course documents, for a private academic assistant. HONESTY: only record requirements actually supported by the document. If the document does not mention something, use the empty string — never guess. Respond only with JSON: {"required_methods":"","required_steps":"","preferred_notation":"","units_sig_figs":"","formatting_requirements":"","citation_requirements":"","essay_structure":"","lab_report_requirements":"","preferred_terminology":"","show_work_rules":"","calculator_rules":"","allowed_tools":"","prohibited_tools":""} (each value a concise English sentence, or "" if not supported).`,
        },
        {
          role: "user",
          content: `${KIND_PROMPT[kind]}\n\nTeacher: ${teacher.name}\nDocument title: ${title || "(untitled)"}\n\nDOCUMENT:\n${content}`,
        },
      ],
      { temperature: 0.1, maxTokens: 1500, jsonMode: true }
    );
    const parsed = parseJsonLoose<Record<string, unknown>>(raw);
    if (parsed) {
      rules = {};
      for (const f of FIELDS) {
        const v = parsed[f];
        rules[f] = typeof v === "string" ? v.trim() : "";
      }
    }
  } catch (err) {
    if (err instanceof AiNotConfiguredError) return NextResponse.json({ error: err.message }, { status: 503 });
    return NextResponse.json({ error: err instanceof Error ? err.message : "The extraction failed. Your document text is preserved — please try again." }, { status: 502 });
  }

  const proposedChanges: Record<string, string> = {};
  if (rules) {
    for (const f of FIELDS) {
      const v = rules[f];
      if (v) proposedChanges[f] = v;
    }
  }
  if (Object.keys(proposedChanges).length === 0) {
    return NextResponse.json({
      data: { proposal_id: null, message: "I could not identify concrete teacher requirements in this document. You can still save it as reference material, and edit the teacher profile manually." },
    });
  }

  // Find or create the teacher profile row.
  const { data: tp } = await supabase.from("teacher_profiles").select("id").eq("teacher_id", teacher_id).single();
  let profileId = tp?.id;
  if (!profileId) {
    const { data: created, error: cErr } = await supabase
      .from("teacher_profiles")
      .insert({ user_id: user.id, teacher_id })
      .select("id")
      .single();
    if (cErr) return NextResponse.json({ error: "Could not create the teacher profile: " + cErr.message }, { status: 500 });
    profileId = created.id;
  }

  const { data: proposal, error: pErr } = await supabase
    .from("profile_update_proposals")
    .insert({
      user_id: user.id,
      target_type: "teacher",
      target_id: profileId,
      change_summary: `Requirements extracted from "${title || "untitled document"}" (${kind})`,
      proposed_changes: proposedChanges,
      context: { kind, source_title: title, doc_excerpt: content.slice(0, 500) },
      status: "pending",
    })
    .select("id")
    .single();
  if (pErr) return NextResponse.json({ error: "Could not save the proposal. Please try again." }, { status: 500 });

  return NextResponse.json({ data: { proposal_id: proposal.id, fields: Object.keys(proposedChanges) } });
}
