import { searchProviderConfigured } from "../../../lib/research/provider";
import { healthConfiguration } from "../../../lib/env";

export const dynamic = "force-dynamic";

/**
 * Liveness + deployment-configuration readiness.
 *
 * This endpoint is matcher-excluded from the auth middleware and must work
 * in a DEGRADED deployment (no Supabase/AI/search env) — that is exactly the
 * state it exists to diagnose. It reports WHICH capabilities are configured
 * (booleans only — never values, never provider names or URLs), so an
 * operator can verify a production deployment in one curl, per
 * docs/RELEASE_PROCESS.md. This closes the §27 gap: a misconfigured
 * production environment was previously indistinguishable from a healthy
 * one until a user hit a 500.
 *
 * The variable definitions live in ONE place — src/config/env.manifest.json
 * via src/lib/env.ts — so this endpoint can never disagree with
 * scripts/verify-deployment.mjs or .env.example about what "configured"
 * means. `ai` = a remote AI credential is present (free-first: GEMINI counts,
 * OPENAI counts; paid usage is gated separately by ALLOW_PAID_AI /
 * MONTHLY_AI_BUDGET_USD in src/lib/ai/provider.ts).
 */
export async function GET() {
  return Response.json({
    ok: true,
    name: "sophira",
    configuration: {
      ...healthConfiguration(),
      search: searchProviderConfigured(),
    },
  });
}
