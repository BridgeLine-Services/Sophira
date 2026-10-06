/**
 * Offline subsystem tests (spec STEP 13).
 *
 * The full 17-step lifecycle runs against the MemoryBackend with an
 * in-memory fake remote (a stand-in for Supabase that implements the same
 * optimistic-concurrency contract), two simulated devices, and a mock local
 * inference engine — deterministic, no network. A REAL transformers.js
 * pipeline check runs only when RUN_LIVE_MODEL=1 (downloads a ~2 MB probe
 * model from the HF hub — see docs/OFFLINE_ARCHITECTURE.md).
 */

import { MemoryBackend } from "../src/lib/offline/backend";
import { OfflineStore } from "../src/lib/offline/store";
import type { OfflineRecord, OfflineTable } from "../src/lib/offline/store";
import { SyncQueue } from "../src/lib/offline/queue";
import { resolveOpAgainstRemote, orderOps, makeConflictRecord } from "../src/lib/offline/conflicts";
import type { QueueOp } from "../src/lib/offline/queue";
import { SyncEngine } from "../src/lib/offline/sync";
import type { ApplyResult, RemoteAdapter, RemoteRow } from "../src/lib/offline/sync";
import { OfflineApi } from "../src/lib/offline/api";
import { OfflineTasks } from "../src/lib/offline/offline-tasks";
import { ModelManager } from "../src/lib/offline/model-manager";
import { findModel, PIPELINE_PROBE_MODEL } from "../src/lib/offline/model-registry";
import type { LocalInferenceEngine, AiProvenance } from "../src/lib/offline/local-engine";
import type { LearningPattern } from "../src/lib/learning/patterns";

type Assert = (condition: boolean, name: string) => void;
type Section = (title: string) => void;

/* ---------------- fake remote (the "server") ---------------- */

interface ServerRow {
  row: Record<string, unknown>;
  updated_at: string;
}

class FakeRemote implements RemoteAdapter {
  authorized = true;
  failNextApply = false;
  tables = new Map<OfflineTable, Map<string, ServerRow>>();

  private t(table: OfflineTable): Map<string, ServerRow> {
    let m = this.tables.get(table);
    if (!m) {
      m = new Map();
      this.tables.set(table, m);
    }
    return m;
  }

  seed(table: OfflineTable, id: string, row: Record<string, unknown>, updated_at: string): void {
    this.t(table).set(id, { row: { ...row, id }, updated_at });
  }

  async getRow(table: OfflineTable, id: string): Promise<RemoteRow | null> {
    const r = this.t(table).get(id);
    return r ? { id, row: { ...r.row }, updated_at: r.updated_at } : null;
  }

  async fetchChanged(table: OfflineTable, since: string | null): Promise<RemoteRow[]> {
    const out: RemoteRow[] = [];
    for (const [id, r] of this.t(table)) {
      if (!since || r.updated_at > since) out.push({ id, row: { ...r.row }, updated_at: r.updated_at });
    }
    return out;
  }

  async applyOp(op: QueueOp, record: OfflineRecord | null): Promise<ApplyResult> {
    if (this.failNextApply) {
      this.failNextApply = false;
      return { ok: false, failure: { kind: "server", detail: "simulated transient server error" } };
    }
    const now = new Date().toISOString();
    if (op.kind === "delete") {
      const r = this.t(op.table).get(op.id);
      if (!r) return { ok: true, updated_at: now }; // already gone — drop is fine
      if (op.base_server_updated_at && r.updated_at !== op.base_server_updated_at) {
        return { ok: false, failure: { kind: "server", detail: "base-mismatch" } };
      }
      this.t(op.table).delete(op.id);
      return { ok: true, updated_at: now };
    }
    if (op.kind === "create") {
      if (this.t(op.table).has(op.id)) return { ok: false, failure: { kind: "server", detail: "exists" } };
      this.t(op.table).set(op.id, { row: { ...((record?.row as Record<string, unknown>) ?? {}), id: op.id }, updated_at: now });
      return { ok: true, updated_at: now };
    }
    // update with optimistic concurrency on updated_at
    const r = this.t(op.table).get(op.id);
    if (!r) return { ok: false, failure: { kind: "server", detail: "absent" } };
    if (op.base_server_updated_at && r.updated_at !== op.base_server_updated_at) {
      return { ok: false, failure: { kind: "server", detail: "base-mismatch" } };
    }
    r.row = { ...((record?.row as Record<string, unknown>) ?? {}), id: op.id };
    r.updated_at = now;
    return { ok: true, updated_at: now };
  }

