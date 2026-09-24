import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { AiNotConfiguredError, aiChat, aiConfigured, parseJsonLoose } from "@/lib/ai/client";
import {
  buildClassificationPrompt,
  buildSystemPrompt,
  type TaskClassification,
} from "@/lib/ai/client";
import { composeAcademicContext, wrapUntrusted, detectInjectionAttempt } from "@/lib/ai/context";
import { routeSubject } from "@/lib/ai/subjects";
import { runMachineChecks } from "@/lib/ai/mathverify";
import { MODE_MAP } from "@/lib/modes";
import type { Mode } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

interface SolveBody {
  assignment_id?: string | null;
  session_id?: string | null;
  mode?: Mode;
  question?: string;
  title?: string;
  course_id?: string | null;
  teacher_id?: string | null;
  output_type?: string | null;
  custom_instructions?: string;
  files?: { file_name: string; extracted_text: string }[];
  images?: string[];
}

const QUESTION_LIMIT = 30000;
const PER_FILE_LIMIT = 12000;

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: SolveBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const question = (body.question || "").trim();
  if (!question) {
    return NextResponse.json({ error: "Please describe what you need help with — your text was preserved, try sending again." }, { status: 400 });
  }
  if (question.length > QUESTION_LIMIT) {
    return NextResponse.json({ error: `That's ${question.length.toLocaleString()} characters. Please keep requests under ${QUESTION_LIMIT.toLocaleString()} characters (split long assignments into parts).` }, { status: 413 });
  }

  let mode: Mode = "assignment";
  if (body.mode && MODE_MAP[body.mode]) mode = body.mode;

  // --- Load student profile -------------------------------------------------
  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) {
    return NextResponse.json({ error: "Your profile is missing. Please sign out and sign back in, then try again." }, { status: 500 });
  }

  // --- Load course / teacher context ---------------------------------------
  let course = null;
  let teacherName: string | null = null;
  let teacherProfile = null;

  if (body.course_id || body.teacher_id || body.assignment_id) {
    if (body.assignment_id) {
      const { data: a } = await supabase.from("assignments").select("*").eq("id", body.assignment_id).single();
      if (a) {
        if (!body.course_id) body.course_id = a.course_id;
        if (!body.teacher_id) body.teacher_id = a.teacher_id;
      }
    }
    if (body.course_id) {
      const { data: c } = await supabase.from("courses").select("*").eq("id", body.course_id).single();
      if (c) course = c;
      if (!body.teacher_id && c?.teacher_id) body.teacher_id = c.teacher_id;
    }
    if (body.teacher_id) {
      const { data: t } = await supabase.from("teachers").select("name").eq("id", body.teacher_id).single();
      teacherName = t?.name ?? null;
      const { data: tp } = await supabase.from("teacher_profiles").select("*").eq("teacher_id", body.teacher_id).single();
      if (tp) teacherProfile = tp;
    }
  }

  const files = (body.files || [])
    .map((f) => ({ file_name: f.file_name, extracted_text: (f.extracted_text || "").slice(0, PER_FILE_LIMIT) }))
    .slice(0, 6);
  const images = (body.images || []).slice(0, 4);

  // --- Stage 1: classify subject / level / task type -------------------------
  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "AI is not configured yet. An administrator needs to set the OPENAI_API_KEY environment variable. Nothing was lost — your text is still on this screen." },
      { status: 503 }
    );
  }

  let classification: TaskClassification | null = null;
  try {
    const raw = await aiChat(
      [
        { role: "system", content: "You classify academic requests. Respond only with JSON." },
        { role: "user", content: buildClassificationPrompt(question, files.map((f) => f.extracted_text)) },
      ],
      { temperature: 0, maxTokens: 400, jsonMode: true, images }
    );
    const parsed = parseJsonLoose<TaskClassification>(raw);
    if (parsed && typeof parsed.is_writing_task === "boolean") classification = parsed;
  } catch {
    classification = null; // classification is an enhancement; solve still proceeds honestly
  }

  const isWritingTask = classification ? classification.is_writing_task : mode === "writing";

  // --- Stage 2: writing profile only if this is a writing task ---------------
  let writingProfile = null;
  if (isWritingTask) {
    const { data: wp } = await supabase.from("writing_profiles").select("*").order("created_at", { ascending: false }).limit(1);
    writingProfile = wp?.[0] ?? null;
  }

  // --- Stage 3: solve + self-verification in one call -------------------------
  const workflow = routeSubject(classification?.subject ?? course?.subject, classification?.task_type);
  const { systemPrompt, conflicts } = buildSystemPrompt({
    profile, course, teacherName, teacherProfile, writingProfile, mode, isWritingTask,
    subject: classification?.subject ?? null,
    taskType: classification?.task_type ?? null,
  });

  // The exact context that was applied — persisted with the response so the UI
  // can show real backend state (spec §40), never a fabricated badge.
  const composed = composeAcademicContext({
    profile, course, teacherName, teacherProfile, writingProfile, mode, isWritingTask,
    subject: classification?.subject ?? null,
  });
  const contextApplied = {
    ...composed.applied,
    classification: classification
      ? { subject: classification.subject, task_type: classification.task_type, level: classification.academic_level }
      : null,
    conflicts,
    workflow: workflow.id,
  };

  // Prompt-injection defense: uploaded files are wrapped as untrusted data and
  // obvious injection attempts are flagged to the student (never obeyed).
  const injectionWarnings: string[] = [];
  for (const f of files) {
    if (detectInjectionAttempt(f.extracted_text)) {
      injectionWarnings.push(
        `The document "${f.file_name}" contains text that looks like instructions directed at the AI. It was treated as document content only.`
      );
    }
  }

  const userParts: string[] = [];
  if (body.title) userParts.push(`Assignment title: ${body.title}`);
  if (body.output_type) userParts.push(`Requested output type: ${body.output_type}`);
  if (body.custom_instructions?.trim()) userParts.push(`Additional context from the student: ${body.custom_instructions.trim()}`);
  if (files.length) {
    userParts.push(
      "Attached documents (extracted text):\n" +
        files.map((f) => wrapUntrusted(`uploaded file: ${f.file_name}`, f.extracted_text)).join("\n\n")
    );
  }
  userParts.push(`The request:\n${question}`);

  // Prior conversation (for follow-ups / revisions) when continuing a session.
  const history: { role: "user" | "assistant"; content: string }[] = [];
  if (body.session_id) {
    const { data: s } = await supabase.from("work_sessions").select("messages").eq("id", body.session_id).single();
    if (s?.messages && Array.isArray(s.messages)) {
      history.push(...s.messages.slice(-12));
    }
  }

  let content = "";
  let verification: {
    status: "verified" | "needs_verification" | "unverified";
    verification_method?: "computational" | "self_check" | "none";
    checks: { name: string; passed: boolean; detail: string; method?: "computational" | "self_check" }[];
    warnings: string[];
  } = { status: "unverified", verification_method: "none", checks: [], warnings: [] };
  try {
    const raw = await aiChat(
      [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userParts.join("\n\n") },
      ],
      { temperature: 0.4, maxTokens: 4096, jsonMode: true, images }
    );
    const parsed = parseJsonLoose<{
      answer?: string;
      machine_checks?: unknown;
      verification?: { status?: string; checks?: unknown; warnings?: unknown };
    }>(raw);
    if (parsed && typeof parsed.answer === "string" && parsed.answer.trim()) {
      content = parsed.answer;
      const v = parsed.verification || {};
      const selfChecks: { name: string; passed: boolean; detail: string; method?: "computational" | "self_check" }[] = Array.isArray(v.checks)
        ? (v.checks as { name: string; passed: boolean; detail: string }[]).map((c) => ({ ...c, method: "self_check" as const }))
        : [];
      const selfWarnings = Array.isArray(v.warnings) ? v.warnings.filter((w) => typeof w === "string") : [];
      const selfStatus = v.status === "verified" || v.status === "needs_verification" ? v.status : "unverified";

      // --- Independent verification (spec §10) --------------------------------
      // Re-compute the model's claimed arithmetic identities with mathjs — a
      // deterministic engine, not the same language model checking itself.
      let machineResults: { results: { name: string; passed: boolean; method: "computational"; detail: string }[]; allPassed: boolean } = { results: [], allPassed: false };
      if (workflow.machineVerifiable) {
        machineResults = runMachineChecks(parsed.machine_checks);
      }

      verification = {
        status:
          selfStatus === "unverified"
            ? "unverified"
            : machineResults.results.length > 0
              ? machineResults.allPassed && selfStatus !== "needs_verification"
                ? "verified"
                : "needs_verification"
              : selfStatus,
        verification_method: machineResults.results.length > 0 ? "computational" : "self_check",
        checks: [...machineResults.results, ...selfChecks],
        warnings: [...injectionWarnings, ...selfWarnings],
      };
    } else {
      // The model answered but not in the JSON shape — use the raw response,
      // honestly marked unverified rather than pretending a check ran.
      content = raw;
      verification = {
        status: "unverified", verification_method: "none", checks: [],
        warnings: [...injectionWarnings, "The response could not be structured for verification — treat as needs review."],
      };
    }
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 503 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The AI request failed. Your input is preserved on this screen — please try again." },
      { status: 502 }
    );
  }

  // --- Stage 4: persist assignment / session / response -----------------------
  let assignmentId = body.assignment_id || null;
  const derivedTitle = (body.title?.trim()) || question.slice(0, 60) + (question.length > 60 ? "…" : "");
  if (assignmentId) {
    await supabase.from("assignments").update({
      mode,
      subject: classification?.subject ?? undefined,
      academic_level: classification?.academic_level ?? undefined,
      task_type: classification?.task_type ?? undefined,
      updated_at: new Date().toISOString(),
    }).eq("id", assignmentId);
  } else {
    const { data: a, error: aErr } = await supabase.from("assignments").insert({
      user_id: user.id,
      title: derivedTitle,
      course_id: body.course_id || null,
      teacher_id: body.teacher_id || null,
      mode,
      subject: classification?.subject ?? null,
      academic_level: classification?.academic_level ?? null,
      task_type: classification?.task_type ?? null,
      output_type: body.output_type ?? null,
      instructions_text: question,
      status: "active",
    }).select("id").single();
    if (aErr) return NextResponse.json({ error: `Could not save the assignment: ${aErr.message}. Your input is preserved — please try again.` }, { status: 500 });
    assignmentId = a.id;
  }

  let sessionId = body.session_id || null;
  if (sessionId) {
    await supabase.from("work_sessions").update({
      mode,
      messages: [...history, { role: "user" as const, content: question }, { role: "assistant" as const, content }],
      updated_at: new Date().toISOString(),
    }).eq("id", sessionId);
  } else {
    const { data: s, error: sErr } = await supabase.from("work_sessions").insert({
      user_id: user.id,
      assignment_id: assignmentId,
      mode,
      messages: [
        { role: "user", content: question },
        { role: "assistant", content },
      ],
    }).select("id").single();
    if (sErr) {
      sessionId = null; // the response is still returned; session persistence failed honestly
    } else {
      sessionId = s.id;
    }
  }

  const { data: resp, error: rErr } = await supabase.from("responses").insert({
    user_id: user.id,
    assignment_id: assignmentId,
    session_id: sessionId,
    content,
    mode,
    verification,
    context_applied: contextApplied,
    model_used: process.env.SOPHIRA_MODEL || "gpt-4o-mini",
  }).select("id").single();

  return NextResponse.json({
    data: {
      assignment_id: assignmentId,
      session_id: sessionId,
      response_id: rErr ? null : resp.id,
      content,
      verification,
      classification,
      context_applied: contextApplied,
      model_used: process.env.SOPHIRA_MODEL || "gpt-4o-mini",
    },
  });
}
