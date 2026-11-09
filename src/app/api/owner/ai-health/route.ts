import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { aiConfigured, aiModel } from "@/lib/ai/client";
import { readAiEnv, resolveProviders } from "@/lib/ai/provider";
import { aiBreakers, describeBreaker } from "@/lib/ai/reliability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Owner-only AI health (Phase 1).
 *
 * Reports what Sophira actually knows about each AI provider IN THIS PROCESS:
 * whether it is configured, which one would answer a request right now, and the
 * live circuit-breaker state. It never calls a model, so opening this page
 * cannot cost a token or make a slow server feel slower.
 *
 * Honesty rules:
 *  - "not tried yet" is reported as exactly that, never as "healthy",
 *  - a provider that is open-circuit is reported as not responding, with the
 *    real number of consecutive failures and the seconds until the retry,
 *  - breaker state is in-process only, so the response says so when the counters
 *    are empty after a restart,
 *  - no key, URL credential or secret value is ever returned.
 */
export async function GET() {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { profile } = await readProfileWithRepair(supabase, user.id);
  if (profile?.role !== "owner") {
    return NextResponse.json({ error: "Owner only." }, { status: 403 });
  }

  const env = readAiEnv();
  const plan = resolveProviders(env);
  const breakers = aiBreakers.all();
  const providerIds = ["selfhost", "gemini", "openai"] as const;

  const providers = providerIds.map((p) => {
    const keyed = breakers.filter((b) => b.key === p || b.key.startsWith(`${p}@`));
    const worst = keyed.length > 0 ? keyed.find((b) => b.state === "open") ?? keyed[0] : null;
    const health = worst ? describeBreaker(worst) : null;
    return {
      provider: p,
      /** Would this provider be chosen right now? (config + policy, not breaker) */
      eligible: plan.candidates.includes(p),
      /** True only when the breaker would let a request through right now. */
      acceptingRequests: health ? health.ok : true,
      state: health ? health.state : "closed",
      plainEnglish: health ? health.plainEnglish : "Ready, but nothing has been sent to it yet this session.",
      consecutiveFailures: worst ? worst.failures : 0,
      retryInSeconds: worst && worst.msUntilTrial !== null ? Math.ceil(worst.msUntilTrial / 1000) : null,
      lastErrorCode: worst ? worst.lastErrorCode : null,
    };
  });

  const answering = providers.find((p) => p.eligible && p.acceptingRequests);
  const summary = answering
    ? `Sophira would answer with ${answering.provider} right now.`
    : providers.some((p) => p.eligible)
      ? "Every configured AI provider is currently marked as not responding. Sophira will still try the next one on a new request; if this lasts, check that your local model is running."
      : "No AI provider is configured, so Sophira cannot answer with a model. Point it at your local Ollama/vLLM server or add a provider key.";

  return NextResponse.json({
    data: {
      summary,
      configured: aiConfigured(),
      model: aiConfigured() ? aiModel() : null,
      requestedMode: env.AI_PROVIDER,
      candidates: plan.candidates,
      reasons: plan.reasons,
      providers,
      countersNote:
        breakers.length === 0
          ? "No provider has been tried since this server started, so there is nothing to report yet."
          : "Counters cover this server process only; they reset when Sophira restarts.",
    },
  });
}
