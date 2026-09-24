"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Button, Input, Label, Select, Textarea, useToast } from "@/components/ui";
import type { Teacher } from "@/lib/types";

const LEVELS = ["Middle school", "High school", "College", "Undergraduate", "Graduate", "PhD", "Other"];

export default function NewCoursePage() {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [form, setForm] = useState({
    name: "", subject: "", academic_level: "", institution: "", term: "", teacher_id: "", instructions: "",
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("teachers").select("*").order("name").then(({ data }) => setTeachers(data ?? []));
  }, [supabase]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast("error", "Please give the course a name.");
      return;
    }
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("courses").insert({
      user_id: user!.id,
      name: form.name.trim(),
      subject: form.subject.trim() || null,
      academic_level: form.academic_level || null,
      institution: form.institution.trim() || null,
      term: form.term.trim() || null,
      teacher_id: form.teacher_id || null,
      instructions: form.instructions,
    });
    setBusy(false);
    if (error) {
      toast("error", "Could not save the course: " + error.message);
      return;
    }
    toast("success", "Course added.");
    router.push("/courses");
  }

  return (
    <AppShell title="New course" backHref="/courses">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="name">Course name *</Label>
          <Input id="name" required className="mt-1.5" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. AP Calculus BC" />
        </div>
        <div>
          <Label htmlFor="subject">Subject</Label>
          <Input id="subject" className="mt-1.5" value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="e.g. Calculus, Biology, US History" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="level">Academic level</Label>
            <Select id="level" className="mt-1.5" value={form.academic_level} onChange={(e) => set("academic_level", e.target.value)}>
              <option value="">Choose one</option>
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="term">Term / semester</Label>
            <Input id="term" className="mt-1.5" value={form.term} onChange={(e) => set("term", e.target.value)} placeholder="e.g. Fall 2026" />
          </div>
        </div>
        <div>
          <Label htmlFor="institution">Institution</Label>
          <Input id="institution" className="mt-1.5" value={form.institution} onChange={(e) => set("institution", e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <Label htmlFor="teacher">Teacher</Label>
          <Select id="teacher" className="mt-1.5" value={form.teacher_id} onChange={(e) => set("teacher_id", e.target.value)}>
            <option value="">No teacher yet</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          {teachers.length === 0 && (
            <p className="mt-1.5 text-xs text-ink-soft">Teachers are added from the Teachers tab — you can set one later.</p>
          )}
        </div>
        <div>
          <Label htmlFor="instructions">Course instructions</Label>
          <Textarea id="instructions" className="mt-1.5 min-h-24" value={form.instructions} onChange={(e) => set("instructions", e.target.value)} placeholder="Anything this course requires: formats, methods, tools…" />
        </div>
        <Button type="submit" disabled={busy} className="w-full" size="lg">
          {busy ? "Saving…" : "Add course"}
        </Button>
      </form>
    </AppShell>
  );
}
