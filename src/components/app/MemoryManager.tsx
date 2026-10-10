"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Spinner } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import {
  MEMORY_CATEGORY_LABELS,
  MEMORY_CATEGORIES,
  type MemoryCategory,
  type MemoryStatus,
  type StudentMemory,
  type MemoryEvidenceRow,
} from "@/lib/memory/engine";
import { Brain, CheckCircle2, Eye, EyeOff, Pencil, Search, Trash2 } from "lucide-react";

/**
 * Memory Management (workflow §28): the student's long-term academic memory.
 * The student views, searches, filters, inspects the EVIDENCE behind each
 * memory, edits, disables, re-enables, or permanently forgets them.
 * Manually supplied facts are clearly distinguished from AI-inferred
 * observations — the AI never asserts an inferred hypothesis as fact.
 */
const STATUS_LABEL: Record<MemoryStatus, string> = {
  active: "Active",
  monitoring: "Monitoring (AI hypothesis)",
  improving: "Improving",
  contradicted: "Contradicted",
  archived: "Archived",
  disabled: "Disabled",
  forgotten: "Forgotten",
};

interface MemoryWithCount extends StudentMemory {
  evidence_count?: number;
}

export function MemoryManager({
  initialMemories,
  subjectFilter,
}: {
  initialMemories: MemoryWithCount[];
  /** When set (course workspace), the list narrows to this subject + global memories. */
  subjectFilter?: string | string[] | null;
}) {
  const [memories, setMemories] = useState(initialMemories);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, MemoryEvidenceRow[]>>({});
  const [editing, setEditing] = useState<MemoryWithCount | null>(null);
  const [editStatement, setEditStatement] = useState("");
  const [editDetails, setEditDetails] = useState("");
  const [adding, setAdding] = useState(false);
  const [newCategory, setNewCategory] = useState<MemoryCategory>("goal");
  const [newStatement, setNewStatement] = useState("");
  const [newDetails, setNewDetails] = useState("");
  const [newSubject, setNewSubject] = useState("");
  const [forgetTarget, setForgetTarget] = useState<MemoryWithCount | null>(null);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category) params.set("category", category);
    if (status) params.set("status", status);
    const res = await fetch(`/api/memory?${params.toString()}`);
    if (res.ok) {
      const json = await res.json();
      setMemories(json.data);
    }
  }, [q, category, status]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function loadEvidence(id: string) {
    const res = await fetch(`/api/memory/${id}`);
    if (res.ok) {
      const json = await res.json();
      setEvidence((prev) => ({ ...prev, [id]: json.data.evidence }));
    }
  }

  async function act(id: string, action: string) {
    setBusyId(id);
    const res = await fetch(`/api/memory/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    if (res.ok) void refresh();
  }

  async function saveEdit() {
    if (!editing) return;
    setBusyId(editing.id);
    const res = await fetch(`/api/memory/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statement: editStatement, details: editDetails }),
    });
    setBusyId(null);
    if (res.ok) {
      setEditing(null);
      void refresh();
    }
  }

  async function addMemory() {
    if (newStatement.trim().length < 3) return;
    setBusyId("new");
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category: newCategory,
        statement: newStatement,
        details: newDetails,
        subject: newSubject || null,
      }),
    });
    setBusyId(null);
    if (res.ok) {
      setAdding(false);
      setNewStatement("");
      setNewDetails("");
      setNewSubject("");
      void refresh();
    }
  }

  async function forget(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/memory/${id}`, { method: "DELETE" });
    setBusyId(null);
    setForgetTarget(null);
    if (res.ok) void refresh();
  }

  const filtered = useMemo(() => {
    if (!subjectFilter) return memories;
    // Course/subject workspace: keep these subjects' memories plus
    // explicitly global ones (subjectFilter may be one subject or a set).
    const wants = (Array.isArray(subjectFilter) ? subjectFilter : [subjectFilter]).map((w) => w.toLowerCase());
    return memories.filter((m) => {
      const subj = (m.subject ?? "").toLowerCase();
      return !subj || wants.some((w) => subj.includes(w) || w.includes(subj));
    });
  }, [memories, subjectFilter]);

  return (
    <div className="space-y-4">
      {/* Search / filter controls */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your memories…"
              className="pl-9"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {MEMORY_CATEGORIES.map((mc) => (
              <option key={mc} value={mc}>{MEMORY_CATEGORY_LABELS[mc]}</option>
            ))}
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            aria-label="Filter by status"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="monitoring">Monitoring (AI)</option>
            <option value="improving">Improving</option>
            <option value="contradicted">Contradicted</option>
            <option value="archived">Archived</option>
            <option value="disabled">Disabled</option>
          </select>
          <Button size="sm" onClick={() => setAdding(true)}>
            <Pencil className="h-4 w-4" /> Add memory
          </Button>
        </CardContent>
      </Card>

      {/* Add-memory form */}
      {adding && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm font-medium">Add a memory about yourself</p>
            <p className="text-xs text-ink-soft">
              Memories you add are marked <Badge>student-stated fact</Badge> and trusted at full
              confidence. AI-inferred memories are always separate and always show their evidence.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-ink-soft">Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                >
                  {MEMORY_CATEGORIES.map((mc) => (
                    <option key={mc} value={mc}>{MEMORY_CATEGORY_LABELS[mc]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-ink-soft">Subject (optional)</label>
                <Input value={newSubject} onChange={(e) => setNewSubject(e.target.value)} placeholder="e.g. algebra" className="mt-1" />
              </div>
            </div>
            <div>
              <label className="text-xs text-ink-soft">Statement</label>
              <Input value={newStatement} onChange={(e) => setNewStatement(e.target.value)} placeholder="e.g. I want an A in calculus this semester" className="mt-1" />
            </div>
            <div>
              <label className="text-xs text-ink-soft">Details (optional)</label>
              <Input value={newDetails} onChange={(e) => setNewDetails(e.target.value)} placeholder="Anything the AI should know about it" className="mt-1" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busyId === "new"} onClick={addMemory}>Save</Button>
              <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Memory list */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<Brain className="h-6 w-6" />}
          title="No memories yet"
          description="Long-term memories build up as you study — observed strengths, weaknesses, habits, and your goals. You can also add your own above."
        />
      ) : (
        <div className="space-y-2">
          {filtered.map((m) => (
            <Card key={m.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{m.statement}</span>
                  <Badge>{MEMORY_CATEGORY_LABELS[m.category]}</Badge>
                  <Badge>{m.origin === "student_supplied" ? "student-stated fact" : "AI-inferred"}</Badge>
                  <Badge>{STATUS_LABEL[m.status]}</Badge>
                  {m.subject && <Badge>{m.subject}</Badge>}
                </div>
                {m.details && <p className="text-sm text-ink-soft">{m.details}</p>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-soft">
                  <span>confidence {Math.round(m.confidence * 100)}%</span>
                  <span>evidence: {m.evidence_count ?? 0} item{(m.evidence_count ?? 0) === 1 ? "" : "s"}</span>
                  <span>first observed {fmtDate(m.first_observed)}</span>
                  <span>last observed {fmtDate(m.last_observed)}</span>
                  {m.improvement_trend === "improving" && <span className="font-medium text-green-700">trend: improving</span>}
                  {m.improvement_trend === "regressing" && <span className="font-medium text-red-700">trend: regressing</span>}
                  {m.improvement_trend === "plateaued" && <span>trend: plateaued</span>}
                </div>
                {/* Confidence bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(m.confidence * 100)}%` }} />
                </div>
                {/* Evidence inspector */}
                {(m.evidence_count ?? 0) > 0 && (
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === m.id}
                      onClick={() => {
                        if (openEvidence === m.id) {
                          setOpenEvidence(null);
                        } else {
                          setOpenEvidence(m.id);
                          if (!evidence[m.id]) void loadEvidence(m.id);
                        }
                      }}
                    >
                      <Eye className="h-4 w-4" /> {openEvidence === m.id ? "Hide evidence" : `Inspect evidence (${m.evidence_count})`}
                    </Button>
                    {openEvidence === m.id && (
                      <ul className="mt-2 space-y-1 rounded-md border border-input bg-card p-3">
                        {(evidence[m.id] || []).length === 0 && <li className="text-xs text-ink-soft"><Spinner className="mr-2 inline h-3 w-3" /> loading…</li>}
                        {(evidence[m.id] || []).map((ev) => (
                          <li key={ev.id} className="text-xs">
                            <span className={ev.polarity === "positive" ? "text-green-700" : "text-red-700"}>
                              {ev.polarity === "positive" ? "supports" : "contradicts"}
                            </span>{" "}
                            · {ev.evidence_type.replace(/_/g, " ")} · {ev.summary} · {fmtDate(ev.observed_at)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                {/* Controls — this is YOUR memory; the AI only observes */}
                <div className="flex flex-wrap gap-2">
                  {m.status !== "disabled" && m.status !== "archived" && (
                    <Button size="sm" variant="secondary" disabled={busyId === m.id} onClick={() => act(m.id, "disable")}>
                      <EyeOff className="h-4 w-4" /> Disable
                    </Button>
                  )}
                  {(m.status === "disabled" || m.status === "archived" || m.status === "contradicted") && (
                    <Button size="sm" disabled={busyId === m.id} onClick={() => act(m.id, "restore")}>
                      <CheckCircle2 className="h-4 w-4" /> Re-enable
                    </Button>
                  )}
                  {m.status === "active" && (
                    <Button size="sm" variant="ghost" disabled={busyId === m.id} onClick={() => act(m.id, "archive")}>
                      Archive
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === m.id}
                    onClick={() => {
                      setEditing(m);
                      setEditStatement(m.statement);
                      setEditDetails(m.details);
                    }}
                  >
                    <Pencil className="h-4 w-4" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busyId === m.id} onClick={() => setForgetTarget(m)}>
                    <Trash2 className="h-4 w-4" /> Forget
                  </Button>
                </div>
                {editing?.id === m.id && (
                  <div className="space-y-2 rounded-md border border-input p-3">
                    <Input value={editStatement} onChange={(e) => setEditStatement(e.target.value)} aria-label="Statement" />
                    <Input value={editDetails} onChange={(e) => setEditDetails(e.target.value)} aria-label="Details" />
                    <div className="flex gap-2">
                      <Button size="sm" disabled={busyId === m.id} onClick={saveEdit}>Save</Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={forgetTarget !== null}
        title="Forget this memory permanently?"
        message={forgetTarget ? `"${forgetTarget.statement}" and ALL its evidence will be permanently deleted from your long-term memory. The AI will never consider it again. This cannot be undone.` : ""}
        confirmLabel="Forget permanently"
        onCancel={() => setForgetTarget(null)}
        onConfirm={() => forgetTarget && forget(forgetTarget.id)}
      />
    </div>
  );
}
