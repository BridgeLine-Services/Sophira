import { AppShell } from "@/components/app/AppShell";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { scanMigrations } from "@/lib/db-ddl";
import DatabaseUpdates from "./DatabaseUpdates";

export const dynamic = "force-dynamic";

/**
 * Database updates (2026-11-11).
 *
 * The page states, before anything is pressed, what the database has and what it
 * is missing. It exists because production drifted nine tables behind and the
 * only offer in the app was /install, which installs the app on a phone, not the
 * database schema.
 */
export default async function OwnerDatabasePage() {
  await requireOwnerPage();
  const scan = await scanMigrations();

  return (
    <AppShell title="Database updates" variant="owner">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">Keep your database in step with Sophira</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            When a new part of Sophira is released, its database pieces arrive with it. This page shows
            what your live database already has and lets you apply what is missing. Nothing is ever
            deleted: updates only add what is absent.
          </p>
        </div>
        <DatabaseUpdates
          initial={{
            reachable: scan.reachable,
            channel: scan.channel,
            total: scan.applied + scan.pending.length + scan.unverifiable.length,
            applied: scan.applied,
            pendingCount: scan.pending.length,
            pending: scan.pending.map((p) => p.label),
            unverifiableCount: scan.unverifiable.length,
            upToDate: scan.pending.length === 0 && scan.unverifiable.length === 0,
          }}
        />
      </div>
    </AppShell>
  );
}
