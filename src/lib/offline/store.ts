/**
 * Offline subsystem — the encrypted local store.
 *
 * Layers (see docs/OFFLINE_ARCHITECTURE.md):
 *   OfflineBackend (IndexedDB / memory)
 *     └─ wrapped-data CryptoKey (non-extractable, AES-GCM)
 *          └─ records: { table, id, row, version, sync_status, updated_at }
 *
 * Every record carries:
 *   version      — monotonically increasing per (table,id) on this device;
 *                  conflict resolution compares versions + timestamps.
 *   sync_status  — "local" (created/edited offline, not yet uploaded),
 *                  "pending" (queued for upload), "synced" (confirmed by
 *                  the server), "conflict" (needs user resolution).
 *   origin       — "server" (pulled during sync) or "device".
 *
 * The store distinguishes, per STEP 3:
 *   locally confirmed information → records from the server (synced)
 *   pending changes               → the op queue + records not synced
 *   synchronized information      → sync_status === "synced"
 */

import type { OfflineBackend } from "./backend";
import { OFFLINE_KV_PREFIX, decryptJson, deriveWrappingKey, encryptJson, fromB64, generateDataKey, randomBytes, toB64 } from "./crypto";

export type OfflineTable =
  | "assignments"
  | "materials" // study materials / documents (extracted text)
  | "memories" // academic memory entries
  | "learning_patterns" // teacher-method / learning corrections
  | "courses"
  | "teachers" // teacher identity
  | "teacher_profiles" // teacher rules + docs summary
  | "typing_profile"
  | "schedules"
  | "writing_profiles"
  | "rubric_context" // rubric engine inputs (per-assignment rules)
  | "preferences"
  | "conflicts"; // conflict records awaiting user resolution

export type SyncStatus = "local" | "pending" | "synced" | "conflict";

export interface OfflineRecord<T = unknown> {
  table: OfflineTable;
  id: string;
  row: T;
  version: number; // device-local version, bumps on every write
  origin: "server" | "device";
  sync_status: SyncStatus;
  /** last device write (ISO) — set by the store, never by callers */
  updated_at: string;
  /** server row updated_at when last pulled (used by conflict detection) */
  server_updated_at: string | null;
  deleted: boolean; // tombstone for offline deletes
}

const KEY_META = "sophira/secure/meta";
const KEY_WRAP = "sophira/secure/wrapkey";

export class OfflineStore {
  private dataKey: CryptoKey | null = null;

  constructor(private readonly backend: OfflineBackend) {}

  /**
   * Initialize: create-or-load device key material. Safe to call repeatedly.
   *
   * Key hierarchy (see docs/OFFLINE_ARCHITECTURE.md §security):
   *   installSecret → PBKDF2 → KEK (non-extractable, wrap-only)
   *   KEK wraps the DEK raw bytes (AES-GCM envelope) → stored in the backend
   *   DEK (AES-GCM, extractable) encrypts/decrypts every record
   *
   * The DEK never exists in storage unencrypted. installSecret comes from
   * the caller: in the browser it is a random per-install value held in
   * localStorage (documented tradeoff: protects at-rest data, not a
   * compromised same-origin script); native builds may later source it from
   * Keychain/Keystore.
   */
  async init(installSecret: string): Promise<void> {
    const saltB = await this.backend.get(KEY_META + "/salt");
    const salt = saltB ?? randomBytes(16);
    if (!saltB) await this.backend.set(KEY_META + "/salt", salt);
    const kek = await deriveWrappingKey(installSecret, salt);

    const wrapped = await this.backend.get(KEY_WRAP);
    if (wrapped) {
      const env = JSON.parse(new TextDecoder().decode(wrapped));
      if (env.v !== 1) throw new Error("offline-store: unknown key envelope version");
      const subtle = crypto.subtle;
      const raw = await subtle.decrypt({ name: "AES-GCM", iv: fromB64(env.iv) }, kek, fromB64(env.dk));
      this.dataKey = await subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    } else {
      this.dataKey = await generateDataKey();
      await this.wrapAndStore(kek, this.dataKey);
    }
  }

