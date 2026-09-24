"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import {
  Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Input, Label, Select, Textarea, useToast,
} from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { Library, Trash2 } from "lucide-react";
import type { StudyMaterial } from "@/lib/types";

const CATEGORIES: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "assignment", label: "Assignment" },
  { value: "course", label: "Course" },
  { value: "teacher_instructions", label: "Teacher instructions" },
  { value: "worked_example", label: "Worked example" },
  { value: "writing_sample", label: "Writing sample" },
  { value: "writing_profile", label: "Writing profile" },
  { value: "study_guide", label: "Study guide" },
  { value: "practice_question", label: "Practice question" },
  { value: "note", label: "Note" },
  { value: "ai_response", label: "AI response" },
  { value: "correction", label: "Correction" },
];

export default function LibraryPage() {
  const supabase = createClient();
  const { toast } = useToast();
  const [materials, setMaterials] = useState<StudyMaterial[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("newest");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("study_materials")
      .select("*")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setMaterials((data as StudyMaterial[]) ?? []);
        setLoaded(true);
      });
  }, [supabase]);

  const visible = useMemo(() => {
    let list = materials;
    if (category !== "all") list = list.filter((m) => m.category === category);
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          (m.content || "").toLowerCase().includes(q)
      );
    }
    if (sort === "oldest") list = [...list].reverse();
    else if (sort === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    return list;
  }, [materials, category, search, sort]);

  async function deleteMaterial(id: string) {
    const { error } = await supabase.from("study_materials").delete().eq("id", id);
    setConfirmDelete(null);
    if (error) {
      toast("error", "Could not delete: " + error.message);
      return;
    }
    setMaterials((m) => m.filter((x) => x.id !== id));
    toast("success", "Deleted.");
  }

  async function saveNote(e: FormEvent) {
    e.preventDefault();
    if (!noteTitle.trim() || !noteContent.trim()) {
      toast("error", "Give the note a title and some content.");
      return;
    }
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("study_materials")
      .insert({
        user_id: user!.id,
        category: "note",
        title: noteTitle.trim(),
        content: noteContent,
        tags: [],
      })
      .select("*")
      .single();
    setBusy(false);
    if (error) {
      toast("error", "Could not save the note: " + error.message);
      return;
    }
    setMaterials((m) => [data as StudyMaterial, ...m]);
    setNoteTitle("");
    setNoteContent("");
    setShowNoteForm(false);
    toast("success", "Note saved.");
  }

  return (
    <AppShell
      title="Library"
      actions={
        <Button size="sm" onClick={() => setShowNoteForm((s) => !s)}>+ New note</Button>
      }
    >
      <div className="space-y-4">
        {showNoteForm && (
          <form onSubmit={saveNote} className="space-y-3 rounded-card border border-ink/10 bg-white p-4">
            <div>
              <Label htmlFor="ntitle">Note title</Label>
              <Input id="ntitle" className="mt-1.5" value={noteTitle} onChange={(e) => setNoteTitle(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ncontent">Content</Label>
              <Textarea id="ncontent" className="mt-1.5 min-h-28" value={noteContent} onChange={(e) => setNoteContent(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save note"}</Button>
          </form>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
          <Input
            aria-label="Search"
            placeholder="Search your library…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="title">Title A–Z</option>
          </Select>
        </div>

        {loaded && visible.length === 0 ? (
          <EmptyState
            icon={<Library className="h-6 w-6" />}
            title={materials.length === 0 ? "Your library is empty" : "Nothing matches that filter"}
            description="Responses you save, study notes, and materials you keep will live here."
          />
        ) : (
          <div className="space-y-3">
            {visible.map((m) => (
              <Card key={m.id}>
                <CardContent className="p-4">
                  <details>
                    <summary className="cursor-pointer">
                      <span className="font-medium text-ink">{m.title}</span>
                      <span className="ml-2 text-xs text-ink-soft">{fmtDate(m.created_at)}</span>
                    </summary>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{m.content}</p>
                  </details>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge>{CATEGORIES.find((c) => c.value === m.category)?.label ?? m.category}</Badge>
                    {m.tags?.map((t) => <Badge key={t} tone="accent">{t}</Badge>)}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-danger"
                      aria-label={`Delete ${m.title}`}
                      onClick={() => setConfirmDelete(m.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <ConfirmDialog
          open={confirmDelete !== null}
          title="Delete this item?"
          message="This cannot be undone."
          confirmLabel="Delete"
          destructive
          onConfirm={() => confirmDelete && deleteMaterial(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      </div>
    </AppShell>
  );
}
