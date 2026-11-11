import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { applyMigrationChainForOwner } from "@/lib/db-bootstrap";
import { scanMigrations, type MigrationScan } from "@/lib/db-ddl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * OWNER-ONLY DATABASE UPDATES (2026-11-11).
 *
 * GET  /api/owner/migrations — what the database has, what is missing.
 * POST /api/owner/migrations — apply exactly what is missing, in chain order.
 *
 * Why this route exists: the first-launch wizard (db-bootstrap) deliberately
 * refuses to touch a database that already has an owner, so a live deployment
 * that drifted behind the repository had NO way to be brought current from the
 * app. On 2026-11-11 the production database was nine tables behind, and the
 * only offer was /install, which is the PWA install page.
 *
 * Safety properties:
 *  - Server-side owner check (authenticated -> active -> role owner). A member
 *    session, an anon key, or a stale tab gets 401/403 and changes nothing.
 *  - The SQL is always the repository's own embedded chain. No request body is
 *    read at all, so there is no query to inject.
 *  - Nothing is applied that the database does not report as missing, and a
 *    migration without a probe is refused rather than guessed at.
 *  - Messages are plain English: no SQL, no filenames in the member-facing line.
 */

async function ownerOnly(): Promise<{ ok: true } | { ok: false; response: Response }> {
  const supabase = createClient();
  try {
    const user = await requireUser(supabase);
    const { profile } = await readProfileWithRepair(supabase, user.id);
    if (!profile || profile.role !== "owner") {
      return { ok: false, response: Response.json({ error: "Owner access required." }, { status: 403 }) };
    }
    return { ok: true };
  } catch {
    return { ok: false, response: Response.json({ error: "Not signed in." }, { status: 401 }) };
  }
}

const plain = (scan: MigrationScan) => ({
  reachable: scan.reachable,
  channel: scan.channel,
  total: scan.applied + scan.pending.length + scan.unverifiable.length,
  applied: scan.applied,
  pendingCount: scan.pending.length,
  // Names are shown to the OWNER only, and only as labels ("Member notifications"),
  // never as file names a member could confuse for something to run.
  pending: scan.pending.map((p) => p.label),
  unverifiableCount: scan.unverifiable.length,
  upToDate: scan.pending.length === 0 && scan.unverifiable.length === 0,
});

export async function GET() {
  const gate = await ownerOnly();
  if (!gate.ok) return gate.response;
  const scan = await scanMigrations();
  return Response.json({ ok: true, database: plain(scan) });
}

export async function POST() {
  const gate = await ownerOnly();
  if (!gate.ok) return gate.response;

  const before = await scanMigrations();
  if (before.pending.length === 0 && before.unverifiable.length === 0) {
    return Response.json({ ok: true, appliedNow: 0, message: "Your database is already up to date.", database: plain(before) });
  }
  if (!before.reachable) {
    return Response.json(
      {
        ok: false,
        appliedNow: 0,
        message:
          "Sophira could not reach the database to read its version, so nothing was changed. Try again in a moment; if it keeps happening, open System Health.",
        database: plain(before),
      },
      { status: 503 },
    );
  }
  if (before.unverifiable.length > 0) {
    return Response.json(
      {
        ok: false,
        appliedNow: 0,
        message:
          "Sophira cannot confirm which updates are missing, because one migration has no check it can ask the database. Nothing was changed. This is a bug to fix, not something to retry.",
        database: plain(before),
      },
      { status: 409 },
    );
  }

  const result = await applyMigrationChainForOwner();
  const after = await scanMigrations();
  const nowCurrent = after.pending.length === 0 && after.unverifiable.length === 0;

  return Response.json(
    {
      ok: result.ok && nowCurrent,
      appliedNow: before.pending.length - after.pending.length > 0 ? before.pending.length - after.pending.length : 0,
      message: nowCurrent
        ? "Your database is now up to date."
        : result.ok
          ? "Some updates were applied but the database still reports missing pieces. Press Update database again; if it repeats, open System Health."
          : result.message,
      database: plain(after),
    },
    { status: result.ok && nowCurrent ? 200 : 500 },
  );
}
