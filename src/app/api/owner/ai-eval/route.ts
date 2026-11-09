import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { AiNotConfiguredError, aiChat, aiConfigured } from "@/lib/ai/client";
import { EVAL_CASES, compareReports, runEvalSuite } from "@/lib/ai/eval";
import { readAiEnv } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

/**
 * Owner-only model evaluation (Phase 1).
 *
 * Runs the fixed eval suite through the SAME provider chain students are served
 * by, and reports the score per case with the exact reasons. This is how "which
 * model should we use" gets an evidence-based answer instead of an opinion.
 *
 * Guard rails:
 *  - a fixed, small number of cases (4) so a check cannot run up a bill; it also
 *    refuses when no provider is configured,
 *  - temperature 0 and 300 output tokens per case, so results are comparable
 *    run to run,
 *  - the report is returned to the owner only, and never stored with the model
 *    output verbatim,
 *  - failures are reported as failures: an unreachable provider scores 0 and
 *    says so, it is not skipped or hidden.
 */
async function guard() {
  const supabase = createClient();
  const user = await requireUser(supabase);
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (profile?.role !== "owner") return { error: NextResponse.json({ error: "Owner only." }, { status: 403 }) };
  return { user };
}

export async function GET() {
  const g = await guard();
  if (g.error) return g.error;
  return NextResponse.json({
    data: {
      cases: EVAL_CASES.map((c) => ({ id: c.id, kind: c.kind, prompt: c.prompt })),
      configured: aiConfigured(),
      note: "Run the evaluation to score the model Sophira is actually using.",
    },
  });
}

export async function POST() {
  const g = await guard();
  if (g.error) return g.error;

  if (!aiConfigured()) {
    return NextResponse.json(
      { error: "No AI provider is configured, so there is nothing to evaluate. Point Sophira at your local model or add a provider key." },
      { status: 501 }
    );
  }

  const env = readAiEnv();
  const label = `${env.AI_PROVIDER === "auto" ? "auto" : env.AI_PROVIDER}:${env.LOCAL_LLM_MODEL || env.GEMINI_MODEL || env.SOPHIRA_MODEL}`;

  let providerProblem: string | null = null;

  const chat = async (prompt: string): Promise<string> => {
    try {
      return await aiChat(
        [
          { role: "system", content: "You are Sophira. Follow the instruction exactly and never invent a source." },
          { role: "user", content: prompt },
        ],
        { temperature: 0, maxTokens: 300 }
      );
    } catch (e) {
      if (e instanceof AiNotConfiguredError) {
        providerProblem = "The configured provider could not be reached.";
        throw new Error("provider unreachable");
      }
      providerProblem = e instanceof Error ? e.message : String(e);
      throw e;
    }
  };

  const report = await runEvalSuite(label, chat);
  const comparison = compareReports([report]);

  return NextResponse.json({
    data: {
      report,
      comparison,
      providerProblem,
      note:
        "Each case is scored mechanically: a grounded answer must name the source's facts, a question the source cannot answer must be refused, JSON must parse, and a citation must exist in the source. Nothing is graded by the model itself.",
      costNote: `This ran ${report.total} short requests at temperature 0.`,
    },
  });
}
