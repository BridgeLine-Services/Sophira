import { repairOwnerBootstrap, cleanupStaleAuthUsers } from "@/lib/db-bootstrap";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // full first-launch chain (26 migrations) needs headroom

/**
 * ONE-CLICK SETUP REPAIR (public BY DESIGN, pre-first-owner only).
 *
 * This is the endpoint behind the "Repair Setup" action on /setup and
 * /create-owner, so the owner never opens a SQL editor. It is safe to be
 * public because of hard server-side gates, all of which are re-checked on
 * every call inside src/lib/db-bootstrap.ts:
 *
 *   - it accepts NO SQL, NO credentials, NO account identifiers from the
 *     request - only a fixed action name;
 *   - the ONLY thing it can ever execute is the embedded, idempotent
 *     first-owner bootstrap payload (migrations 0025+0026, byte-pinned to
 *     the repository files by the offline suite) or the stale-account
 *     cleanup, which itself refuses once any owner or profile exists;
 *   - every response is categorical (ok / reason / plain-language message):
 *     no secret values, no SQL text, no emails, no account existence.
 *   - an owner already existing CLOSES the repair permanently.
 */
export async function POST(request: Request) {
  let action = "";
  try {
    const body = await request.json();
    if (typeof body?.action === "string") action = body.action;
  } catch {
    // no/invalid body: fall through to the honest unknown-action response
  }

  if (action === "migrations") {
    const result = await repairOwnerBootstrap();
    return Response.json(
      {
        ok: result.ok,
        reason: result.ok ? null : result.reason,
        message: result.message,
        // Categorical developer diagnostics: which migration step failed
        // and what class of failure (never raw SQL, never identifiers).
        failedAt: result.ok ? null : (result as { failedAt?: string }).failedAt ?? null,
        // Deployed-engine marker (developer diagnostics: verifies which
        // build served the response; not a secret, not user-facing copy).
        engine: 4,
        failure: result.ok ? null : (result as { failure?: string }).failure ?? null,
        // Sanitized connection-phase driver message (hosts/credentials/IPs redacted) -
        // developer diagnostics for the Advanced area only.
        detail: result.ok ? null : (result as { detail?: string }).detail ?? null,
      },
      { status: result.ok ? 200 : 409 }
    );
  }

  if (action === "cleanup-stale") {
    const result = await cleanupStaleAuthUsers();
    return Response.json(
      { ok: result.ok, reason: result.ok ? null : result.reason, message: result.message },
      { status: result.ok ? 200 : 409 }
    );
  }

  return Response.json(
    { ok: false, reason: "unknown-action", message: "Unknown repair action." },
    { status: 400 }
  );
}
