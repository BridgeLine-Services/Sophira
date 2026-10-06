/**
 * Offline subsystem — the sync orchestrator (STEP 10).
 *
 * When connectivity returns:
 *   1. detect connectivity (caller passes an online probe; UI also uses
 *      navigator.onLine as a hint)
 *   2. preserve local state (local records and queue are never modified
 *      destructively during analysis)
 *   3. upload queued ops in deterministic order, resolving each against the
 *      current server row (see conflicts.ts)
 *   4. retrieve remote changes and refresh the local mirror (never
 *      overwriting local unsynced edits)
 *   5. resolve conflicts → explicit ConflictRecords for user resolution
 *   6. update local state (mark synced / write pulled rows)
 *   7. mark successful operations synchronized; failed ones keep their
 *      queue entry and retry safely on the next sync
 *
 * Revocation: a "revoked" response from the adapter means the account is no
 * longer authorized. The policy (STEP 12): STOP retrying, seal the queue as
 * dead, and require logout — purgeOfflineAccount() destroys all local
 * academic data and queued payloads so a revoked user keeps nothing.
 */

import { makeConflictRecord, orderOps, resolveOpAgainstRemote } from "./conflicts";
import type { QueueOp } from "./queue";
import type { SyncQueue } from "./queue";
import type { OfflineRecord, OfflineStore, OfflineTable } from "./store";

export interface RemoteRow {
  id: string;
  row: unknown;
  updated_at: string;
}

export type ApplyFailure =
  | { kind: "auth" } // not signed in — retry later after re-auth
  | { kind: "revoked" } // account revoked — seal and require logout
  | { kind: "server"; detail?: string }; // transient — safe retry

export type ApplyResult = { ok: true; updated_at: string } | { ok: false; failure: ApplyFailure };

/**
 * The server-facing side of sync. The real implementation talks to Supabase
 * (src/lib/offline/remote-supabase.ts); tests provide an in-memory fake.
 */
export interface RemoteAdapter {
  /** Current server row for a record (null when absent). */
  getRow(table: OfflineTable, id: string): Promise<RemoteRow | null>;
  /** Rows changed on the server since `since` (per-table, user-scoped). */
  fetchChanged(table: OfflineTable, since: string | null): Promise<RemoteRow[]>;
  /** Apply an op; server-side updated_at comes back on success. */
  applyOp(op: QueueOp, record: OfflineRecord | null): Promise<ApplyResult>;
  /** Is the session currently authorized at all? (revocation probe) */
  isAuthorized(): Promise<boolean>;
}

export interface SyncReport {
  uploaded: number;
  pulled: number;
  conflicts: number;
  failures: number;
  revoked: boolean;
  /** true when every queued op is now synced/dropped and no failures remain */
  complete: boolean;
  detail: string[];
}

/** Tables mirrored for offline use — pull set (STEP 1 classification). */
export const MIRRORED_TABLES: OfflineTable[] = [
  "assignments",
  "materials",
  "memories",
  "learning_patterns",
  "courses",
  "teachers",
  "teacher_profiles",
  "typing_profile",
  "schedules",
  "writing_profiles",
  "rubric_context",
  "preferences",
];

export class SyncEngine {
  constructor(
    private readonly store: OfflineStore,
    private readonly queue: SyncQueue,
    private readonly remote: RemoteAdapter
  ) {}

