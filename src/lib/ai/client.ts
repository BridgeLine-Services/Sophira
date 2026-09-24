import type { Mode } from "./types";
import type { Course, Profile, TeacherProfile, WritingProfile } from "./types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super(
      "The AI service is not configured yet. An administrator needs to set the OPENAI_API_KEY environment variable."
    );
    this.name = "AiNotConfiguredError";
  }
}

export function aiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function aiModel(): string {
  return process.env.SOPHIRA_MODEL || "gpt-4o-mini";
}

/**
 * Calls an OpenAI-compatible chat completions endpoint.
 * SERVER USE ONLY — the API key never reaches the client.
 * opts.images: base64 data URLs attached to the last user message (vision).
 */
export async function aiChat(
  messages: ChatMessage[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean; images?: string[] } = {}
): Promise<string> {
  if (!aiConfigured()) throw new AiNotConfiguredError();

  const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  const finalMessages: { role: "system" | "user" | "assistant"; content: unknown }[] = [...messages];
  if (opts.images && opts.images.length > 0 && finalMessages.length > 0) {
    const last = finalMessages[finalMessages.length - 1];
    if (last.role === "user") {
      last.content = [
        { type: "text", text: String(last.content) },
        ...opts.images.map((dataUrl) => ({ type: "image_url", image_url: { url: dataUrl } })),
      ];
    }
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: aiModel(),
        messages: finalMessages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 4096,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `The AI service returned an error (HTTP ${res.status}). ${body.slice(0, 300)}`
      );
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("The AI service returned an empty response. Please try again.");
    }
    return content;
  } catch (err) {
    if (err instanceof AiNotConfiguredError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("The AI request took too long and was cancelled. Your work was not lost — please try again.");
    }
    if (err instanceof TypeError) {
      throw new Error("Could not reach the AI service. Please check your connection and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Extracts the first JSON object from a model response, tolerating fences. */
export function parseJsonLoose<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export type TaskClassification = {
  subject: string;
  academic_level: string;
  task_type: string;
  is_writing_task: boolean;
  output_type: string;
  confidence: "high" | "medium" | "low";
};

const HONESTY_RULES = `You are Sophira, a private academic assistant. Absolute honesty rules:
- Never invent facts, calculations, citations, quotations, page numbers, sources, data, or personal experiences.
- If something is missing, unreadable, or you are unsure, say so explicitly in your answer and list it under "warnings".
- Never claim you ran code, tested something, or verified a source unless you actually did.
- If instructions conflict, follow this priority: (1) the current assignment's explicit instructions, (2) the course's official rules and rubrics, (3) teacher examples and corrections. If two authoritative instructions conflict, explain the conflict and ask the student how to proceed instead of silently choosing.
- If input is ambiguous or unreadable, ask for clarification instead of guessing.`;

const MODE_INSTRUCTIONS: Record<Mode, string> = {
  learn: "MODE: LEARN. Explain the concept step by step, define important terms, and help the student understand how to solve similar problems themselves. Do not just hand over an answer.",
  assignment: "MODE: ASSIGNMENT. Work the supplied assignment. Follow the teacher's required method and steps exactly, show all required work, and produce an organized response.",
  check: "MODE: CHECK MY WORK. The student's own attempt is supplied. Identify correct steps, errors, missing reasoning, and possible corrections. Be specific and kind; do not rewrite the whole thing unless asked.",
  writing: "MODE: WRITING. Generate or revise writing that follows the assignment requirements and rubric while matching the student's approved Writing Profile where it does not violate the assignment's requirements.",
  study: "MODE: STUDY. Create study material: practice questions, flashcards, a summary, concept review, or exam preparation from the supplied material. Make it self-testable.",
  explain: "MODE: EXPLAIN SIMPLY. Explain the subject in accessible language appropriate to the student's academic level, without removing essential accuracy. Use plain words and concrete analogies.",
  custom: "MODE: CUSTOM. Follow the student's explicit description of what kind of help they want.",
};

export function buildStudentContext(profile: Profile): string {
  const bits: string[] = [];
  if (profile.display_name) bits.push(`Student name: ${profile.display_name}.`);
  bits.push(`Academic level: ${profile.academic_level || "not specified — infer from the question"}.`);
  bits.push(`Explanation level: ${profile.explanation_level || "standard"}.`);
  if (profile.answer_style) bits.push(`Preferred answer style: ${profile.answer_style}.`);
  if (profile.formatting_pref) bits.push(`Preferred formatting: ${profile.formatting_pref}.`);
  if (profile.preferred_language) bits.push(`Preferred language: ${profile.preferred_language}.`);
  return bits.join(" ");
}

export function buildCourseContext(course: Course | null): string {
  if (!course) return "No course selected. This is a general academic question.";
  const bits = [`Course: ${course.name} (subject: ${course.subject || "unspecified"}, level: ${course.academic_level || "unspecified"})`];
  if (course.instructions) bits.push(`Course-specific instructions (authoritative for this course):\n${course.instructions}`);
  return bits.join("\n");
}

export function buildTeacherContext(tp: TeacherProfile | null, teacherName: string | null): string {
  if (!tp) return teacherName ? `Teacher: ${teacherName}. No saved teacher profile yet — use standard conventions and say when you are unsure about teacher-specific requirements.` : "No teacher selected.";
  const bits = [`Teacher: ${teacherName || "unnamed"} — requirements saved by the student (these are AUTHORITATIVE unless the current assignment says otherwise):`];
  const fields: [string, string][] = [
    ["Required solution methods", tp.required_methods],
    ["Required solution steps", tp.required_steps],
    ["Preferred notation", tp.preferred_notation],
    ["Units & significant figures", tp.units_sig_figs],
    ["Formatting requirements", tp.formatting_requirements],
    ["Citation/referencing requirements", tp.citation_requirements],
    ["Essay structure requirements", tp.essay_structure],
    ["Lab report requirements", tp.lab_report_requirements],
    ["Preferred terminology", tp.preferred_terminology],
    ["Rules about showing work", tp.show_work_rules],
    ["Calculator restrictions", tp.calculator_rules],
    ["Allowed tools", tp.allowed_tools],
    ["Prohibited tools", tp.prohibited_tools],
  ];
  for (const [label, val] of fields) {
    if (val && val.trim()) bits.push(`- ${label}: ${val.trim()}`);
  }
  const doc = (label: string, docs: { title: string; content: string; source?: string }[]) => {
    const withContent = (docs || []).filter((d) => d.content && d.content.trim());
    if (withContent.length) {
      bits.push(`${label} (from teacher materials):`);
      for (const d of withContent) bits.push(`--- ${d.title}${d.source ? ` (source: ${d.source})` : ""} ---\n${d.content.slice(0, 3000)}`);
    }
  };
  doc("Official instructions", tp.official_instructions);
  doc("Rubrics and grading criteria", tp.rubrics);
  doc("Teacher-provided worked examples (mimic their method, notation, and level of detail)", tp.examples);
  doc("Corrections and feedback from graded work (learn what this teacher wants)", tp.corrections);
  if (tp.ai_notes && tp.ai_notes.length) {
    bits.push("Unconfirmed AI-generated interpretations (NOT official requirements — use only as hints, and say when you rely on them):");
    for (const n of tp.ai_notes) bits.push(`- ${n.note}: ${n.proposed} (${n.status})`);
  }
  return bits.join("\n");
}

export function buildWritingContext(wp: WritingProfile | null): string {
  if (!wp || wp.status !== "approved" || !wp.guidance) {
    return "Writing Profile: none approved yet. Do not imitate any assumed style — write in a clear, natural voice appropriate to the assignment, and tell the student they can approve a Writing Profile to personalize writing.";
  }
  return `The student's approved Writing Profile (their OWN voice — apply it where it does not violate the assignment's requirements):\n${wp.guidance}\nIMPORTANT: the assignment's requirements, rubric, and required format ALWAYS take precedence over the student's personal style. Preserve the student's recognizable voice only where appropriate.`;
}

export function buildSystemPrompt(args: {
  profile: Profile;
  course: Course | null;
  teacherName: string | null;
  teacherProfile: TeacherProfile | null;
  writingProfile: WritingProfile | null;
  mode: Mode;
  isWritingTask: boolean;
}): string {
  const { profile, course, teacherName, teacherProfile, writingProfile, mode, isWritingTask } = args;
  const parts = [HONESTY_RULES, MODE_INSTRUCTIONS[mode]];
  parts.push(`Student profile: ${buildStudentContext(profile)}`);
  parts.push(buildCourseContext(course));
  parts.push(buildTeacherContext(teacherProfile, teacherName));
  if (isWritingTask) {
    parts.push(buildWritingContext(writingProfile));
  } else {
    parts.push("This is NOT a writing-style task, so the student's Writing Profile is intentionally not being applied.");
  }
  parts.push(`Format your final answer in clean Markdown (headings, lists, LaTeX-free plain math notation like x^2, tables where helpful). Respond ONLY with a JSON object of the form:
{
  "answer": "<your full answer in Markdown>",
  "verification": {
    "status": "verified" | "needs_verification" | "unverified",
    "checks": [{"name": "<check>", "passed": true|false, "detail": "<what you actually checked and how>"}],
    "warnings": ["<anything uncertain, unverified, or the student should double-check>"]
  }
}
Verification is a SELF-CHECK, not a guarantee: honestly record which of these you were able to check — every question/subquestion addressed, teacher's required method followed, calculations consistent, units and notation correct, rubric satisfied, word count/format met, sources real and available, no unsupported assumptions, no contradictions. Use "needs_verification" whenever any check fails or cannot be performed. Do NOT claim a check passed unless you genuinely performed it. In math, verify the result with an independent method when practical and record that in checks.`);
  return parts.join("\n\n");
}

export function buildClassificationPrompt(question: string, fileTexts: string[]): string {
  const files = fileTexts.length
    ? `\n\nAttached document extracts:\n${fileTexts.map((t, i) => `--- Document ${i + 1} (first 2000 chars) ---\n${t.slice(0, 2000)}`).join("\n")}`
    : "";
  return `Classify this academic request. Respond ONLY with JSON:
{
  "subject": "<subject, e.g. calculus, physics, US history, literature>",
  "academic_level": "<e.g. elementary, middle school, high school, college, graduate, PhD; use "unspecified" if truly unclear>",
  "task_type": "<e.g. problem set, essay, lab report, discussion post, short answer, research, concept explanation>",
  "is_writing_task": <true only if producing/revising prose writing such as an essay, reflection, discussion post, report>,
  "output_type": "<e.g. solution with steps, essay draft, explanation, study guide, review>",
  "confidence": "high" | "medium" | "low"
}
If the request is ambiguous or unreadable, set confidence to "low" and explain nothing — just the JSON.

STUDENT REQUEST:
${question}${files}`;
}
