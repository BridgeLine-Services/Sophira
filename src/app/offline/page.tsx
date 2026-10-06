"use client";
/**
 * Offline center (STEP 5/7/9/11 UI):
 *  - model manager: list, storage disclosure BEFORE download, explicit
 *    confirm, progress, integrity state, retry after failure
 *  - offline assistant: run supported offline tasks, every response
 *    stamped with its provenance (local vs remote)
 *  - sync panel: state, pending count, manual sync, sync report detail
 *  - conflict resolution: keep local / keep remote for each conflict
 *  - honest online-only list (never faked as available offline)
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, Label, Spinner, Textarea, useToast } from "@/components/ui";
import { SyncStatus } from "@/components/app/SyncStatus";
import { ProvenanceBadge } from "@/components/app/ProvenanceBadge";
import { offlineStack, purgeOfflineOnLogout } from "@/lib/offline/client";
import { LOCAL_MODELS, findModel } from "@/lib/offline/model-registry";
import { ONLINE_ONLY_TASKS } from "@/lib/offline/offline-tasks";
import type { ConflictRecord } from "@/lib/offline/conflicts";
import type { AiProvenance } from "@/lib/offline/local-engine";
import type { SyncReport } from "@/lib/offline/sync";
import { CloudOff, Cpu, Download, HardDrive, RefreshCw } from "lucide-react";

export default function OfflinePage() {
  const stack = offlineStack();
  const { toast } = useToast();
  const [ready, setReady] = useState(false);
  const [modelStates, setModelStates] = useState<Record<string, { state: string; detail: string }>>({});
  const [disclosure, setDisclosure] = useState<string | null>(null);
  const [confirmModel, setConfirmModel] = useState<string | null>(null);
  const [busyModel, setBusyModel] = useState<string | null>(null);
  const [modelId, setModelId] = useState(LOCAL_MODELS[0].id);
  const [task, setTask] = useState("write-assist");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{ output: string; provenance: AiProvenance; error?: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<SyncReport | null>(null);
  const [conflicts, setConflicts] = useState<ConflictRecord[]>([]);
  const [queueCount, setQueueCount] = useState(0);

  useEffect(() => {
    (async () => {
      await stack.ensure();
      setReady(true);
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    setModelStates((prev) => {
      const next = { ...prev };
      for (const m of LOCAL_MODELS) {
        const mgr = stack.models;
        next[m.id] = {
          state: mgr.stateOf(m.id),
          detail: mgr.describe(m.id)?.disclosure ?? "",
        };
      }
      return next;
    });
    setConflicts(((await stack.api.conflicts()) as ConflictRecord[]).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
    setQueueCount(await stack.queue.count().catch(() => 0));
  }, [stack]);

  async function startDownload(modelId: string) {
    setBusyModel(modelId);
    try {
      const r = await stack.models.download(modelId, {
        confirmed: true,
        onProgress: () => setModelStates((prev) => ({ ...prev })),
      });
      toast(r.ok ? "success" : "error", r.ok ? "Model ready — offline AI is live" : r.detail);
    } finally {
      setBusyModel(null);
      setConfirmModel(null);
      await refresh();
    }
  }

  async function runTask(_e: FormEvent) {
    if (!input.trim() || !findModel(modelId)) return;
    if (stack.models.stateOf(modelId) !== "ready") {
      toast("error", "Download the local model first (below).");
      return;
    }
    setBusyModel("task");
    try {
      const tasks = stack.tasks(modelId);
      const r =
        task === "write-assist" ? await tasks.writingAssist("improve", input) :
        task === "rewrite" ? await tasks.rewrite(input, "make it clearer and more concise") :
        task === "generate" ? await tasks.generate(input) :
        task === "math-solve" ? await tasks.mathSolve(input) :
        task === "verify" ? await tasks.verify({ check: input }) :
        task === "memory-recall" ? await tasks.memoryRecall(input) :
        await tasks.applyTeacherRules([], {});
      setResult({ output: r.output, provenance: r.provenance, error: r.error });
    } finally {
      setBusyModel(null);
    }
  }

  async function runSync() {
    setSyncing(true);
    try {
      const r = await stack.sync.run();
      setReport(r);
      if (r.revoked) {
        await stack.sync.purgeOfflineAccount();
        window.location.href = "/login?revoked=1";
        return;
      }
      toast(
        r.complete ? "success" : "error",
        r.complete
          ? `Sync complete: ${r.uploaded} uploaded, ${r.pulled} pulled`
          : `Sync finished with issues: ${r.conflicts} conflict(s), ${r.failures} failure(s)`
      );
      await refresh();
    } finally {
      setSyncing(false);
    }
  }

  async function resolveConflict(id: string, choice: "keep-local" | "keep-remote") {
    await stack.sync.resolveConflict(id, choice);
    await refresh();
  }

  return (
    <AppShell title="Offline">
      <div className="space-y-6">
        {!ready && <Spinner />}

        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Sync</CardTitle>
            <SyncStatus />
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{queueCount} offline change(s) waiting to sync. Signing out deletes all local offline data — including unsynced changes.</p>
            <Button onClick={runSync} disabled={syncing}>{syncing ? "Syncing…" : "Sync now"}</Button>
            {report && (
              <ul className="text-xs text-ink/60">
                {report.detail.slice(-8).map((d, i) => <li key={i}>• {d}</li>)}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Cpu className="h-4 w-4" /> Local AI model</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {LOCAL_MODELS.map((m) => {
              const st = modelStates[m.id];
              const state = st?.state ?? "unknown";
              return (
                <div key={m.id} className="rounded border border-ink/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{m.label}</p>
                      <p className="text-xs text-ink/60">{m.params} · {m.capabilities.join(", ")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={state === "ready" ? "success" : state === "downloading" ? "accent" : "neutral"}>
                        {state === "unknown" ? "not downloaded" : state}
                      </Badge>
                      <Button
                        size="sm"
                        variant={state === "ready" ? "ghost" : "primary"}
                        onClick={() => {
                          const d = stack.models.describe(m.id)?.disclosure;
                          setDisclosure(d ?? "");
                          setConfirmModel(m.id);
                        }}
                        disabled={busyModel === m.id}
                      >
                        <Download className="mr-1 h-3.5 w-3.5" />
                        {state === "ready" ? "Re-download" : "Download"}
                      </Button>
                    </div>
                  </div>
                  {state === "ready" && (
                    <p className="mt-1 text-xs text-emerald-700">Loaded on this device — works with no internet.</p>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-ink/50">
              <HardDrive className="mr-1 inline h-3.5 w-3.5" />
              The exact download size is shown for confirmation before anything downloads. Nothing large is ever downloaded silently.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CloudOff className="h-4 w-4" /> Offline assistant</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Model</Label>
                <select className="w-full rounded border border-ink/20 p-2 text-sm" value={modelId} onChange={(e) => setModelId(e.target.value)}>
                  {LOCAL_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <Label>Task</Label>
                <select className="w-full rounded border border-ink/20 p-2 text-sm" value={task} onChange={(e) => setTask(e.target.value)}>
                  <option value="write-assist">Writing assist (improve)</option>
                  <option value="rewrite">Rewrite</option>
                  <option value="generate">Generate</option>
                  <option value="math-solve">Math solve</option>
                  <option value="verify">Machine verification</option>
                  <option value="memory-recall">Recall academic memory</option>
                </select>
              </div>
            </div>
            <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} placeholder={task === "math-solve" ? "e.g. (3 + 4) * 12 / 2" : "Text or question…"} />
            <Button onClick={runTask} disabled={busyModel === "task"}>
              {busyModel === "task" ? <Spinner /> : "Run offline"}
            </Button>
            {result && (
              <div className="rounded border border-ink/10 bg-paper p-3 text-sm">
                <div className="mb-1 flex items-center justify-between">
                  <ProvenanceBadge provenance={result.provenance} />
                </div>
                <pre className="whitespace-pre-wrap">{result.output || result.error}</pre>
              </div>
            )}
            <div className="rounded border border-ink/10 p-3 text-xs text-ink/60">
              <p className="font-medium text-ink/80">Online-only (honest):</p>
              {ONLINE_ONLY_TASKS.map((t) => <p key={t.kind}>• {t.kind} — {t.why}</p>)}
            </div>
          </CardContent>
        </Card>

        {conflicts.length > 0 && (
          <Card>
            <CardHeader><CardTitle>Conflicts ({conflicts.length})</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {conflicts.map((c) => (
                <div key={c.conflict_id} className="rounded border border-amber-300 bg-amber-50 p-3 text-xs">
                  <p className="font-medium">{c.table}/{c.id} — {c.kind} (both versions preserved; nothing was discarded)</p>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap">local: {JSON.stringify(c.local)?.slice(0, 200)}</pre>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap">remote: {JSON.stringify(c.remote)?.slice(0, 200)}</pre>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => resolveConflict(c.conflict_id, "keep-local")}>Keep my version</Button>
                    <Button size="sm" variant="ghost" onClick={() => resolveConflict(c.conflict_id, "keep-remote")}>Keep server version</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirmModel !== null}
        title="Download local model?"
        message={disclosure ?? ""}
        confirmLabel="Download"
        onConfirm={() => confirmModel && startDownload(confirmModel)}
        onCancel={() => setConfirmModel(null)}
      />
    </AppShell>
  );
}
