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
import { GraduationCap, Plus, Trash2 } from "lucide-react";

/**
 * TEACHER PREFERENCES (scope 4 of five, 2026-11-13).
 *
 * The memory engine has always ranked a teacher-scoped memory above course,
 * subject and general ones, and has always refused to apply it to another
 * teacher's work — but a student had no way to write one: /api/memory accepted
 * a course and nothing narrower. This card closes that gap on the teacher's own
 * page.
 *
 * What a student can do here:
 *   - see only the preferences that apply to THIS teacher;
 *   - add one (saved as a student-stated fact, full confidence, origin
 *     'student_supplied' — never an AI guess);
 *   - turn one off, turn it back on, or remove it for good.
 *
 * What it deliberately does not do: invent preferences, touch course/subject/
 * general memories, or change the teacher's official requirements (those stay in
 * the Teacher profile above, which outranks everything here).
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

export function TeacherPreferences({
  teacherId,
  teacherName,
  initialMemories,
}: {
  teacherId: string;
  teacherName: string;
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
    const res = await fetch(`/api/memory?teacher_id=${encodeURIComponent(teacherId)}`);
    setLoading(false);
    if (!res.ok) {
      setError("We could not read your saved preferences just now.");
      return;
    }
    const json = await res.json();
    setError(null);
    setMemories((json.data ?? []) as StudentMemory[]);
  }, [teacherId]);

  async function save() {
    const text = statement.trim();
    if (text.length < 3) {
      setError("Write at least a few words, for example \"Always show the working first\".");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, statement: text, teacher_id: teacherId }),
    });
    setSaving(false);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setError(json.error || "We could not save that just now.");
      return;
    }
    setStatement("");
    setAdding(false);
    toast("success", `Saved. Sophira will use it only with ${teacherName}.`);
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
        <h2 className="panel-title">Preferences for {teacherName}</h2>
        <p className="panel-sub mt-1">
          These apply only when you are working with {teacherName}. They come before your course,
          subject and general preferences, so you never have to say them twice. Official requirements
          in the teacher profile above still come first.
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
          icon={<GraduationCap className="h-5 w-5" aria-hidden />}
          title={`Nothing saved for ${teacherName} yet`}
          description={`Add how they want work done — for example how much working to show, or how they like essays set out. Sophira will use it only with this teacher.`}
          action={<Button size="sm" onClick={() => setAdding(true)}><Plus className="h-4 w-4" aria-hidden /> Add a preference</Button>}
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
            <Label htmlFor="teacher-pref-statement">What should Sophira remember about {teacherName}?</Label>
            <Input
              id="teacher-pref-statement"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="Always show the working before the answer"
              maxLength={200}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="teacher-pref-category">What kind of preference is it?</Label>
            <Select
              id="teacher-pref-category"
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
              {saving ? "Saving…" : "Save preference"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setError(null); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        shown.length > 0 && (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Add a preference
          </Button>
        )
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title={`Remove this preference for ${teacherName}?`}
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
