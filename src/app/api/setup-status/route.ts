import { evaluateOwnerSetup, probeOwnerSetup } from "@/lib/owner-setup";

export const dynamic = "force-dynamic";

/**
 * Operator setup-status endpoint (public BY DESIGN, like /api/health).
 *
 * The operator who deploys Sophira needs this BEFORE any account exists -
 * including the owner - so it cannot require authentication (the chicken-
 * and-egg of fail-closed bootstrap). It therefore reports ONLY categorical
 * configuration status: booleans and small enums. It never returns keys,
 * tokens, emails, passwords, or the owner_email VALUE (see the security
 * contract in src/lib/owner-setup.ts, machine-checked by the offline suite).
 */
export async function GET() {
  const probe = await probeOwnerSetup();
  const status = evaluateOwnerSetup(probe);
  return Response.json({
    ok: true,
    name: "sophira-setup",
    ready: status.ready,
    headline: status.headline,
    probe: {
      supabaseConfigured: status.probe.supabaseConfigured,
      serviceRoleConfigured: status.probe.serviceRoleConfigured,
      aiConfigured: status.probe.aiConfigured,
      database: status.probe.database,
      migrationsPresent: status.probe.migrationsPresent,
      ownerEmailConfigured: status.probe.ownerEmailConfigured,
      ownerAccount: status.probe.ownerAccount,
    },
    guidance: status.guidance,
  });
}