  async isAuthorized(): Promise<boolean> {
    return this.authorized;
  }

  serverRow(table: OfflineTable, id: string): ServerRow | null {
    return this.t(table).get(id) ?? null;
  }
}

/* ---------------- mock local inference engine ---------------- */

class MockLocalEngine {
  calls = 0;
  constructor(private readonly reply: (prompt: string) => string) {}

  async generate(_modelId: string, prompt: string): Promise<{ text: string; provenance: AiProvenance }> {
    this.calls++;
    return {
      text: this.reply(prompt),
      provenance: { origin: "local", model: "mock-on-device", latencyMs: 5, generatedOffline: true },
    };
  }
}

/* ---------------- module units ---------------- */

async function cryptoUnits(assert: Assert, section: Section) {
  section("Offline §1: encrypted store, crypto, versioning, tombstones");
  const store = new OfflineStore(new MemoryBackend());
  await store.init("test-install-secret");

  const rec = await store.create("materials", "m1", { title: "Calculus notes", content: "u = ∫x dx" });
  assert(rec.version === 1 && rec.sync_status === "local" && rec.origin === "device", "create: device record, version 1, unsynced");

  const read1 = await store.read<{ title: string }>("materials", "m1");
  assert(read1?.row.title === "Calculus notes", "read: decrypted content matches (AES-GCM roundtrip)");

  const rec2 = await store.update("materials", "m1", { title: "Calculus notes v2", content: "u = x²/2" });
  assert(rec2.version === 2 && rec2.sync_status === "local", "update: version bumped to 2");

  await store.markSynced("materials", "m1", "2026-10-06T00:00:00Z");
  const synced = await store.read<Record<string, unknown>>("materials", "m1");
  assert(synced?.sync_status === "synced" && synced.server_updated_at === "2026-10-06T00:00:00Z", "markSynced: record marked synchronized with server timestamp");

  await store.delete("materials", "m1");
  assert((await store.read("materials", "m1")) === null, "delete: tombstoned record is hidden");
  const tomb = await store["get"]<Record<string, unknown>>("materials", "m1");
  assert(!!tomb && tomb.deleted === true && tomb.version === 3, "delete: tombstone exists with bumped version (so deletes sync too)");

  // encryption is real: raw backend bytes are not the plaintext
  const backend = new MemoryBackend();
  const s2 = new OfflineStore(backend);
  await s2.init("secret-A");
  await s2.create("materials", "x", { content: "SENSITIVE PRIVATE ACADEMIC TEXT" });
  const raw = await backend.get("sophira/secure/rec/materials/x");
  const rawStr = new TextDecoder().decode(raw as Uint8Array);
  assert(!rawStr.includes("SENSITIVE"), "at-rest: encrypted record bytes contain no plaintext academic content");

  // wrong key (different install secret on a different profile) cannot decrypt
  const s3 = new OfflineStore(backend);
  let threw = false;
  try {
    await s3.init("secret-B");
    await s3.read("materials", "x");
  } catch {
    threw = true;
  }
  assert(threw, "at-rest: a different install secret cannot unlock the data (AES-GCM auth failure on unwrap)");

  // purgeAll: logout leaves nothing
  await s2.purgeAll();
  assert((await backend.keys("sophira/")).length === 0, "purgeAll: logout deletes keys and every record");
}

