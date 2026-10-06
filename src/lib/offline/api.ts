/**
 * Offline subsystem — offline-aware data access for the app (STEP 4).
 *
 * The pages keep their existing online architecture untouched: they talk to
 * Supabase directly. Offline-capable flows use THIS module instead, which
 * routes reads to the local mirror when offline and writes into the
 * encrypted local store + durable queue, uploading through SyncEngine when
 * connectivity returns.
 *
 * Writes while ONLINE go to the server first (source of truth), then refresh
 * the local mirror — the queue is only used for offline-origin writes, so
 * the queue never duplicates a server-accepted change.
 */

import type { SyncQueue } from "./queue";
import type { OfflineStore, OfflineTable } from "./store";
import type { RemoteAdapter, SyncEngine } from "./sync";

export interface OfflineApiConfig {
  store: OfflineStore;
  queue: SyncQueue;
  remote: RemoteAdapter;
  sync: SyncEngine;
  online(): boolean;
}

export class OfflineApi {
  constructor(private readonly cfg: OfflineApiConfig) {}

  /** Read a record: local mirror when offline, server when online. */
  async get<T>(table: OfflineTable, id: string): Promise<T | null> {
    if (this.cfg.online()) {
      try {
        const rr = await this.cfg.remote.getRow(table, id);
        if (rr) await this.cfg.store.upsertFromServer(table, id, rr.row, rr.updated_at);
        return (rr?.row as T) ?? null;
      } catch {
        // server unreachable despite the hint — fall through to the mirror
      }
    }
    const rec = await this.cfg.store.read<T>(table, id);
    return rec?.row ?? null;
  }

  /** List records: mirror offline, server online (mirroring into local). */
  async list<T>(table: OfflineTable): Promise<T[]> {
    if (this.cfg.online()) {
      try {
        const rows = await this.cfg.remote.fetchChanged(table, null); // full user table
        const out: T[] = [];
        for (const rr of rows) {
          await this.cfg.store.upsertFromServer(table, rr.id, rr.row, rr.updated_at);
          out.push(rr.row as T);
        }
        return out;
      } catch {
        // fall through to the mirror
      }
    }
    const recs = await this.cfg.store.list<T>(table);
    return recs.map((r) => r.row);
  }

  /**
   * Create a record. Offline: encrypted local record + queued op.
   * Online: server insert, mirror the accepted row locally.
   */
  async create<T extends { id?: string }>(table: OfflineTable, row: T): Promise<string> {
    const id = row.id ?? crypto.randomUUID();
    const payload = { ...row, id };
    if (this.cfg.online()) {
      try {
        const result = await this.cfg.remote.applyOp(
          { op_id: "direct", table, id, kind: "create", base_version: 0, base_server_updated_at: null, created_at: new Date().toISOString(), attempts: 0, last_error: null, status: "queued" },
          null
        );
        if (result.ok) {
          await this.cfg.store.upsertFromServer(table, id, payload, result.updated_at);
          return id;
        }
      } catch {
        // network dropped mid-write — treat as offline create below
      }
    }
    await this.cfg.store.create(table, id, payload);
    await this.cfg.queue.enqueue(table, id, "create", { version: 1, server_updated_at: null });
    return id;
  }

  /** Update a record (offline-safe). */
  async update<T>(table: OfflineTable, id: string, row: T): Promise<void> {
    const rec = await this.cfg.store.read<T>(table, id);
    if (!rec) throw new Error(`offline-api: ${table}/${id} not in the local mirror — fetch it first`);
    if (this.cfg.online()) {
      try {
        const result = await this.cfg.remote.applyOp(
          { op_id: "direct", table, id, kind: "update", base_version: rec.version, base_server_updated_at: rec.server_updated_at, created_at: new Date().toISOString(), attempts: 0, last_error: null, status: "queued" },
          rec
        );
        if (result.ok) {
          await this.cfg.store.upsertFromServer(table, id, row, result.updated_at);
          return;
        }
      } catch {
        // fall through to offline path
      }
    }
    await this.cfg.store.update(table, id, row);
    await this.cfg.queue.enqueue(table, id, "update", { version: rec.version, server_updated_at: rec.server_updated_at });
  }

  /** Delete a record (offline-safe tombstone). */
  async delete(table: OfflineTable, id: string): Promise<void> {
    const rec = await this.cfg.store.read(table, id);
    if (!rec) return;
    if (this.cfg.online()) {
      try {
        const result = await this.cfg.remote.applyOp(
          { op_id: "direct", table, id, kind: "delete", base_version: rec.version, base_server_updated_at: rec.server_updated_at, created_at: new Date().toISOString(), attempts: 0, last_error: null, status: "queued" },
          rec
        );
        if (result.ok) {
          await this.storePurge(table, id);
          return;
        }
      } catch {
        // fall through
      }
    }
    await this.cfg.store.delete(table, id);
    await this.cfg.queue.enqueue(table, id, "delete", { version: rec.version, server_updated_at: rec.server_updated_at });
  }

  private async storePurge(table: OfflineTable, id: string): Promise<void> {
    await this.cfg.store.purge(table, id);
  }

  /** Pending offline changes (for the UI badge). */
  async pendingCount(): Promise<number> {
    return this.cfg.queue.count();
  }

  /** Conflict records awaiting user resolution. */
  async conflicts(): Promise<unknown[]> {
    const recs = await this.cfg.store.list("conflicts");
    return recs.map((r) => r.row);
  }
}
