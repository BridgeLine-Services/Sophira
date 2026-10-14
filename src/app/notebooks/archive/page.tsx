"use client";
import { useCallback, useEffect, useState } from "react";
import { ArchiveRestore } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Spinner, useToast } from "@/components/ui";

interface ArchivedItem {
  kind: string; kind_label: string; id: string; notebook_id: string | null;
  title: string; archived_at: string;
}

/**
 * THE ARCHIVE (2026-10-13): every record the signed-in user removed from
 * their active workspace. Owner-scoped server-side (/api/archive enforces
 * user isolation); Restore puts the ORIGINAL record back — same id, same
 * relationships, no duplicates. The empty state is honest: if this list is
 * empty, the user has no archived records.
 */
export default function ArchivePage() {
  const { toast } = useToast();
  const [items, setItems] = useState<ArchivedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmPermanent, setConfirmPermanent] = useState<{ id: string; title: string } | null>(null);
  const [permaBusy, setPermaBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/archive", { cache: "no-store" });
      if (res.ok) {
        const d = await res.json();
        setItems(d.items ?? []);
      } else {
        toast("error", "Could not load the Archive — try again.");
      }
    } catch {
      toast("error", "Could not load the Archive — check your connection.");
    } finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const restore = async (item: ArchivedItem) => {
    setBusy(item.id);
    try {
      const res = await fetch("/api/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, id: item.id, action: "restore" }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        setItems((cur) => cur.filter((x) => x.id !== item.id));
        toast("success", json.note ? "Restored. " + json.note : "Restored to your workspace.");
      } else {
        toast("error", json.error || "Could not restore — it stays archived. Try again.");
      }
    } finally { setBusy(null); }
  };

  // PERMANENT deletion is a separate operation from Restore/Archive: it
  // destroys the notebook AND its sources, notes, questions, evidence, and
  // artifacts (DB on-delete cascade). Owner-scoped server endpoint; the row
  // only leaves the list after the server confirms success.
  async function deletePermanently() {
    const target = confirmPermanent;
    if (!target || permaBusy) return;
    setPermaBusy(true);
    try {
      const res = await fetch(`/api/notebooks/${target.id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast("error", json.error || "Could not delete the notebook — it is still safe in the Archive.");
        return;
      }
      setItems((rows) => rows.filter((r) => r.id !== target.id));
      toast("success", "Notebook permanently deleted.");
    } catch {
      toast("error", "Could not reach the server — the notebook is still in the Archive.");
    } finally {
      setPermaBusy(false);
      setConfirmPermanent(null);
    }
    };

  return (
    <AppShell title="Archive" backHref="/notebooks">
      <p className="mb-4 text-sm text-ink-soft">
        Records you removed from your workspace. Nothing here is deleted — restore anything and it returns exactly as it was.
      </p>
      {loading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ArchiveRestore className="h-6 w-6" />}
          title="Nothing archived"
          description="When you remove a notebook, source, note, question, evidence, or artifact from your workspace, it waits here until you restore it."
        />
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <Card key={it.kind + it.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{it.title}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    <Badge>{it.kind_label}</Badge> · removed {new Date(it.archived_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => restore(it)} disabled={busy === it.id}>
                    <ArchiveRestore className="h-4 w-4" /> Restore
                  </Button>
                  {it.kind === "notebook" && (
                    <Button size="sm" className="text-danger" disabled={permaBusy}
                      onClick={() => setConfirmPermanent({ id: it.id, title: it.title })}>
                      Delete permanently
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={confirmPermanent !== null}
        title="Permanently delete notebook?"
        message={`This CANNOT be undone. "${confirmPermanent?.title ?? "This notebook"}" and all of its sources, notes, questions, evidence, research, study materials, and artifacts will be destroyed permanently.`}
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => { void deletePermanently(); }}
        onCancel={() => setConfirmPermanent(null)}
      />
    </AppShell>
  );
}
