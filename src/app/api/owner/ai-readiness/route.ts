import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { readAiEnv, selfhostChat, selfhostRuntime } from "@/lib/ai/provider";
import { assessReadiness, probeFailureReason, suggestModel, type HardwareFacts } from "@/lib/ai/readiness";
import { aiBreakers, breakerKey } from "@/lib/ai/reliability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Owner-only self-hosted AI readiness check (Phase 1).
 *
 * GET  : report what is known without spending time on a generation.
 * POST : measure for real - one small generation is timed, and the result is
 *        what the verdict is based on.
 *
 * Why a real generation instead of a ping: a server that answers /v1/models can
 * still take 40 seconds to produce the first word. Only a timed generation says
 * whether a student will be kept waiting.
 *
 * Safety: read-only with respect to data, never writes a transcript or a note,
 * uses at most 24 output tokens, and never returns a key or full endpoint URL.
 */
async function guard() {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) return { error: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (profile?.role !== "owner") return { error: NextResponse.json({ error: "Owner only." }, { status: 403 }) };
  return { user };
}

function safeHost(url?: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export async function GET() {
  const g = await guard();
  if (g.error) return g.error;

  const env = readAiEnv();
  if (!env.LOCAL_LLM_BASE_URL) {
    return NextResponse.json({
      data: {
        configured: false,
        measured: false,
        verdict: {
          level: "unknown",
          headline: "No local model server is configured",
          detail: "Sophira has no LOCAL_LLM_BASE_URL set, so there is nothing to measure. Everything else in the app works.",
          estimatedMemoryGb: null,
          action: "Point LOCAL_LLM_BASE_URL at your Ollama/vLLM server to run with no cloud bill.",
        },
      },
    });
  }

  const runtime = await selfhostRuntime(env);
  const breaker = aiBreakers.snapshot(breakerKey("selfhost", env.LOCAL_LLM_BASE_URL));
  return NextResponse.json({
    data: {
      configured: true,
      measured: false,
      endpointHost: safeHost(env.LOCAL_LLM_BASE_URL),
      model: env.LOCAL_LLM_MODEL,
      runtime: runtime.runtime,
      reachable: runtime.available,
      reason: runtime.reason,
      breakerState: breaker.state,
      verdict: assessReadiness({
        modelName: env.LOCAL_LLM_MODEL,
        hardware: { availableRamGb: null, hasGpu: null, tokensPerSecond: null, firstTokenMs: null },
      }),
      note: "Nothing has been timed yet. Run the check to measure real speed.",
    },
  });
}

export async function POST() {
  const g = await guard();
  if (g.error) return g.error;

  const env = readAiEnv();
  if (!env.LOCAL_LLM_BASE_URL) {
    return NextResponse.json(
      { error: "No local model server is configured, so there is nothing to measure." },
      { status: 400 }
    );
  }

  const runtime = await selfhostRuntime(env);
  if (!runtime.available) {
    return NextResponse.json({
      data: {
        configured: true,
        measured: false,
        reachable: false,
        runtime: runtime.runtime,
        reason: runtime.reason,
        verdict: assessReadiness({
          modelName: env.LOCAL_LLM_MODEL,
          hardware: { availableRamGb: null, hasGpu: null, tokensPerSecond: null, firstTokenMs: null },
        }),
      },
    });
  }

  const started = Date.now();
  let text = "";
  let failure: { status?: number; message?: string } | null = null;
  try {
    const r = await selfhostChat(
      env,
      [
        { role: "system", content: "Answer with one short sentence." },
        { role: "user", content: "Name the four phases of mitosis in order, briefly." },
      ],
      { temperature: 0, maxTokens: 24 }
    );
    text = r.text ?? "";
  } catch (e) {
    failure = { message: e instanceof Error ? e.message : String(e) };
  }
  const elapsedMs = Date.now() - started;

  if (failure) {
    return NextResponse.json({
      data: {
        configured: true,
        measured: false,
        reachable: true,
        reason: probeFailureReason(failure),
        elapsedMs,
        verdict: assessReadiness({
          modelName: env.LOCAL_LLM_MODEL,
          hardware: { availableRamGb: null, hasGpu: null, tokensPerSecond: null, firstTokenMs: null },
        }),
      },
    });
  }

  // Honest throughput: the reply length is the only observation we have, so the
  // rate is computed from the words actually returned and labelled approximate.
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const approxTokens = Math.max(1, Math.round(words * 1.35));
  const tokensPerSecond = elapsedMs > 0 ? Math.round((approxTokens / (elapsedMs / 1000)) * 10) / 10 : 0;

  const hardware: HardwareFacts = {
    availableRamGb: null,
    hasGpu: null,
    tokensPerSecond,
    firstTokenMs: elapsedMs,
  };
  const verdict = assessReadiness({ modelName: env.LOCAL_LLM_MODEL, hardware });
  const suggestion = suggestModel(8, false);

  return NextResponse.json({
    data: {
      configured: true,
      measured: true,
      reachable: true,
      endpointHost: safeHost(env.LOCAL_LLM_BASE_URL),
      model: env.LOCAL_LLM_MODEL,
      runtime: runtime.runtime,
      elapsedMs,
      approxTokens,
      tokensPerSecond,
      answerPreview: text.slice(0, 160),
      verdict,
      note: "Speed is measured from one short answer, so treat it as approximate rather than a benchmark.",
      sizingHint: {
        model: suggestion.model,
        reason: suggestion.reason,
        caveat: "If Sophira does not know how much memory this machine has, this assumes 8 GB as a common minimum.",
      },
    },
  });
}
