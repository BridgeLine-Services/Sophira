import { evaluateOwnerSetup, probeOwnerSetup } from "@/lib/owner-setup";
import { countStaleAuthUsers } from "@/lib/db-bootstrap";

export const dynamic = "force-dynamic";

/**
 * Operator setup-status endpoint (public BY DESIGN, like /api/health).
 *
 * The operator who deploys Sophira needs this BEFORE any account exists -
 * including the owner - so it cannot require authentication (the chicken-
 * and-egg of fail-closed bootstrap). It therefore reports ONLY categorical
 * configuration status: booleans, small enums, and the SAFE coarse state
 * (READY / OWNER_EXISTS / SETUP_REQUIRED / TEMPORARILY_UNAVAILABLE). It
 * never returns keys, tokens, emails, passwords, SQL, or the owner_email
 * VALUE (see the security contract in src/lib/owner-setup.ts,
 * machine-checked by the offline suite).
 */
export async function GET() {
  const probe = await probeOwnerSetup();
  const status = evaluateOwnerSetup(probe);
  const stale = await countStaleAuthUsers(probe);
  return Response.json({
    ok: true,
    name: "sophira-setup",
    state: status.state,
    // The precise missing infrastructure capability (requirement K/L) -
    // categorical only: supabase-credentials | service-role |
    // initialization-channel | null.
    connectionEnvNames: status.probe.connectionEnvNames,
    connectionTarget: status.probe.connectionTarget,
    capability: status.capability,
    ready: status.ready,
    headline: status.headline,
    probe: {
      supabaseConfigured: status.probe.supabaseConfigured,
      serviceRoleConfigured: status.probe.serviceRoleConfigured,
      aiConfigured: status.probe.aiConfigured,
      database: status.probe.database,
      migrationsPresent: status.probe.migrationsPresent,
      migrationAutomationConfigured: status.probe.migrationAutomationConfigured,
      setupChannel: status.probe.setupChannel,
      ownerEmailConfigured: status.probe.ownerEmailConfigured,
      ownerAccount: status.probe.ownerAccount,
    },
    checklist: {
      supabaseConfigured: status.probe.supabaseConfigured,
      databaseConnected: status.probe.database === "checked",
      migrationsCurrent: status.probe.migrationsPresent === true,
      ownerBootstrapReady: status.probe.ownerBootstrapPresent === true,
      invitationSystemReady: status.probe.invitationsPresent === true,
      authenticationReady: status.probe.supabaseConfigured && status.probe.database === "checked",
    },
    repair: { available: status.repair.available, action: status.repair.action, reason: status.repair.reason },
    staleAuthUsers: stale,
    guidance: status.guidance,
    ownerCreation: status.ownerCreation,
  });
}
