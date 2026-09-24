"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Badge, Button, ConfirmDialog, Input, Label, Select, Textarea, useToast,
} from "@/components/ui";
import type { Teacher, TeacherDoc, TeacherProfile } from "@/lib/types";
import { ProfileVersionHistory } from "@/components/app/ProfileVersionHistory";

type ReqField =
  | "required_methods" | "required_steps" | "preferred_notation" | "units_sig_figs"
  | "formatting_requirements" | "citation_requirements" | "essay_structure"
  | "lab_report_requirements" | "preferred_terminology" | "show_work_rules"
  | "calculator_rules" | "allowed_tools" | "prohibited_tools";

const REQ_FIELDS: { key: ReqField; label: string; hint?: string }[] = [
  { key: "required_methods", label: "Required solution methods", hint: "How this teacher wants problems solved — e.g. \"use the substitution method\"" },
  { key: "required_steps", label: "Required solution steps" },
  { key: "preferred_notation", label: "Preferred notation" },
  { key: "units_sig_figs", label: "Units & significant figures" },
  { key: "formatting_requirements", label: "Formatting requirements" },
  { key: "citation_requirements", label: "Citation & referencing" },
  { key: "essay_structure", label: "Essay structure" },
  { key: "lab_report_requirements", label: "Lab report requirements" },
  { key: "preferred_terminology", label: "Preferred terminology" },
  { key: "show_work_rules", label: "Showing work" },
  { key: "calculator_rules", label: "Calculator restrictions" },
  { key: "allowed_tools", label: "Allowed tools" },
  { key: "prohibited_tools", label: "Prohibited tools" },
];

const DOC_SECTIONS: { key: "official_instructions" | "rubrics" | "examples" | "corrections"; label: string }[] = [
  { key: "official_instructions", label: "Official instructions" },
  { key: "rubrics", label: "Rubrics & grading criteria" },
  { key: "examples", label: "Teacher's worked examples" },
  { key: "corrections", label: "Corrections & feedback" },
];

const EXTRACT_KINDS = [
  { value: "official", label: "Official instructions" },
  { value: "rubric", label: "Rubric or grading criteria" },
  { value: "example", label: "Worked example" },
  { value: "correction", label: "Feedback / corrections" },
];

function emptyProfile(): Record<ReqField, string> {
  return Object.fromEntries(REQ_FIELDS.map((f) => [f.key, ""])) as Record<ReqField, string>;
}

