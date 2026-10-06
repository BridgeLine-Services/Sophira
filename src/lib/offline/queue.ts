/**
 * Offline subsystem — durable synchronization queue (STEP 8).
 *
 * Every offline mutation becomes an op: { table, id, kind, payload, base },
 * where `base` is the record state the change was made against (version +
 * server_updated_at at edit time). That metadata is what makes later
 * reconciliation possible (STEP 9): if the server row moved since `base`,
 * the op conflicts instead of silently overwriting.
 *
 * Ops are stored ENCRYPTED via the OfflineStore device key. The queue is
 * durable across restarts and page reloads; a failed sync keeps the op and
 * allows safe retry (idempotent by op id + client op idempotency key).
 */

import type { OfflineStore, OfflineTable, OfflineRecord } from "./store";

export type OpKind = "create" | "update" | "delete";

export interface QueueOp {
  op_id: string; // random, primary key
  table: OfflineTable;
  id: string; // record id
  kind: OpKind;
  /** record state at edit time: what the writer believed was current */
  base_version: number;
  base_server_updated_at: string | null;
  created_at: string; // device clock at queue time
  attempts: number;
  last_error: string | null;
  status: "queued" | "syncing" | "synced" | "failed" | "dead";
}

const QUEUE_PREFIX = "sophira/secure/queue/";

function newOpId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

export class SyncQueue {
  constructor(private readonly store: OfflineStore) {}

  private key(opId: string): string {
    return QUEUE_PREFIX + opId;
  }

  async enqueue(table: OfflineTable, id: string, kind: OpKind, base: Pick<OfflineRecord, "version" | "server_updated_at">): Promise<QueueOp> {
    const op: QueueOp = {
      op_id: newOpId(), table, id, kind,
      base_version: base.version,
      base_server_updated_at: base.server_updated_at,
      created_at: new Date().toISOString(),
      attempts: 0, last_error: null, status: "queued",
    };
    await this.store.backendSet(this.key(op.op_id), await this.store.encryptString(JSON.stringify(op)));
    return op;
  }

  async get(opId: string): Promise<QueueOp | null> {
    const blob = await this.store.backendGet(this.key(opId));
    if (!blob) return null;
    return JSON.parse(await this.store.decryptString(blob)) as QueueOp;
  }

  /** All ops, oldest first (created_at then op_id for total order). */
  async list(): Promise<QueueOp[]> {
    const ids = await this.store.backendKeys(QUEUE_PREFIX);
    const ops: QueueOp[] = [];
    for (const k of ids) {
      const op = await this.get(k.slice(QUEUE_PREFIX.length));
      if (op) ops.push(op);
    }
    ops.sort((a, b) => (a.created_at === b.created_at ? (a.op_id < b.op_id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
    return ops;
  }

  async pending(): Promise<QueueOp[]> {
    return (await this.list()).filter((o) => o.status === "queued" || o.status === "failed" || o.status === "syncing");
  }

  async count(): Promise<number> {
    return (await this.pending()).length;
  }

  async markStatus(opId: string, status: QueueOp["status"], error?: string): Promise<void> {
    const op = await this.get(opId);
    if (!op) return;
    op.status = status;
    op.last_error = error ?? op.last_error;
    if (status === "failed" || status === "syncing") op.attempts += 1;
    await this.store.backendSet(this.key(opId), await this.store.encryptString(JSON.stringify(op)));
  }

  async remove(opId: string): Promise<void> {
    await this.store.backendDelete(this.key(opId));
  }

  /** Purge every queued op (logout / revocation). */
  async purgeAll(): Promise<void> {
    for (const k of await this.store.backendKeys(QUEUE_PREFIX)) {
      await this.store.backendDelete(k);
    }
  }
}
