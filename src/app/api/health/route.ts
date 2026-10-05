import { searchProviderConfigured } from "../../../lib/research/provider";

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
 */

const configured = (v: string | undefined): boolean =>
  typeof v === "string" && v.trim().length > 0;

export async function GET() {
  return Response.json({
    ok: true,
    name: "sophira",
    configuration: {
      supabase:
        configured(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
        configured(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
      supabase_service_role: configured(process.env.SUPABASE_SERVICE_ROLE_KEY),
      ai: configured(process.env.OPENAI_API_KEY),
      search: searchProviderConfigured(),
    },
  });
}
