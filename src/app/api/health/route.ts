import { searchProviderConfigured } from "../../../lib/research/provider";
import { providerSetupStatus } from "../../../lib/integrations/setup-status";
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
/**
 * DEEP CHECK (Phase 1, 2026-11-02) — why this exists.
 *
 * The cheap payload above reports whether settings are PRESENT. That is not the same
 * as working, and the release report had to admit the difference. `?deep=1` opens the
 * database and asks the sign-in service to identify itself, so a readiness report can
 * say "your work is stored and reachable" only after something actually answered.
 *
 * Safety: no value, hostname, key, or provider name is ever returned — only one of
 * "ready" / "unreachable" / "not_configured" per capability. Results are cached for a
 * minute so the public endpoint cannot be used to hammer the database.
 */
import { deepChecks, type DeepChecks } from "../../../lib/health-probe";

export async function GET(request: Request) {
  const deep = new URL(request.url).searchParams.get("deep") === "1";
  const checks: DeepChecks | undefined = deep ? await deepChecks() : undefined;

  return Response.json(
    {
      ok: true,
      name: "sophira",
      // Which code is actually running. Public and non-sensitive; it lets a release
      // report prove the deployment matches the intended commit instead of assuming it.
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 40) || null,
      configuration: {
        ...healthConfiguration(),
        search: searchProviderConfigured(),
        // 2026-11-13 (Part 13): these three were the "unknown" rows in the readiness
        // report. Same functions the features call, booleans only.
        google_documents: providerSetupStatus().google,
        microsoft_documents: providerSetupStatus().microsoft,
        invitation_email: providerSetupStatus().email,
        sms: providerSetupStatus().sms,
      },
      // Present only when asked for: the cheap path stays cheap.
      ...(checks ? { checks } : {}),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
