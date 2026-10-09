import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { runMathPipeline, type MathPipelineResult } from "@/lib/math/pipeline";
import { aiChat, aiConfigured, parseJsonLoose } from "@/lib/ai/client";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/math/solve — the image-to-solution pipeline (2026-10-06).
 *
 * Body:
 *   { image_data_url: string, rotation?: number, confirmed_expression?: string | null }
 *   { expression: string }   — typed/re-confirmed text path
 *
 * Flow: preprocess (client canvas: crop/rotate/deskew recorded) → detect →
 * OCR (vision model transcribes ONLY — never solves) → reconstruct →
 * display + confirm → deterministic solve (mathjs) → AI explains the
 * deterministic steps → teacher method → INDEPENDENT deterministic
 * verification. The result separately tracks recognized input, solution,
 * explanation, verification. Failure is marked NEEDS REVIEW, never hidden.
 */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

async function visionOcr(dataUrl: string): Promise<{ text: string; confidence: number; notes: string[] }> {
  if (dataUrl.length > MAX_IMAGE_BYTES * 1.4) throw new Error("image too large (max 8MB)");
  const prompt = [
    "You are a math OCR transcriber. Transcribe the mathematical expression in this image EXACTLY as written.",
    "Rules:",
    "- Transcribe ONLY what is visible. Never solve, never simplify, never correct.",
    "- Use plain ASCII math: ^ for exponents, sqrt(...) for roots, / for fractions, * for multiplication, = for equals.",
    "- Use unicode → ASCII: x² → x^2, √9 → sqrt(9), ÷ → /, × → *.",
    "- For systems, put each equation on its own line.",
    '- Reply with JSON only: {"expression": "...", "confidence": 0.0-1.0, "notes": ["..."]} where confidence is your honest transcription confidence.',
  ].join("\n");
  const raw = await aiChat(
    [{ role: "user", content: prompt }],
    { images: [dataUrl], temperature: 0, maxTokens: 400, jsonMode: true }
  );
  const parsed = parseJsonLoose<{ expression?: string; confidence?: number; notes?: string[] }>(raw);
  return {
    text: parsed?.expression ?? "",
    confidence: typeof parsed?.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    notes: parsed?.notes ?? [],
  };
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  const { user } = guard.data;

  let body: { image_data_url?: string; rotation?: number; confirmed_expression?: string | null; expression?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // teacher-specific method (step 11): reuse the existing compliance system
  let teacherProfile: { status: string; notes: string | null } | null = null;
  try {
    const { data: tp } = await supabase
      .from("typing_profiles")
      .select("method_compliance")
      .eq("user_id", user.id)
      .maybeSingle();
    teacherProfile = tp?.method_compliance ?? null;
  } catch { teacherProfile = null; }

  try {
    if (body.expression) {
      // typed/confirmed path — the user already corrected it (step 8 done)
      const result = await runMathPipeline({ width: 0, height: 0, grayscale: new Uint8Array(0) }, {
        ocr: async () => ({ text: body.expression!, confidence: 1, engine: "deterministic", notes: ["typed by the user (or confirmed by the user)"] }),
        alreadyConfirmed: true,
        preprocess: { cropped: false, rotationDegrees: 0, deskewDegrees: 0, method: "none" },
        explain: aiConfigured() ? (sol, rec) => explainWithAi(sol, rec, body.mode) : undefined,
        applyTeacherMethod: applyTeacherMethod(teacherProfile),
      });
      return NextResponse.json({ result });
    }

    if (!body.image_data_url?.startsWith("data:image/")) {
      return NextResponse.json({ error: "Provide image_data_url (from Scan Problem) or expression." }, { status: 400 });
    }
    if (!aiConfigured()) {
      return NextResponse.json({ error: "OCR requires the AI vision model, which is not configured. Type the expression instead — the solver and verifier are fully deterministic either way." }, { status: 503 });
    }

    // the client records the crop/rotate/deskew it applied (step 3)
    const rotation = Number(body.rotation ?? 0);

    const ocr = await visionOcr(body.image_data_url);
    const result: MathPipelineResult = await runMathPipeline(
      { width: 0, height: 0, grayscale: new Uint8Array(0) },
      {
        ocr: async () => ({ text: ocr.text, confidence: ocr.confidence, engine: "vision-llm", notes: ocr.notes }),
        confirmedExpression: body.confirmed_expression ?? null,
        preprocess: { cropped: true, rotationDegrees: rotation, deskewDegrees: 0, method: "canvas" },
        explain: aiConfigured() ? (sol, rec) => explainWithAi(sol, rec, body.mode) : undefined,
        applyTeacherMethod: applyTeacherMethod(teacherProfile),
      }
    );
    return NextResponse.json({ result, ocrConfidence: ocr.confidence });
  } catch (err) {
    // fail honestly — never a fake answer
    return NextResponse.json({
      result: null,
      error: `The pipeline failed: ${(err as Error).message}. Nothing was guessed — try re-scanning or typing the problem.`,
    }, { status: 500 });
  }
}

async function explainWithAi(solution: { kind: string; finalAnswer: string; steps: { text: string; expr?: string }[] }, recognized: { expression: string }, mode?: string): Promise<string> {
  const teachMode = mode === "teach";
  const stepList = solution.steps.map((s, i) => `${i + 1}. ${s.text}${s.expr ? ` — ${s.expr}` : ""}`).join("\n");
  const raw = await aiChat(
    [
      {
        role: "system",
        content: [
          "You explain mathematics to a student.",
          "The solution steps and the final answer are ALREADY computed and verified by a deterministic engine — they are given to you and are final. You must not change, recompute, or contradict any number in them.",
          "Explain WHY each step works, in friendly plain language, at high-school level.",
          teachMode
            ? "TEACH MODE: this student asked to be TAUGHT, not just shown. Identify the underlying concept and method by name, explain WHY the method works (not just the steps), and end with a section called 'Try it yourself next time' with two short hints for recognizing when to use this method — without giving away any new answer."
            : "",
        ].join(" "),
      },
      {
        role: "user",
        content: `Problem: ${recognized.expression}\n\nDeterministic steps (do not alter):\n${stepList}\n\nFinal answer (do not alter): ${solution.finalAnswer}`,
      },
    ],
    { temperature: 0.3, maxTokens: 700 }
  );
  return raw.trim();
}

function applyTeacherMethod(teacherProfile: { status: string; notes: string | null } | null) {
  return (solution: { solved: boolean; kind: string; finalAnswer: string; steps: { text: string; expr?: string }[] }) => {
    if (!teacherProfile) return { applied: false, note: "no teacher method profile loaded — generic method shown" };
    const compliant = teacherProfile.status === "compliant";
    const missing: string[] = [];
    const notes = (teacherProfile.notes ?? "").toLowerCase();
    if (notes.includes("show") && !solution.steps.some((s) => /substitut|divide|subtract|apply/i.test(s.text))) missing.push("show all intermediate steps");
    if (notes.includes("unit") && !/\b(unit|cm|m|in|ft)\b/i.test(solution.finalAnswer)) missing.push("include units in the answer");
    return {
      applied: true,
      note: compliant && missing.length === 0
        ? "teacher-specific method constraints satisfied"
        : `teacher method check: ${missing.length ? "the solution may be missing: " + missing.join("; ") : "profile applied"}`,
    };
  };
}
