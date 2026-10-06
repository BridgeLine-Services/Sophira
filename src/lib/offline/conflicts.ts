/**
 * Offline subsystem — deterministic conflict resolution (STEP 9).
 *
 * When an offline op reaches the server and the server row changed since the
 * op's base (base_server_updated_at), we must NOT silently overwrite the
 * other change. The strategy is deterministic and auditable:
 *
 * 1. recordVersion comparison — if the op's base matches the server's
 *    current updated_at exactly, apply (no conflict).
 * 2. tombstone-vs-write — a delete against a newer server row keeps the
 *    server row and records a conflict (never silently resurrects).
 * 3. create-vs-existing — creating an id that appeared on the server during
 *    the offline window merges: the server row wins unless fields are
 *    disjoint (then a conflict record is created for the user).
 * 4. ambiguous edits — BOTH versions are preserved verbatim into a
 *    ConflictRecord; the local record is marked "conflict" and the user
 *    resolves explicitly in the UI. Nothing is discarded silently.
 *
 * Resolution is a pure function: same inputs → same outcome, no clocks
 * consulted beyond the stored timestamps, no randomness.
 */

import type { OfflineRecord, OfflineTable } from "./store";
import type { QueueOp } from "./queue";

export type ConflictKind = "edit-edit" | "delete-edit" | "create-existing";

export interface ConflictRecord {
  conflict_id: string;
  table: OfflineTable;
  id: string;
  kind: ConflictKind;
  /** the offline version being uploaded (device state at edit time) */
  local: unknown;
  local_updated_at: string;
  local_base_server_updated_at: string | null;
  /** the version found on the server (the competing change) */
  remote: unknown;
  remote_updated_at: string;
  op_id: string;
  created_at: string;
}

export type Resolution =
  /** server row unchanged since base → apply the op */
  | { action: "apply" }
  /** server row changed → conflict, needs an explicit record (and possibly user resolution) */
  | { action: "conflict"; kind: ConflictKind }
  /** the local op is stale/redundant (e.g. delete of an already-deleted row) → drop */
  | { action: "drop"; reason: string };

function newConflictId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

/**
 * Decide how an op reconciles against the current server row.
 * `remoteRow` is the server's current row (null = absent server-side).
 */
export function resolveOpAgainstRemote(
  op: QueueOp,
  localRec: OfflineRecord | null,
  remoteRow: { row: unknown; updated_at: string } | null
): Resolution {
  if (op.kind === "delete") {
    if (!remoteRow) return { action: "drop", reason: "server row already absent" };
    if (remoteRow.updated_at !== op.base_server_updated_at) {
      // someone edited the row after our base — deleting would discard
      // their legitimate change; record the conflict for the user.
      return { action: "conflict", kind: "delete-edit" };
    }
    return { action: "apply" };
  }

  if (op.kind === "create") {
    if (remoteRow) {
      // The id was created on the server during our offline window too
      // (e.g. another device). Never overwrite it blindly.
      return { action: "conflict", kind: "create-existing" };
    }
    return { action: "apply" };
  }

  // update
  if (!remoteRow) {
    // row vanished server-side while we edited offline — do not resurrect
    // silently; conflict so the user decides.
    return { action: "conflict", kind: "edit-edit" };
  }
  if (remoteRow.updated_at === op.base_server_updated_at) {
    // server row is exactly what we based our edit on → fast path
    return { action: "apply" };
  }
  // both sides changed → explicit conflict record, user resolves
  return { action: "conflict", kind: "edit-edit" };
}

export function makeConflictRecord(
  op: QueueOp,
  localRec: OfflineRecord | null,
  remote: { row: unknown; updated_at: string } | null
): ConflictRecord {
  if (!localRec && !remote) throw new Error("conflict: neither side has data — nothing to record");
  return {
    conflict_id: newConflictId(),
    table: op.table,
    id: op.id,
    kind: !remote ? "edit-edit" : op.kind === "delete" ? "delete-edit" : op.kind === "create" ? "create-existing" : "edit-edit",
    local: localRec?.row ?? null,
    local_updated_at: localRec?.updated_at ?? op.created_at,
    local_base_server_updated_at: op.base_server_updated_at,
    remote: remote?.row ?? null,
    remote_updated_at: remote?.updated_at ?? "(absent)",
    op_id: op.op_id,
    created_at: new Date().toISOString(),
  };
}

/**
 * Deterministic ordering for ops that touch the same record: strictly by
 * (created_at, op_id) — a total order, stable across devices' replays.
 */
export function orderOps<T extends { created_at: string; op_id: string }>(ops: T[]): T[] {
  return [...ops].sort((a, b) => (a.created_at === b.created_at ? (a.op_id < b.op_id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
}
