/**
 * AI runtime health (2026-10-06): GET /api/ai/health
 *
 * Reports whether an AI runtime is reachable and which one, WITHOUT any
 * secrets, keys, or endpoint URLs (the endpoint host could be private).
 * The frontend can use this to show a useful AI status indicator.
 *
 * available=false is honest: Sophira never fakes a working AI and never
 * silently falls back to a paid cloud provider when the local runtime is
 * down — non-AI features keep working and the UI shows the reason.
 */
import { NextResponse } from "next/server";
import { readAiEnv, resolveProviders, selfhostRuntime, costClassOf } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = readAiEnv();
  const plan = resolveProviders(env);
  const first = plan.candidates[0] ?? null;

  // Live probe of the self-hosted runtime (the default path).
  const probe = await selfhostRuntime(env);

  if (first === "selfhost") {
    return NextResponse.json(
      probe.available
        ? {
            available: true,
            provider: "selfhost",
            model: env.LOCAL_LLM_MODEL,
            runtime: probe.runtime,
            classification: costClassOf("selfhost"),
          }
        : {
            available: false,
            provider: "selfhost",
            model: env.LOCAL_LLM_MODEL,
            runtime: probe.runtime,
            reason: probe.reason || "Local inference server unavailable",
          }
    );
  }

  if (first) {
    // A configured cloud path is active (free-tier Gemini, or explicitly
    // allowed paid). Self-hosted remains available to switch to at any time.
    return NextResponse.json({
      available: true,
      provider: first,
      model: first === "gemini" ? env.GEMINI_MODEL : env.SOPHIRA_MODEL,
      runtime: first === "gemini" ? "gemini-api" : "openai-api",
      classification: costClassOf(first),
      ...(env.LOCAL_LLM_BASE_URL && probe.available ? { selfhostAlsoAvailable: true } : {}),
    });
  }

  return NextResponse.json({
    available: false,
    provider: "local",
    runtime: "on-device",
    reason:
      plan.reasons.local ||
      plan.reasons.selfhost ||
      "No AI runtime is configured — self-hosted AI is the default path: set LOCAL_LLM_BASE_URL (see docs/SELF_HOSTED_AI_ARCHITECTURE.md), or use Offline mode's on-device model. No paid API is required.",
  });
}