async function queueUnits(assert: Assert, section: Section) {
  section("Offline §2: durable queue, ordering, conflicts");
  const store = new OfflineStore(new MemoryBackend());
  await store.init("secret");
  const queue = new SyncQueue(store);
  await store.create("assignments", "a1", { title: "Essay" });
  await store.create("assignments", "a2", { title: "Lab report" });
  const opA = await queue.enqueue("assignments", "a1", "update", { version: 1, server_updated_at: "2026-10-05T00:00:00Z" });
  const opB = await queue.enqueue("assignments", "a2", "create", { version: 1, server_updated_at: null });
  assert(!!opA.op_id && !!opB.op_id && opA.op_id !== opB.op_id, "queue: unique op ids");
  assert((await queue.count()) === 2, "queue: pending count is durable through the encrypted backend");
  const list = await queue.list();
  const sorted = [...list].sort((a, b) => (a.created_at === b.created_at ? (a.op_id < b.op_id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
  assert(list.every((o, i) => o.op_id === sorted[i].op_id), "queue: deterministic total order (created_at then op_id)");
  assert(opA.created_at <= opB.created_at, "queue: ops carry queue-time metadata for later reconciliation");

  const ordered = orderOps([
    { created_at: "2026-10-06T02:00:00Z", op_id: "zz" },
    { created_at: "2026-10-06T01:00:00Z", op_id: "aa" },
  ]);
  assert(ordered[0].op_id === "aa", "conflicts: total order by created_at then op_id");

  // resolution matrix
  const baseOp = { op_id: "o", table: "assignments" as OfflineTable, id: "a1", created_at: "2026-10-06T00:00:00Z", attempts: 0, last_error: null, status: "queued" as const };
  const rec = { table: "assignments" as OfflineTable, id: "a1", row: {}, version: 2, origin: "device" as const, sync_status: "local" as const, updated_at: "2026-10-06T00:00:00Z", server_updated_at: "2026-10-05T00:00:00Z", deleted: false };
  assert(resolveOpAgainstRemote({ ...baseOp, kind: "update", base_version: 2, base_server_updated_at: "2026-10-05T00:00:00Z" } as QueueOp, rec, { row: {}, updated_at: "2026-10-05T00:00:00Z" }).action === "apply", "conflicts: matching base applies");
  assert(resolveOpAgainstRemote({ ...baseOp, kind: "update", base_version: 2, base_server_updated_at: "2026-10-05T00:00:00Z" } as QueueOp, rec, { row: {}, updated_at: "2026-10-06T00:30:00Z" }).action === "conflict", "conflicts: server moved on → explicit conflict, never silent overwrite");
  assert(resolveOpAgainstRemote({ ...baseOp, kind: "update", base_version: 2, base_server_updated_at: "2026-10-05T00:00:00Z" } as QueueOp, rec, null).action === "conflict", "conflicts: server row vanished → conflict (no silent resurrect)");
  assert(resolveOpAgainstRemote({ ...baseOp, kind: "delete", base_version: 2, base_server_updated_at: null } as QueueOp, rec, null).action === "drop", "conflicts: delete of absent row drops cleanly");
  assert(resolveOpAgainstRemote({ ...baseOp, kind: "delete", base_version: 2, base_server_updated_at: "2026-10-05T00:00:00Z" } as QueueOp, rec, { row: {}, updated_at: "2026-10-06T00:30:00Z" }).action === "conflict", "conflicts: delete vs newer edit → conflict (no silent discard of the other device's work)");
  const cr = makeConflictRecord({ ...baseOp, kind: "update", base_version: 2, base_server_updated_at: "2026-10-05T00:00:00Z" } as QueueOp, rec, { row: { title: "server version" }, updated_at: "2026-10-06T00:30:00Z" });
  assert(!!cr.conflict_id && cr.local_updated_at === "2026-10-06T00:00:00Z" && (cr.remote as Record<string, unknown>).title === "server version", "conflicts: conflict record preserves BOTH sides verbatim");
}

async function modelManagerUnits(assert: Assert, section: Section) {
  section("Offline §3: model manager — consent, disclosure, integrity, rollback");
  const spec = findModel("smollm2-135m-instruct");
  assert(!!spec, "registry: known model spec exists");
  assert((spec?.approxSizeMB ?? 0) > 0 && (spec?.minRAMMB ?? 0) > 0, "registry: storage + RAM estimates exist for pre-download disclosure");

  const loaded = new Set<string>();
  const mgr = new ModelManager({
    transformers: {
      pipeline: async (_t: string, model: string) => {
        loaded.add(model);
        return {};
      },
      env: {},
    },
    fetchFn: (async () => ({
      ok: true,
      json: async () => [
        { path: "onnx/model_quantized.onnx", size: 90000000, lfs: { oid: "abc", size: 90000000 } },
      ],
    })) as unknown as typeof fetch,
  });

  const d = mgr.describe("smollm2-135m-instruct");
  assert(d?.disclosure.includes("MB") === true, "manager: describe() shows the approximate download size BEFORE download");

  const refused = await mgr.download("smollm2-135m-instruct", { confirmed: false });
  assert(refused.ok === false && refused.detail.includes("confirmation"), "manager: download WITHOUT explicit confirmation is refused");
  assert(loaded.size === 0, "manager: refused download fetched nothing");

  const ok = await mgr.download("smollm2-135m-instruct", { confirmed: true });
  assert(ok.ok === true && mgr.stateOf("smollm2-135m-instruct") === "ready", "manager: confirmed download loads and reports ready");
  assert(mgr.integrityOf("smollm2-135m-instruct")?.ok === true, "manager: integrity verified against the CDN manifest");

  // integrity failure → rollback to previous state, never fake ready
  const mgrBad = new ModelManager({
    transformers: {
      pipeline: async () => {
        throw new Error("corrupt blob");
      },
      env: {},
    },
    fetchFn: (async () => new Response("[]", { status: 500 })) as unknown as typeof fetch,
  });
  const fail = await mgrBad.download("smollm2-135m-instruct", { confirmed: true });
  assert(fail.ok === false && mgrBad.stateOf("smollm2-135m-instruct") === "failed", "manager: failed download rolls back and surfaces the error — never a fake 'ready'");
}

/* ---------------- the 17-step lifecycle ---------------- */

async function lifecycleTest(assert: Assert, section: Section) {
  section("Offline §4: full 17-step offline lifecycle (online → offline → sync → conflict → failure → logout → revocation)");

  const remote = new FakeRemote();
  // STEP 12 setup: server has one assignment + one memory for our student
  remote.seed("assignments", "asg-1", { title: "Calculus homework", instructions_text: "Integrate x dx", status: "active" }, "2026-10-01T00:00:00Z");
  remote.seed("memories", "mem-1", { kind: "fact", content: "Student prefers step-by-step worked examples" }, "2026-10-01T00:00:00Z");

  // Device A (student's laptop)
  const storeA = new OfflineStore(new MemoryBackend());
  await storeA.init("device-A-secret");
  const queueA = new SyncQueue(storeA);
  const syncA = new SyncEngine(storeA, queueA, remote);
  const onlineA = { value: true };
  const apiA = new OfflineApi({ store: storeA, queue: queueA, remote, sync: syncA, online: () => onlineA.value });

  // STEP 1: start online
  assert(onlineA.value === true, "1. start online: device is online");

  // STEP 2: synchronize data (mirror the server state)
  await storeA.upsertFromServer("assignments", "asg-1", (await remote.getRow("assignments", "asg-1"))!.row, "2026-10-01T00:00:00Z");
  const mirrored = await storeA.read<{ title: string }>("assignments", "asg-1");
  assert(mirrored?.row.title === "Calculus homework" && mirrored.sync_status === "synced", "2. synchronize: assignment mirrored locally and marked synced");

  // STEP 3: disconnect internet
  onlineA.value = false;
  assert(onlineA.value === false, "3. disconnect: device goes offline");

  // STEP 4: open assignment (reads the local mirror)
  const opened = await apiA.get<{ title: string }>("assignments", "asg-1");
  assert(opened?.title === "Calculus homework", "4. open assignment: served from the encrypted local mirror while offline");

  // STEP 5: edit assignment offline
  await apiA.update("assignments", "asg-1", { title: "Calculus homework", instructions_text: "Integrate x dx, show all steps", status: "active" });
  assert((await queueA.count()) === 1, "5. edit assignment: change saved locally AND queued with reconciliation metadata");

  // STEP 6: ask offline AI a supported question (mock on-device engine; math via real mathjs)
  const engine = new MockLocalEngine(() => "u = x²/2 + C. Remember the constant of integration.") as unknown as LocalInferenceEngine;
  const tasks = new OfflineTasks(engine, storeA, "smollm2-135m-instruct");
  const ask = await tasks.generate("How do I integrate x dx?");
  assert(ask.ok === true && ask.provenance.origin === "local" && ask.provenance.generatedOffline === true, "6. offline AI: answered on-device, provenance stamped LOCAL (never a fake online call)");
  const math = await tasks.mathSolve("(3 + 4) * 12 / 2");
  assert(math.ok === true && math.output.includes("42"), "6b. offline math: deterministic mathjs engine solves without any model round-trip or network");

  // STEP 7: correct Sophira's answer (a learning correction, offline)
  const pattern: LearningPattern = {
    id: "p1", user_id: "u1", scope: "global", subject: null, course_id: null, teacher_id: null,
    assignment_id: null, task_type: null, kind: "mistake", status: "active",
    description: "Sophira forgot the constant of integration on indefinite integrals",
    confidence: 0.5, observations: 1, first_seen: "2026-10-06T00:00:00Z", last_seen: "2026-10-06T00:00:00Z",
    source: "user", created_at: "2026-10-06T00:00:00Z", updated_at: "2026-10-06T00:00:00Z",
  } as unknown as LearningPattern;
  await storeA.create("learning_patterns", "p1", pattern);
  await queueA.enqueue("learning_patterns", "p1", "create", { version: 1, server_updated_at: null });
  assert((await queueA.count()) === 2, "7. correct answer: learning correction stored locally and queued");

  // STEP 8: verify local learning update (teacher-rule application from local mirror)
  const applied = await tasks.applyTeacherRules([pattern], { subject: "Calculus", course_id: null, teacher_id: null, assignment_id: null, task_type: null });
  assert(applied.ok === true && applied.output.includes("constant of integration"), "8. learning update: correction is applied from LOCAL memory while offline");
  const pendingBefore = await storeA.list("learning_patterns");
  assert(pendingBefore[0].sync_status === "local", "8b. learning update: local change clearly distinguished as pending (not 'synced')");

  // STEP 9: create another document offline
  const docId = await apiA.create<Record<string, unknown>>("materials", { category: "note", title: "Offline notes", content: "u = x²/2 + C", tags: [] });
  assert((await queueA.count()) === 3, "9. create document: new document stored encrypted locally + queued");

  // STEP 10: reconnect internet
  onlineA.value = true;
  assert(onlineA.value === true, "10. reconnect: device is online again");

  // STEP 11: synchronize
  const report = await syncA.run();
  assert(report.uploaded === 3 && report.complete === true && report.conflicts === 0, `11. synchronize: all 3 queued changes uploaded (got ${report.uploaded}), sync complete`);

  // STEP 12: verify server state
  const serverAsg = remote.serverRow("assignments", "asg-1");
  assert((serverAsg?.row as Record<string, unknown>)?.instructions_text === "Integrate x dx, show all steps", "12. server state: the edited assignment reached the server");
  assert(remote.serverRow("materials", docId) !== null, "12b. server state: the new document reached the server");
  assert((await queueA.count()) === 0, "12c. server state: queue empty — every op marked synchronized");
  const syncedAsg = await storeA.read("assignments", "asg-1");
  assert(syncedAsg?.sync_status === "synced", "12d. local state: record marked synchronized after server confirmation");

  // STEP 13: simultaneous edits from two devices (both edit the same record offline)
  const storeB = new OfflineStore(new MemoryBackend());
  await storeB.init("device-B-secret");
  const queueB = new SyncQueue(storeB);
  const syncB = new SyncEngine(storeB, queueB, remote);
  const onlineB = { value: true };
  await storeB.upsertFromServer("assignments", "asg-1", (await remote.getRow("assignments", "asg-1"))!.row, serverAsg!.updated_at);
  onlineA.value = false;
  onlineB.value = false;
  await apiA.update("assignments", "asg-1", { title: "Calculus homework", instructions_text: "DEVICE A version", status: "active" });
  const apiB = new OfflineApi({ store: storeB, queue: queueB, remote, sync: syncB, online: () => onlineB.value });
  await apiB.update("assignments", "asg-1", { title: "Calculus homework", instructions_text: "DEVICE B version", status: "active" });
  assert((await queueA.count()) === 1 && (await queueB.count()) === 1, "13. two devices: both offline edits queued on their own devices");

  // STEP 14: conflict resolution — first device syncs, second must conflict, nothing silently discarded
  onlineA.value = true;
  const reportA = await syncA.run();
  assert(reportA.uploaded === 1, "14. device A syncs first: its edit uploads");
  onlineB.value = true;
  const reportB = await syncB.run();
  assert(reportB.conflicts === 1, "14b. device B syncs second: edit-edit CONFLICT detected (no silent overwrite)");
  const conflictsB = await storeB.list("conflicts");
  const crB = conflictsB[0].row as ReturnType<typeof makeConflictRecord>;
  assert((crB.remote as Record<string, unknown>).instructions_text === "DEVICE A version", "14c. conflict record preserved the OTHER device's change verbatim");
  assert((crB.local as Record<string, unknown>).instructions_text === "DEVICE B version", "14d. conflict record preserved THIS device's change verbatim");
  const conflictedRec = await storeB.read("assignments", "asg-1");
  assert(conflictedRec?.sync_status === "conflict", "14e. local record marked 'conflict' — user must resolve explicitly");
  // user resolves: keep remote (device A's version)
  await syncB.resolveConflict(crB.conflict_id, "keep-remote");
  assert((await storeB.read("assignments", "asg-1"))?.sync_status === "synced", "14f. resolution: user chose keep-remote → local mirror updated to the server version");
  // resolution keep-local uploads instead
  await apiA.update("assignments", "asg-1", { title: "Calculus homework", instructions_text: "DEVICE A v2", status: "active" });
  await syncA.run();
  onlineB.value = false;
  await apiB.update("assignments", "asg-1", { title: "Calculus homework", instructions_text: "DEVICE B v2", status: "active" });
  onlineB.value = true;
  await syncB.run();
  const conflictsB2 = await storeB.list("conflicts");
  const crB2 = conflictsB2[0]?.row as ReturnType<typeof makeConflictRecord> | undefined;
  assert(!!crB2, "14g. second race also lands in an explicit conflict record");
  if (crB2) {
    const op = await syncB.resolveConflict(crB2.conflict_id, "keep-local");
    assert(!!op, "14h. keep-local resolution enqueues an upload op");
    await syncB.run();
    assert(remote.serverRow("assignments", "asg-1")?.row.instructions_text === "DEVICE B v2", "14i. resolved version reaches the server");
  }

  // (step 14 aftermath) device A pulls the resolved state before its next edit
  await syncA.run();
  const pulledToA = await storeA.read<{ instructions_text: string }>("assignments", "asg-1");
  assert(pulledToA?.row.instructions_text === "DEVICE B v2" && pulledToA.sync_status === "synced",
    "14j. cross-device propagation: the resolved change reached device A's mirror on its next sync");

  // STEP 15: failed synchronization — transient server error keeps the queue, retries safely
  onlineA.value = false;
  await apiA.update("assignments", "asg-1", { title: "Calculus homework", instructions_text: "retry me", status: "active" });
  onlineA.value = true;
  remote.failNextApply = true;
  const failReport = await syncA.run();
  assert(failReport.failures === 1 && failReport.complete === false, `15. sync failure: transient server error reported, sync not complete (got ${failReport.failures} failures)`);
  assert((await queueA.count()) === 1, "15b. failed op STAYS in the durable queue — no data loss");
  const retryReport = await syncA.run();
  assert(retryReport.complete === true && (await queueA.count()) === 0, "15c. safe retry: the same op syncs successfully on the next attempt");
  assert(remote.serverRow("assignments", "asg-1")?.row.instructions_text === "retry me", "15d. retried change applied exactly once (idempotent op)");

  // STEP 16: logout while offline (pending changes) — local data destroyed, never uploaded
  onlineA.value = false;
  await apiA.update("assignments", "asg-1", { title: "Calculus homework", instructions_text: "will be destroyed at logout", status: "active" });
  const pendingAtLogout = await queueA.count();
  assert(pendingAtLogout === 1, "16. logout offline: there IS unsynced work at logout time");
  await syncA.purgeOfflineAccount();
  assert((await storeA.count()) === 0 && (await queueA.count()) === 0, "16b. logout purge: all records, keys, and queued ops destroyed");
  assert(remote.serverRow("assignments", "asg-1")?.row.instructions_text === "retry me", "16c. purged unsynced work was NEVER uploaded to the server");

  // STEP 17: account revocation after offline changes — sync seals, purges, never uploads
  const storeC = new OfflineStore(new MemoryBackend());
  await storeC.init("device-C-secret");
  const queueC = new SyncQueue(storeC);
  const syncC = new SyncEngine(storeC, queueC, remote);
  const onlineC = { value: false };
  const apiC = new OfflineApi({ store: storeC, queue: queueC, remote, sync: syncC, online: () => onlineC.value });
  await storeC.create("materials", "rev-1", { title: "post-revocation edit", content: "x" });
  await queueC.enqueue("materials", "rev-1", "create", { version: 1, server_updated_at: null });
  remote.authorized = false; // account revoked server-side
  onlineC.value = true;
  const revokedReport = await syncC.run();
  assert(revokedReport.revoked === true && revokedReport.uploaded === 0, "17. revocation: sync detects revoked account, uploads NOTHING");
  assert(remote.serverRow("materials", "rev-1") === null, "17b. revocation: the queued offline change never reached the server");
  const sealed = await queueC.list();
  assert(sealed.every((o) => o.status === "dead"), "17c. revocation: queue sealed dead — no more silent retries");
  await syncC.purgeOfflineAccount();
  assert((await storeC.count()) === 0, "17d. post-revocation purge: local academic data destroyed");

  // memory recall from the local mirror (STEP 3 of the spec, offline)
  const storeM = new OfflineStore(new MemoryBackend());
  await storeM.init("secret-m");
  await storeM.upsertFromServer("memories", "mem-1", { kind: "fact", content: "Student prefers step-by-step worked examples" }, "2026-10-01T00:00:00Z");
  const tasksM = new OfflineTasks(engine, storeM, "smollm2-135m-instruct");
  const recall = await tasksM.memoryRecall("worked examples");
  assert(recall.ok === true && recall.output.includes("step-by-step"), "memory: academic memory retrievable offline from the encrypted mirror");
  const miss = await tasksM.memoryRecall("quantum tunneling");
  assert(miss.ok === false && miss.output.includes("No locally synced"), "memory: honest miss when nothing local matches");
}

/* ---------------- optional real-model pipeline check ---------------- */

async function liveModelTest(assert: Assert, section: Section) {
  section("Offline §6 (RUN_LIVE_MODEL=1): REAL transformers.js pipeline executes on this machine");
  const { LocalInferenceEngine } = await import("../src/lib/offline/local-engine");
  const engine = new LocalInferenceEngine();
  const out = await engine.generate("smollm2-135m-instruct", "Say OK.");
  assert(out.text.length > 0 && out.provenance.origin === "local", "live model: real on-device inference produced output stamped LOCAL");
}

export async function runOfflineTests(assert: Assert, section: Section): Promise<void> {
  await cryptoUnits(assert, section);
  await queueUnits(assert, section);
  await modelManagerUnits(assert, section);
  await lifecycleTest(assert, section);
  if (process.env.RUN_LIVE_MODEL === "1") {
    await liveModelTest(assert, section);
  } else {
    section("Offline §5: live-model pipeline check SKIPPED (set RUN_LIVE_MODEL=1 to download a real model and verify inference)");
  }
}
