"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, ConfirmDialog, Input, Label, Select, Textarea, useToast } from "@/components/ui";
import type { Course, Teacher } from "@/lib/types";

const LEVELS = ["Middle school", "High school", "College", "Undergraduate", "Graduate", "PhD", "Other"];

export function CourseEditor({ course, teachers }: { course: Course; teachers: Pick<Teacher, "id" | "name">[] }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: course.name,
    subject: course.subject || "",
    academic_level: course.academic_level || "",
    institution: course.institution || "",
    term: course.term || "",
    teacher_id: course.teacher_id || "",
    instructions: course.instructions || "",
  });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast("error", "Please give the course a name.");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("courses")
      .update({
        name: form.name.trim(),
        subject: form.subject.trim() || null,
        academic_level: form.academic_level || null,
        institution: form.institution.trim() || null,
        term: form.term.trim() || null,
        teacher_id: form.teacher_id || null,
        instructions: form.instructions,
      })
      .eq("id", course.id);
    setBusy(false);
    if (error) {
      toast("error", "Could not save: " + error.message);
      return;
    }
    toast("success", "Course updated.");
    router.refresh();
  }

  async function onDelete() {
    setBusy(true);
    const { error } = await supabase.from("courses").delete().eq("id", course.id);
    setBusy(false);
    setConfirmDelete(false);
    if (error) {
      toast("error", "Could not delete: " + error.message);
      return;
    }
    toast("success", "Course deleted.");
    router.push("/courses");
  }

  return (
    <form onSubmit={onSave} className="space-y-4">
      <div>
        <Label htmlFor="name">Course name *</Label>
        <Input id="name" required className="mt-1.5" value={form.name} onChange={(e) => set("name", e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="subject">Subject</Label>
          <Input id="subject" className="mt-1.5" value={form.subject} onChange={(e) => set("subject", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="level">Academic level</Label>
          <Select id="level" className="mt-1.5" value={form.academic_level} onChange={(e) => set("academic_level", e.target.value)}>
            <option value="">Choose one</option>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </Select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="institution">Institution</Label>
          <Input id="institution" className="mt-1.5" value={form.institution} onChange={(e) => set("institution", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="term">Term / semester</Label>
          <Input id="term" className="mt-1.5" value={form.term} onChange={(e) => set("term", e.target.value)} />
        </div>
      </div>
      <div>
        <Label htmlFor="teacher">Teacher</Label>
        <Select id="teacher" className="mt-1.5" value={form.teacher_id} onChange={(e) => set("teacher_id", e.target.value)}>
          <option value="">No teacher yet</option>
          {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </div>
      <div>
        <Label htmlFor="instructions">Course instructions</Label>
        <Textarea id="instructions" className="mt-1.5 min-h-24" value={form.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="Anything this course requires: formats, methods, tools…" />
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-ink/10 pt-4">
        <Button type="button" variant="danger" onClick={() => setConfirmDelete(true)}>Delete course</Button>
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this course?"
        message="Its assignments stay, but lose their course link. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </form>
  );
}