  /** Wrap DEK raw bytes under the KEK and persist the envelope. */
  private async wrapAndStore(kek: CryptoKey, dek: CryptoKey): Promise<void> {
    const subtle = crypto.subtle;
    const raw = new Uint8Array(await subtle.exportKey("raw", dek));
    const iv = randomBytes(12);
    const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, kek, raw));
    // zero the buffer best-effort (JS cannot guarantee, but avoid lingering copies)
    raw.fill(0);
    const env = { v: 1, iv: toB64(iv), dk: toB64(ct) };
    await this.backend.set(KEY_WRAP, new TextEncoder().encode(JSON.stringify(env)));
  }

  private recKey(table: OfflineTable, id: string): string {
    return `${OFFLINE_KV_PREFIX}rec/${table}/${id}`;
  }

  private async put<T>(rec: OfflineRecord<T>): Promise<void> {
    if (!this.dataKey) throw new Error("offline-store: init() not called");
    const blob = await encryptJson(this.dataKey, JSON.stringify(rec));
    await this.backend.set(this.recKey(rec.table, rec.id), blob);
  }

  private async get<T>(table: OfflineTable, id: string): Promise<OfflineRecord<T> | null> {
    if (!this.dataKey) throw new Error("offline-store: init() not called");
    const blob = await this.backend.get(this.recKey(table, id));
    if (!blob) return null;
    return JSON.parse(await decryptJson(this.dataKey, blob)) as OfflineRecord<T>;
  }

  // ---- CRUD (STEP 2) ----

  /** Create a record locally (device origin, unsynced). */
  async create<T>(table: OfflineTable, id: string, row: T): Promise<OfflineRecord<T>> {
    const existing = await this.get<T>(table, id);
    if (existing && !existing.deleted) {
      throw new Error(`offline-store: ${table}/${id} already exists (use update)`);
    }
    const rec: OfflineRecord<T> = {
      table, id, row, version: 1, origin: "device",
      sync_status: "local", updated_at: new Date().toISOString(),
      server_updated_at: existing?.server_updated_at ?? null, deleted: false,
    };
    await this.put(rec);
    return rec;
  }

  /** Read a record (null when missing or tombstoned). */
  async read<T>(table: OfflineTable, id: string): Promise<OfflineRecord<T> | null> {
    const rec = await this.get<T>(table, id);
    if (!rec || rec.deleted) return null;
    return rec;
  }

  /** Update a record's row: bumps version, marks unsynced. */
  async update<T>(table: OfflineTable, id: string, row: T): Promise<OfflineRecord<T>> {
    const rec = await this.get<T>(table, id);
    if (!rec || rec.deleted) throw new Error(`offline-store: ${table}/${id} not found`);
    const next: OfflineRecord<T> = {
      ...rec, row, version: rec.version + 1,
      sync_status: rec.sync_status === "synced" ? "local" : rec.sync_status,
      updated_at: new Date().toISOString(), deleted: false,
    };
    await this.put(next);
    return next;
  }

  /** Soft delete (tombstone): the delete must also sync. */
  async delete(table: OfflineTable, id: string): Promise<void> {
    const rec = await this.get(table, id);
    if (!rec) return;
    await this.put({ ...rec, deleted: true, version: rec.version + 1, sync_status: rec.sync_status === "synced" ? "local" : rec.sync_status, updated_at: new Date().toISOString() });
  }

  /** List live records of a table. */
  async list<T>(table: OfflineTable): Promise<OfflineRecord<T>[]> {
    const keys = await this.backend.keys(`${OFFLINE_KV_PREFIX}rec/${table}/`);
    const out: OfflineRecord<T>[] = [];
    for (const k of keys) {
      const id = k.slice(`${OFFLINE_KV_PREFIX}rec/${table}/`.length);
      const rec = await this.read<T>(table, id);
      if (rec) out.push(rec);
    }
    return out;
  }

  /** Upsert a row pulled from the server (used by sync). */
  async upsertFromServer<T>(table: OfflineTable, id: string, row: T, serverUpdatedAt: string): Promise<OfflineRecord<T>> {
    const rec = await this.get<T>(table, id);
    const next: OfflineRecord<T> = {
      table, id, row,
      version: (rec?.origin === "device" && rec.sync_status !== "synced") ? rec.version + 1 : (rec?.version ?? 1),
      origin: "server", sync_status: "synced",
      updated_at: rec?.updated_at ?? new Date().toISOString(),
      server_updated_at: serverUpdatedAt, deleted: false,
    };
    await this.put(next);
    return next;
  }

  /** Mark a record as synchronized after the server accepted it. */
  async markSynced<T>(table: OfflineTable, id: string, serverUpdatedAt: string): Promise<void> {
    const rec = await this.get<T>(table, id);
    if (!rec) return;
    await this.put({ ...rec, sync_status: "synced", server_updated_at: serverUpdatedAt, deleted: rec.deleted && rec.sync_status === "synced" ? true : rec.deleted });
    if (rec.deleted) await this.backend.delete(this.recKey(table, id));
  }

  /** Mark a record as needing user conflict resolution. */
  async markConflict<T>(table: OfflineTable, id: string, row: T): Promise<void> {
    const rec = await this.get<T>(table, id);
    if (!rec) return;
    await this.put({ ...rec, sync_status: "conflict", row, version: rec.version + 1, updated_at: new Date().toISOString() });
  }

  /** Drop a tombstoned/merged record entirely (after server confirmed delete). */
  async purge(table: OfflineTable, id: string): Promise<void> {
    await this.backend.delete(this.recKey(table, id));
  }

  /** Encrypt an arbitrary string under the device key (queue payloads etc.). */
  async encryptString(plaintext: string): Promise<Uint8Array> {
    if (!this.dataKey) throw new Error("offline-store: init() not called");
    return encryptJson(this.dataKey, plaintext);
  }
  async decryptString(blob: Uint8Array): Promise<string> {
    if (!this.dataKey) throw new Error("offline-store: init() not called");
    return decryptJson(this.dataKey, blob);
  }

  /** Backend passthroughs for the queue (encrypted payloads). */
  async backendSet(key: string, value: Uint8Array): Promise<void> {
    await this.backend.set(key, value);
  }
  async backendGet(key: string): Promise<Uint8Array | null> {
    return this.backend.get(key);
  }
  async backendDelete(key: string): Promise<void> {
    await this.backend.delete(key);
  }
  async backendKeys(prefix: string): Promise<string[]> {
    return this.backend.keys(prefix);
  }

  /** Total record count (diagnostics/tests). */
  async count(): Promise<number> {
    return (await this.backend.keys(`${OFFLINE_KV_PREFIX}rec/`)).length;
  }

  /** Wipe EVERYTHING local: records, keys, queue markers. Used on logout. */
  async purgeAll(): Promise<void> {
    this.dataKey = null;
    await this.backend.clear();
  }
}