  /**
   * Run one full sync. Never throws for transient problems — the report
   * describes what happened; failures keep their queue entries.
   */
  async run(): Promise<SyncReport> {
    const report: SyncReport = { uploaded: 0, pulled: 0, conflicts: 0, failures: 0, revoked: false, complete: false, detail: [] };
    const authorized = await this.remote.isAuthorized();
    if (!authorized) {
      report.revoked = true;
      await this.sealQueue("session revoked or unauthorized — queue sealed; logout will purge local data");
      report.detail.push("not authorized: queue sealed, logout required");
      return report;
    }

    // 3. upload queued ops, deterministic order
    const pending = orderOps(await this.queue.pending());
    for (const op of pending) {
      const rec = await this.store.read(op.table, op.id).catch(() => null);
      const remoteRow = await this.remote.getRow(op.table, op.id).catch(() => null);
      const resolution = resolveOpAgainstRemote(op, rec, remoteRow ? { row: remoteRow.row, updated_at: remoteRow.updated_at } : null);

      if (resolution.action === "drop") {
        await this.queue.remove(op.op_id);
        report.detail.push(`dropped ${op.table}/${op.id}: ${resolution.reason}`);
        continue;
      }

      if (resolution.action === "conflict") {
        // 5. explicit conflict record — both sides preserved verbatim
        const conflict = makeConflictRecord(op, rec, remoteRow);
        await this.store.create("conflicts", conflict.conflict_id, conflict);
        if (rec) await this.store.markConflict(op.table, op.id, rec.row);
        await this.queue.markStatus(op.op_id, "dead", "conflict recorded for user resolution");
        report.conflicts += 1;
        report.detail.push(`conflict on ${op.table}/${op.id} (${conflict.kind}) — recorded, awaiting user resolution`);
        continue;
      }

      // apply
      await this.queue.markStatus(op.op_id, "syncing");
      const result = await this.remote.applyOp(op, rec);
      if (!result.ok) {
        if (result.failure.kind === "revoked") {
          report.revoked = true;
          await this.sealQueue("revoked during sync");
          report.detail.push("revocation detected mid-sync: queue sealed, logout required");
          return report;
        }
        if (result.failure.kind === "server") {
          await this.queue.markStatus(op.op_id, "failed", result.failure.detail);
          report.failures += 1;
          report.detail.push(`failed ${op.table}/${op.id}: ${result.failure.detail ?? "server error"} — stays queued for retry`);
          continue;
        }
        // auth: session expired — op stays queued, user re-signs-in
        await this.queue.markStatus(op.op_id, "failed", "auth required");
        report.failures += 1;
        report.detail.push(`${op.table}/${op.id} needs re-auth — stays queued`);
        continue;
      }

      // 7. success
      await this.store.markSynced(op.table, op.id, result.updated_at);
      await this.queue.remove(op.op_id);
      report.uploaded += 1;
      report.detail.push(`uploaded ${op.table}/${op.id} (v${rec?.version ?? 1})`);
    }

    // 4/6. pull remote changes into the mirror
    for (const table of MIRRORED_TABLES) {
      const since = await this.lastSyncCursor(table);
      let changed: RemoteRow[];
      try {
        changed = await this.remote.fetchChanged(table, since);
      } catch {
        report.detail.push(`pull skipped for ${table} (remote unavailable)`);
        continue;
      }
      for (const rr of changed) {
        const local = await this.store.read(table, rr.id).catch(() => null);
        // never clobber local unsynced edits — those reconcile via the queue
        if (local && local.sync_status !== "synced") continue;
        await this.store.upsertFromServer(table, rr.id, rr.row, rr.updated_at);
        report.pulled += 1;
      }
      await this.setSyncCursor(table, new Date().toISOString());
    }

    const stillPending = await this.queue.count();
    report.complete = report.failures === 0 && stillPending === 0 && !report.revoked;
    return report;
  }

  /** User resolution of a conflict: keep local / keep remote / merge. */
  async resolveConflict(conflictId: string, choice: "keep-local" | "keep-remote" | { merged: unknown }): Promise<QueueOp | null> {
    const rec = await this.store.read("conflicts", conflictId);
    if (!rec) return null;
    const c = rec.row as import("./conflicts").ConflictRecord;
    if (choice === "keep-local") {
      const localRec = await this.store.read(c.table, c.id);
      if (localRec) {
        await this.store.update(c.table, c.id, localRec.row);
        const base = { version: localRec.version, server_updated_at: c.remote_updated_at === "(absent)" ? null : c.remote_updated_at };
        const op = await this.queue.enqueue(c.table, c.id, "update", base);
        await this.store.purge("conflicts", conflictId);
        return op;
      }
      await this.store.purge("conflicts", conflictId);
      return null;
    }
    if (choice === "keep-remote") {
      if (c.remote !== null && c.remote_updated_at !== "(absent)") {
        await this.store.upsertFromServer(c.table, c.id, c.remote, c.remote_updated_at);
      } else {
        await this.store.delete(c.table, c.id);
        await this.store.purge(c.table, c.id);
      }
      await this.store.purge("conflicts", conflictId);
      return null;
    }
    // merged: user reconciled both sides into one row — upload it
    await this.store.update(c.table, c.id, choice.merged);
    const localRec = await this.store.read(c.table, c.id);
    const op = await this.queue.enqueue(c.table, c.id, "update", {
      version: localRec?.version ?? 1,
      server_updated_at: c.remote_updated_at === "(absent)" ? null : c.remote_updated_at,
    });
    await this.store.purge("conflicts", conflictId);
    return op;
  }

  /** Seal the queue (revocation): no further retries, nothing more uploads. */
  async sealQueue(reason: string): Promise<void> {
    for (const op of await this.queue.list()) {
      if (op.status !== "dead" && op.status !== "synced") {
        await this.queue.markStatus(op.op_id, "dead", reason);
      }
    }
  }

  /**
   * Logout / revocation purge: destroy ALL offline data — records, queue,
   * conflicts, keys. Nothing recoverable stays on the device (STEP 12).
   */
  async purgeOfflineAccount(): Promise<void> {
    await this.queue.purgeAll();
    await this.store.purgeAll();
  }

  // sync cursors per table (stored in the backend as plain metadata)
  private cursorKey(table: OfflineTable): string {
    return `sophira/secure/cursor/${table}`;
  }
  private async lastSyncCursor(table: OfflineTable): Promise<string | null> {
    const b = await this.store.backendGet(this.cursorKey(table));
    return b ? new TextDecoder().decode(b) : null;
  }
  private async setSyncCursor(table: OfflineTable, iso: string): Promise<void> {
    await this.store.backendSet(this.cursorKey(table), new TextEncoder().encode(iso));
  }
}

/** Is the device online? (hint only; the sync itself probes the server). */
export function navigatorOnline(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine !== false;
}
