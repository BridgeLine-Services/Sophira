/**
 * Offline subsystem — browser client wiring (singletons).
 *
 * Initializes the full offline stack for the browser:
 *   IndexedDBBackend → OfflineStore (encrypted) → SyncQueue
 *   SupabaseRemoteAdapter → SyncEngine → OfflineApi
 *   ModelManager + LocalInferenceEngine → OfflineTasks
 *
 * installSecret: a random per-install value held in localStorage. Documented
 * tradeoff (docs/OFFLINE_ARCHITECTURE.md §security): this protects cached
 * data at rest (disk/profile access) — it does not defend against a
 * compromised same-origin script, which no browser-local scheme can.
 * Native builds can later source this from Keystore/Keychain.
 */

import { IndexedDBBackend } from "./backend";
import { OfflineStore } from "./store";
import { SyncQueue } from "./queue";
import { SupabaseRemoteAdapter } from "./remote-supabase";
import { SyncEngine } from "./sync";
import { OfflineApi } from "./api";
import { ModelManager } from "./model-manager";
import { LocalInferenceEngine } from "./local-engine";
import { OfflineTasks } from "./offline-tasks";

const INSTALL_SECRET_KEY = "sophira.offline.secret";

function installSecret(): string {
  if (typeof localStorage === "undefined") return "node-runtime";
  let s = localStorage.getItem(INSTALL_SECRET_KEY);
  if (!s) {
    const b = new Uint8Array(32);
    crypto.getRandomValues(b);
    s = Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(INSTALL_SECRET_KEY, s);
  }
  return s;
}

interface OfflineStack {
  store: OfflineStore;
  queue: SyncQueue;
  sync: SyncEngine;
  api: OfflineApi;
  models: ModelManager;
  engine: LocalInferenceEngine;
  tasks(modelId: string): OfflineTasks;
  online(): boolean;
  ensure(): Promise<void>;
}

let stack: OfflineStack | null = null;

/** Get (initializing once) the browser offline stack. */
export function offlineStack(): OfflineStack {
  if (stack) return stack;

  const store = new OfflineStore(new IndexedDBBackend("sophira-offline"));
  const queue = new SyncQueue(store);
  const remote = new SupabaseRemoteAdapter(async () => {
    const { createClient } = await import("@/lib/supabase/client");
    return createClient();
  });
  const sync = new SyncEngine(store, queue, remote);
  const api = new OfflineApi({
    store,
    queue,
    remote,
    sync,
    online: () => (typeof navigator === "undefined" ? false : navigator.onLine !== false),
  });
  const models = new ModelManager({ transformers: undefined as never });
  const engine = new LocalInferenceEngine();

  stack = {
    store,
    queue,
    sync,
    api,
    models,
    engine,
    tasks: (modelId: string) => new OfflineTasks(engine, store, modelId),
    online: () => (typeof navigator === "undefined" ? false : navigator.onLine !== false),
    ensure: async () => {
      await store.init(installSecret());
    },
  };
  return stack;
}

/**
 * Logout purge policy (STEP 12): destroy ALL offline data on sign-out —
 * records, queue, conflicts, keys. Returns how many pending offline
 * changes were destroyed (so the caller can warn honestly).
 */
export async function purgeOfflineOnLogout(): Promise<number> {
  const s = offlineStack();
  const pending = await s.queue.count().catch(() => 0);
  await s.sync.purgeOfflineAccount();
  s.engine.unloadAll();
  return pending;
}
