"use client";
import { useCallback, useState } from "react";
import {
  Badge, Button, ConfirmDialog, EmptyState, Input, Label, Select, Spinner, useToast,
} from "@/components/ui";
import {
  MEMORY_CATEGORIES,
  MEMORY_CATEGORY_LABELS,
  type MemoryCategory,
  type MemoryStatus,
  type StudentMemory,
} from "@/lib/memory/engine";
import { ClipboardList, Plus, Trash2 } from "lucide-react";

/**
 * NOTES FOR THIS ASSIGNMENT (scope 5 of five, 2026-11-14).
 *
 * The memory engine has always treated an assignment-scoped memory as the narrowest
 * and highest-precedence scope, and has always refused to apply one belonging to a
 * different assignment. But the only way to write one was the learning system:
 * /api/memory accepted a course and, since 2026-11-13, a teacher — nothing narrower.
 * That left the deepest scope unreachable by the student it describes.
 *
 * What a student can do here:
 *   - see only the notes that apply to THIS assignment;
 *   - add one ("this lab report needs an uncertainty column"), saved as a stated
 *     fact at full confidence, origin 'student_supplied' — never an AI guess;
 *   - turn one off, turn it back on, or remove it for good.
 *
 * What it deliberately does not do: invent notes, touch general/subject/course/teacher
 * memories, or override the brief and the teacher. Those still win, and a conflict is
 * reported rather than quietly resolved.
 */

const STATUS_LABEL: Record<MemoryStatus, string> = {
  active: "In use",
  monitoring: "Learning (not applied yet)",
  improving: "Improving",
  contradicted: "Needs checking",
  archived: "Archived",
  disabled: "Turned off",
  forgotten: "Removed",
};

const STATUS_TONE: Record<MemoryStatus, "neutral" | "accent" | "success" | "warn" | "danger"> = {
  active: "success",
  monitoring: "neutral",
  improving: "success",
  contradicted: "warn",
  archived: "neutral",
  disabled: "neutral",
  forgotten: "neutral",
};

export function AssignmentNotes({
  assignmentId,
  assignmentTitle,
  initialMemories,
}: {
  assignmentId: string;
  assignmentTitle: string;
  initialMemories: StudentMemory[];
}) {
  const { toast } = useToast();
  const [memories, setMemories] = useState<StudentMemory[]>(initialMemories);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statement, setStatement] = useState("");
  const [category, setCategory] = useState<MemoryCategory>("learning_preference");
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<StudentMemory | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/memory?assignment_id=${encodeURIComponent(assignmentId)}`);
    setLoading(false);
    if (!res.ok) {
      setError("We could not read your saved notes just now.");
      return;
    }
    const json = await res.json();
    setError(null);
    setMemories((json.data ?? []) as StudentMemory[]);
  }, [assignmentId]);

  async function save() {
    const text = statement.trim();
    if (text.length < 3) {
      setError("Write at least a few words, for example \"Put the uncertainty in its own column\".");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, statement: text, assignment_id: assignmentId }),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "We could not save that just now.");
      return;
    }
    setStatement("");
    setAdding(false);
    toast("success", "Saved. Sophira will use it only on this assignment.");
    void refresh();
  }

  async function act(memory: StudentMemory, action: "disable" | "restore" | "forget") {
    setBusyId(memory.id);
    const res = await fetch(`/api/memory/${memory.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "That did not work just now.");
      return;
    }
    setError(null);
    if (action === "disable") toast("success", "Turned off. Sophira will stop using it.");
    if (action === "restore") toast("success", "Turned back on.");
    if (action === "forget") toast("success", "Removed for good.");
    void refresh();
  }

  const shown = memories.filter((m) => m.status !== "forgotten");

  return (
    <div className="space-y-4">
      <div>
        <h2 className="panel-title">Notes for this assignment</h2>
        <p className="panel-sub mt-1">
          Anything you save here is used only while you work on {assignmentTitle}. It comes before your
          teacher, course and subject preferences, so you do not have to repeat it. The brief and your
          teacher&apos;s instructions still come first.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      {loading && shown.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-ink-soft">
          <Spinner className="h-4 w-4" /> Reading what you saved…
        </p>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-5 w-5" aria-hidden />}
          title="Nothing saved for this assignment yet"
          description="Add something specific to this piece of work, such as a formatting rule you keep forgetting. Sophira will use it here and nowhere else."
          action={<Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add a note</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {shown.map((m) => (
            <li key={m.id} className="rounded-panel border border-line bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{m.statement}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {MEMORY_CATEGORY_LABELS[m.category]}
                    {m.origin === "ai_inferred" ? " · noticed by Sophira, not yet confirmed by you" : " · added by you"}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {m.status === "disabled" ? (
                  <Button size="sm" variant="secondary" disabled={busyId === m.id} onClick={() => act(m, "restore")}>
                    Turn back on
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" disabled={busyId === m.id} onClick={() => act(m, "disable")}>
                    Turn off
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={busyId === m.id} onClick={() => setRemoveTarget(m)}>
                  <Trash2 className="h-4 w-4" aria-hidden /> Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <div className="space-y-3 rounded-panel border border-line bg-card-elevated/40 p-4">
          <div>
            <Label htmlFor="assignment-note-statement">What should Sophira remember for this assignment?</Label>
            <Input
              id="assignment-note-statement"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="Put the uncertainty in its own column"
              maxLength={200}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="assignment-note-category">What kind of note is it?</Label>
            <Select
              id="assignment-note-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as MemoryCategory)}
              className="mt-1"
            >
              {MEMORY_CATEGORIES.map((c) => (
                <option key={c} value={c}>{MEMORY_CATEGORY_LABELS[c]}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save note"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setError(null); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        shown.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add a note
          </Button>
        )
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove this note?"
        message="Sophira will stop using it straight away, and it cannot be undone."
        confirmLabel="Remove it"
        destructive
        onConfirm={() => {
          const target = removeTarget;
          setRemoveTarget(null);
          if (target) void act(target, "forget");
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
