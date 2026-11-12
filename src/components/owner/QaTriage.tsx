"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, CardContent, Input, useToast } from "@/components/ui";

/**
 * QA TRIAGE (2026-11-12). Staff read every tester report (RLS) and move its
 * status; a tester sees only their own. Status changes are the only write,
 * and every change can carry a short note the tester will read.
 */
export interface QaRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  area: string | null;
  severity: string;
  status: string;
  steps: string | null;
  expected: string | null;
  actual: string | null;
  resolution_note: string | null;
  created_at: string;
}

const STATUSES = ["open", "triaged", "fixed", "declined", "closed"] as const;

export function QaTriage({ rows }: { rows: QaRow[] }) {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"open" | "all">("open");

  const visible = filter === "open" ? rows.filter((r) => r.status === "open" || r.status === "triaged") : rows;

  async function setStatus(row: QaRow, status: string) {
    setBusyId(row.id);
    const { error } = await supabase
      .from("qa_reports")
      .update({ status, resolution_note: notes[row.id] ?? row.resolution_note ?? "" })
      .eq("id", row.id);
    setBusyId(null);
    if (error) {
      toast("error", "That status change didn't save. Try again.");
      return;
    }
    toast("success", `Marked ${status}.`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-soft">
          Reports filed from tester workspaces. Only their status can change here; the reports themselves stay with the tester.
        </p>
        <div className="flex gap-1.5">
          {(["open", "all"] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition ${filter === f ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-ink-soft hover:border-accent/40"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <Card><CardContent className="p-4 text-sm text-ink-soft">
          {filter === "open" ? "No open reports. Testers can file bugs and feedback from their own workspace." : "No reports yet."}
        </CardContent></Card>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <Card key={r.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{r.title}</p>
                    <p className="text-xs text-ink-soft">
                      {r.kind} · {r.area || "unscoped"} · {r.severity} · {new Date(r.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge tone={r.status === "fixed" || r.status === "closed" ? "success" : r.severity === "critical" ? "danger" : "neutral"}>
                    {r.status}
                  </Badge>
                </div>
                {r.kind === "bug" && (r.steps || r.expected || r.actual) && (
                  <div className="rounded-lg bg-card-elevated/60 p-2 text-xs text-ink-soft">
                    {r.steps && <p><span className="font-medium text-ink">Steps:</span> {r.steps}</p>}
                    {r.expected && <p><span className="font-medium text-ink">Expected:</span> {r.expected}</p>}
                    {r.actual && <p><span className="font-medium text-ink">Actual:</span> {r.actual}</p>}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                    placeholder={r.resolution_note || "Optional note for the tester"}
                    className="h-9 max-w-sm"
                  />
                  {STATUSES.filter((s) => s !== r.status).map((s) => (
                    <Button key={s} size="sm" variant="secondary" disabled={busyId === r.id} onClick={() => setStatus(r, s)}>
                      {s}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
