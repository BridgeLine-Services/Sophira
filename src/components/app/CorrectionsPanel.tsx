"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardContent, EmptyState, Spinner } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { describePatternStatus, describeStaleness, type LearningPattern } from "@/lib/learning/patterns";
import { AlertTriangle, CheckCircle2, Pencil, RotateCcw, Trash2 } from "lucide-react";

/**
 * Learning & Corrections (workflow §9–§12): the student's structured personal
 * knowledge — observed mistakes, learned methods, established corrections —
 * with lifecycle controls. The AI can only OBSERVE patterns; confirming,
 * correcting, reactivating, or forgetting them happens ONLY here, by the
 * student.
 */
const KIND_LABEL: Record<LearningPattern["kind"], string> = {
  mistake: "Mistake",
  method: "Learned method",
  preference: "Preference",
  correction: "Established correction",
};

export function CorrectionsPanel({ initialPatterns }: { initialPatterns: LearningPattern[] }) {
  const [patterns, setPatterns] = useState(initialPatterns);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/learning/patterns");
    if (res.ok) {
      const json = await res.json();
      setPatterns(json.data);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function act(id: string, action: string) {
    setBusyId(id);
    try {
      await fetch("/api/learning/patterns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleHabit(p: LearningPattern) {
    setBusyId(p.id);
    try {
      await fetch("/api/learning/patterns", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: p.id, action: "set_intentional", intentional: !p.intentional }),
      });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function forget(id: string) {
    setBusyId(id);
    try {
      await fetch(`/api/learning/patterns?id=${id}`, { method: "DELETE" });
      await refresh();
    } finally {
      setBusyId(null);
    }
  }

  const active = patterns.filter((p) => ["candidate", "active", "recurring", "temporary"].includes(p.status));
  const corrected = patterns.filter((p) => ["corrected", "inactive"].includes(p.status));
  const required = patterns.filter((p) => p.status === "teacher_required");

  const renderPattern = (p: LearningPattern) => (
    <Card key={p.id}>
      <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
            {p.description}
            <Badge>{KIND_LABEL[p.kind]}</Badge>
            <Badge>{p.scope}{p.subject ? `: ${p.subject}` : ""}</Badge>
            <Badge>{describePatternStatus(p.status)}</Badge>
            {p.intentional && <Badge>preserved writing habit</Badge>}
            {describeStaleness(p) && <Badge tone="warn">stale — excluded from AI context</Badge>}
          </p>
          {describeStaleness(p) && (
            <p className="mt-1 flex items-center gap-1 text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5" /> {describeStaleness(p)}
            </p>
          )}
          <p className="mt-0.5 text-xs text-ink-soft">
            first observed {fmtDate(p.first_observed)} · last observed {fmtDate(p.last_observed)} ·
            seen {p.observation_count}× · confidence {Math.round(p.confidence * 100)}% · source: {p.source}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {p.status === "candidate" && (
            <Button size="sm" disabled={busyId === p.id} onClick={() => act(p.id, "confirm")}>
              <CheckCircle2 className="h-4 w-4" /> Yes, that&apos;s me
            </Button>
          )}
          {["candidate", "active", "recurring", "temporary"].includes(p.status) && (
            <Button size="sm" variant="secondary" disabled={busyId === p.id} onClick={() => act(p.id, "mark_corrected")}>
              I&apos;ve fixed this
            </Button>
          )}
          {p.kind === "mistake" && ["active", "recurring", "temporary"].includes(p.status) && (
            <Button
              size="sm"
              variant={p.intentional ? "secondary" : "ghost"}
              disabled={busyId === p.id}
              onClick={() => toggleHabit(p)}
              title="Only for matching your established writing voice — never in fresh academic work, and teacher requirements always win."
            >
              <Pencil className="h-4 w-4" />
              {p.intentional ? "Stop matching" : "Match in my writing"}
            </Button>
          )}
          {["corrected", "inactive"].includes(p.status) && (
            <Button size="sm" variant="secondary" disabled={busyId === p.id} onClick={() => act(p.id, "reactivate")}>
              <RotateCcw className="h-4 w-4" /> It came back
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busyId === p.id} onClick={() => forget(p.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-8">
      {patterns.length === 0 && (
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6" />}
          title="Nothing learned yet"
          description="When you use Check my work, Sophira observes recurring mistakes and records them here. You confirm or correct each one — nothing is assumed."
        />
      )}

      {active.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">Active patterns</h2>
          <div className="space-y-2">{active.map(renderPattern)}</div>
        </section>
      )}

      {required.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">Teacher-required</h2>
          <div className="space-y-2">{required.map(renderPattern)}</div>
        </section>
      )}

      {corrected.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">Corrected / inactive</h2>
          <p className="mb-2 text-xs text-ink-soft">
            These are no longer applied to your work. If one shows up again in your submissions, mark it
            &quot;It came back&quot; — Sophira will not silently assume the old state was permanent.
          </p>
          <div className="space-y-2">{corrected.map(renderPattern)}</div>
        </section>
      )}

      {busyId && <Spinner />}
    </div>
  );
}
