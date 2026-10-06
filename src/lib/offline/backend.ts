/**
 * Offline subsystem — pluggable key/value backend.
 *
 * The offline layer never talks to IndexedDB directly beyond this module, so
 * the entire offline stack (store, queue, sync, conflicts) runs in Node
 * under the MemoryBackend for deterministic tests, and in the browser under
 * the IndexedDBBackend. Behavior differences between the two backends are
 * limited to persistence — every other guarantee is identical and tested.
 */

export interface OfflineBackend {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix: string): Promise<string[]>;
  clear(): Promise<void>;
}

/** In-memory backend — Node/test runtime, zero persistence. */
export class MemoryBackend implements OfflineBackend {
  private map = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array | null> {
    const v = this.map.get(key);
    return v ? new Uint8Array(v) : null;
  }
  async set(key: string, value: Uint8Array): Promise<void> {
    this.map.set(key, new Uint8Array(value));
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async keys(prefix: string): Promise<string[]> {
    return Array.from(this.map.keys()).filter((k) => k.startsWith(prefix));
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

/** Minimal promise-wrapped IndexedDB backend (browser). */
export class IndexedDBBackend implements OfflineBackend {
  private db: IDBDatabase | null = null;

  constructor(private readonly dbName = "sophira-offline") {}

  private open(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      };
      req.onsuccess = () => {
        this.db = req.result;
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  }

  private tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return this.open().then(
      (db) =>
        new Promise<T>((resolve, reject) => {
          const t = db.transaction("kv", mode);
          const req = fn(t.objectStore("kv"));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  async get(key: string): Promise<Uint8Array | null> {
    const v = await this.tx("readonly", (s) => s.get(key) as IDBRequest<Uint8Array | undefined>);
    return v ?? null;
  }
  async set(key: string, value: Uint8Array): Promise<void> {
    await this.tx("readwrite", (s) => s.put(value));
  }
  async delete(key: string): Promise<void> {
    await this.tx("readwrite", (s) => s.delete(key));
  }
  async keys(prefix: string): Promise<string[]> {
    const all = await this.tx("readonly", (s) => s.getAllKeys() as unknown as IDBRequest<IDBValidKey[]>);
    return (all as string[]).filter((k) => typeof k === "string" && k.startsWith(prefix));
  }
  async clear(): Promise<void> {
    await this.tx("readwrite", (s) => s.clear());
  }
}

export function defaultBackend(): OfflineBackend {
  if (typeof indexedDB !== "undefined") return new IndexedDBBackend();
  return new MemoryBackend();
}