export function TeacherProfileEditor({ teacher, profile }: { teacher: Teacher; profile: TeacherProfile | null }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();

  const [name, setName] = useState(teacher.name);
  const [notes, setNotes] = useState(teacher.notes || "");
  const [req, setReq] = useState<Record<ReqField, string>>(
    profile ? (Object.fromEntries(REQ_FIELDS.map((f) => [f.key, (profile as unknown as Record<string, string>)[f.key] || ""])) as Record<ReqField, string>) : emptyProfile()
  );
  const [docs, setDocs] = useState<Record<string, TeacherDoc[]>>({
    official_instructions: profile?.official_instructions ?? [],
    rubrics: profile?.rubrics ?? [],
    examples: profile?.examples ?? [],
    corrections: profile?.corrections ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Extract-panel state
  const [kind, setKind] = useState("official");
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [extractBusy, setExtractBusy] = useState(false);

  // New-doc form state per section
  const [newDoc, setNewDoc] = useState<Record<string, { title: string; content: string; source: string; source_date: string; effective_date: string; description: string; archived: boolean }>>(
    Object.fromEntries(DOC_SECTIONS.map((s) => [s.key, { title: "", content: "", source: "", source_date: "", effective_date: "", description: "", archived: false }]))
  );
  const [openDocForm, setOpenDocForm] = useState<string | null>(null);
  const [confirmDocDelete, setConfirmDocDelete] = useState<{ section: string; index: number } | null>(null);

  async function ensureProfile(): Promise<string | null> {
    if (profile?.id) return profile.id;
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("teacher_profiles")
      .insert({ user_id: user!.id, teacher_id: teacher.id })
      .select("id")
      .single();
    if (error || !data) {
      toast("error", "Could not create the teacher profile: " + (error?.message ?? ""));
      return null;
    }
    // The unique_teacher_profile trigger guards against races; refresh to pick it up.
    router.refresh();
    return data.id;
  }

  async function onSaveBasics(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase
      .from("teachers")
      .update({ name: name.trim() || teacher.name, notes: notes.trim() })
      .eq("id", teacher.id);
    setBusy(false);
    if (error) {
      toast("error", "Could not save: " + error.message);
      return;
    }
    toast("success", "Saved.");
    router.refresh();
  }

  async function onSaveRequirements(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const profileId = await ensureProfile();
    if (!profileId) {
      setBusy(false);
      return;
    }
    const { error } = await supabase.from("teacher_profiles").update({ ...req }).eq("id", profileId);
    setBusy(false);
    if (error) {
      toast("error", "Could not save: " + error.message);
      return;
    }
    toast("success", "Requirements saved. New assignments will follow them.");
  }

  async function onDeleteTeacher() {
    setBusy(true);
    if (profile?.id) await supabase.from("teacher_profiles").delete().eq("id", profile.id);
    const { error } = await supabase.from("teachers").delete().eq("id", teacher.id);
    setBusy(false);
    setConfirmDelete(false);
    if (error) {
      toast("error", "Could not delete: " + error.message);
      return;
    }
    toast("success", "Teacher deleted.");
    router.push("/teachers");
  }

  async function onAddDoc(section: string) {
    const d = newDoc[section];
    if (!d.title.trim() || !d.content.trim()) {
      toast("error", "Give the document a title and paste its content.");
      return;
    }
    setBusy(true);
    const profileId = await ensureProfile();
    if (!profileId) {
      setBusy(false);
      return;
    }
    const doc: TeacherDoc = {
      title: d.title.trim(),
      content: d.content.trim(),
      ...(d.source.trim() ? { source: d.source.trim() } : {}),
      ...(d.source_date ? { source_date: d.source_date } : {}),
      ...(d.effective_date ? { effective_date: d.effective_date } : {}),
      ...(d.description.trim() ? { description: d.description.trim() } : {}),
      ...(d.archived ? { archived: true } : {}),
    };
    const next = [...(docs[section] ?? []), doc];
    const { error } = await supabase
      .from("teacher_profiles")
      .update({ [section]: next })
      .eq("id", profileId);
    setBusy(false);
    if (error) {
      toast("error", "Could not save the document: " + error.message);
      return;
    }
    setDocs((s) => ({ ...s, [section]: next }));
    setNewDoc((s) => ({ ...s, [section]: { title: "", content: "", source: "", source_date: "", effective_date: "", description: "", archived: false } }));
    setOpenDocForm(null);
    toast("success", "Document saved.");
  }

  async function onDeleteDoc(section: string, index: number) {
    const profileId = await ensureProfile();
    if (!profileId) return;
    setBusy(true);
    const next = (docs[section] ?? []).filter((_, i) => i !== index);
    const { error } = await supabase.from("teacher_profiles").update({ [section]: next }).eq("id", profileId);
    setBusy(false);
    setConfirmDocDelete(null);
    if (error) {
      toast("error", "Could not delete the document: " + error.message);
      return;
    }
    setDocs((s) => ({ ...s, [section]: next }));
    toast("success", "Document removed.");
  }


  /** Archives or restores a teacher source (spec §12: current vs outdated). */
  async function toggleArchived(section: string, index: number) {
    const profileId = await ensureProfile();
    if (!profileId) return;
    setBusy(true);
    const list = docs[section] ?? [];
    const next = list.map((d, i) => (i === index ? { ...d, archived: !d.archived } : d));
    const { error } = await supabase.from("teacher_profiles").update({ [section]: next }).eq("id", profileId);
    setBusy(false);
    if (error) {
      toast("error", "Could not update: " + error.message);
      return;
    }
    setDocs((s) => ({ ...s, [section]: next }));
    const doc = list[index];
    toast("info", doc.archived ? `Restored "${doc.title}" — its rules apply again.` : `Archived "${doc.title}" — its rules will no longer be applied.`);
  }

  async function onExtract() {
    if (!docContent.trim() || docContent.trim().length < 30) {
      toast("error", "Paste at least a bit of the document (30+ characters) so I have something to work with.");
      return;
    }
    setExtractBusy(true);
    try {
      const res = await fetch("/api/ai/extract-teacher-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacher_id: teacher.id, kind, title: docTitle.trim(), content: docContent }),
      });
      const json = await res.json();
      if (res.ok && json.data?.proposal_id) {
        toast("success", "Proposed — review it above before anything changes.");
        setDocContent("");
        setDocTitle("");
        router.refresh();
      } else if (res.ok && json.data?.message) {
        toast("info", json.data.message);
      } else {
        toast("error", json.error || "The extraction failed. Your document text is preserved — please try again.");
      }
    } catch {
      toast("error", "Could not reach the server. Your document text is preserved — please try again.");
    } finally {
      setExtractBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Basics */}
      <form onSubmit={onSaveBasics} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="tname">Name</Label>
            <Input id="tname" className="mt-1.5" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="tnotes">Notes</Label>
            <Input id="tnotes" className="mt-1.5" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
        </div>
        <div className="flex justify-between">
          <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>Delete teacher</Button>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save basics"}</Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this teacher?"
        message="Their profile and rules are deleted too. Courses keep running without one."
        confirmLabel="Delete"
        destructive
        onConfirm={onDeleteTeacher}
        onCancel={() => setConfirmDelete(false)}
      />

      {/* Requirements */}
      <form onSubmit={onSaveRequirements} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {REQ_FIELDS.map((f) => (
            <div key={f.key}>
              <Label htmlFor={f.key}>{f.label}</Label>
              <Textarea
                id={f.key}
                className="mt-1.5 min-h-20"
                value={req[f.key]}
                onChange={(e) => setReq((r) => ({ ...r, [f.key]: e.target.value }))}
                placeholder="Leave empty if this teacher hasn't said"
              />
              {f.hint && <p className="mt-1 text-xs text-ink-soft">{f.hint}</p>}
            </div>
          ))}
        </div>
        <Button type="submit" disabled={busy} className="w-full sm:w-auto">
          {busy ? "Saving…" : "Save requirements"}
        </Button>
      </form>

      {/* Documents */}
      {DOC_SECTIONS.map((s) => (
        <section key={s.key}>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">{s.label}</h3>
            <Button type="button" variant="secondary" size="sm" onClick={() => setOpenDocForm(openDocForm === s.key ? null : s.key)}>
              + Add document
            </Button>
          </div>

          {(docs[s.key] ?? []).length > 0 && (
            <div className="mb-3 space-y-2">
              {(docs[s.key] ?? []).map((d, i) => (
                <details key={i} className={`rounded-lg border border-ink/10 bg-white p-3 ${d.archived ? "opacity-60" : ""}`}>
                  <summary className="cursor-pointer text-sm font-medium text-ink">
                    {d.title}
                    {d.archived && <Badge tone="warn" className="ml-2">Archived — not applied</Badge>}
                    {d.source && <span className="ml-2 text-xs font-normal text-ink-soft">({d.source}{d.source_date ? `, ${d.source_date}` : ""})</span>}
                  </summary>
                  {d.description && <p className="mt-1 text-xs italic text-ink-soft">{d.description}</p>}
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{d.content}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => toggleArchived(s.key, i)}
                    >
                      {d.archived ? "Restore (current again)" : "Archive (outdated — stop applying)"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => setConfirmDocDelete({ section: s.key, index: i })}
                    >
                      Remove this document
                    </Button>
                  </div>
                </details>
              ))}
            </div>
          )}

          {openDocForm === s.key && (
            <div className="space-y-3 rounded-lg border border-ink/10 bg-white p-4">
              <div>
                <Label>Document title *</Label>
                <Input
                  className="mt-1.5"
                  value={newDoc[s.key].title}
                  onChange={(e) => setNewDoc((n) => ({ ...n, [s.key]: { ...n[s.key], title: e.target.value } }))}
                  placeholder='e.g. "Lab report format sheet"'
                />
              </div>
              <div>
                <Label>Content *</Label>
                <Textarea
                  className="mt-1.5 min-h-28"
                  value={newDoc[s.key].content}
                  onChange={(e) => setNewDoc((n) => ({ ...n, [s.key]: { ...n[s.key], content: e.target.value } }))}
                  placeholder="Paste the document text"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Source (optional)</Label>
                  <Input
                    className="mt-1.5"
                    value={newDoc[s.key].source}
                    onChange={(e) => setNewDoc((n) => ({ ...n, [s.key]: { ...n[s.key], source: e.target.value } }))}
                    placeholder="e.g. syllabus p.3"
                  />
                </div>
                <div>
                  <Label>Source date (optional)</Label>
                  <Input
                    type="date"
                    className="mt-1.5"
                    value={newDoc[s.key].source_date}
                    onChange={(e) => setNewDoc((n) => ({ ...n, [s.key]: { ...n[s.key], source_date: e.target.value } }))}
                  />
                </div>
                <div>
                  <Label>Effective from (optional)</Label>
                  <Input
                    type="date"
                    className="mt-1.5"
                    value={newDoc[s.key].effective_date}
                    onChange={(e) => setNewDoc((n) => ({ ...n, [s.key]: { ...n[s.key], effective_date: e.target.value } }))}
                  />
                </div>
              </div>
              <div>
                <Label>Description (optional)</Label>
                <Input
                  className="mt-1.5"
                  placeholder="e.g. Ms. Carter's official solution format for word problems"
                  value={newDoc[s.key].description}
                  onChange={(e) => setNewDoc((n) => ({ ...n, [s.key]: { ...n[s.key], description: e.target.value } }))}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-ink/30 accent-[var(--accent)]"
                  checked={newDoc[s.key].archived}
                  onChange={(e) => setNewDoc((n) => ({ ...n, [s.key]: { ...n[s.key], archived: e.target.checked } }))}
                />
                Archived / outdated (e.g. an old syllabus — its rules won&apos;t be applied)
              </label>
              <Button type="button" disabled={busy} onClick={() => onAddDoc(s.key)}>
                {busy ? "Saving…" : "Save document"}
              </Button>
            </div>
          )}
        </section>
      ))}

      <ConfirmDialog
        open={confirmDocDelete !== null}
        title="Remove this document?"
        message="It will no longer be used for assignments in this teacher's courses."
        confirmLabel="Remove"
        destructive
        onConfirm={() => confirmDocDelete && onDeleteDoc(confirmDocDelete.section, confirmDocDelete.index)}
        onCancel={() => setConfirmDocDelete(null)}
      />

      {/* AI notes */}
      {profile?.ai_notes && profile.ai_notes.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-ink">AI notes (unconfirmed)</h3>
          <p className="mb-2 text-xs text-ink-soft">These are AI interpretations, never treated as official requirements.</p>
          <div className="space-y-2">
            {profile.ai_notes.map((n, i) => (
              <div key={i} className="rounded-lg border border-warn/30 bg-warn/5 p-3">
                <Badge tone="warn">Unconfirmed</Badge>
                <p className="mt-1.5 text-sm text-ink">{n.note}: {n.proposed}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {profile?.id && <ProfileVersionHistory targetType="teacher" targetId={profile.id} />}

      {/* Extract rules */}
      <section className="rounded-card border border-accent/30 bg-accent-soft/30 p-4">
        <h3 className="text-sm font-semibold text-ink">Extract rules from a document</h3>
        <p className="mt-1 text-xs text-ink-soft">
          Paste a syllabus page, rubric, worked example, or graded feedback. I&apos;ll propose requirements — you approve before anything changes.
        </p>
        <div className="mt-3 space-y-3">
          <div>
            <Label htmlFor="kind">What kind of document is it?</Label>
            <Select id="kind" className="mt-1.5" value={kind} onChange={(e) => setKind(e.target.value)}>
              {EXTRACT_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="dtitle">Document title</Label>
            <Input id="dtitle" className="mt-1.5" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <Label htmlFor="dcontent">Document text</Label>
            <Textarea
              id="dcontent"
              className="mt-1.5 min-h-28"
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              placeholder="Paste the document text — a syllabus page, rubric, assignment feedback…"
            />
          </div>
          <Button onClick={onExtract} disabled={extractBusy}>
            {extractBusy ? "Analyzing…" : "Analyze with AI"}
          </Button>
        </div>
      </section>
    </div>
  );
}
