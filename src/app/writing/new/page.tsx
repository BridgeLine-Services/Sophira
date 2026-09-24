"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Button, Input, Label, Select, Spinner, Textarea, useToast } from "@/components/ui";
import type { Course } from "@/lib/types";

const LEVELS = ["Kindergarten/Elementary", "Middle school", "High school", "College/Undergraduate", "Graduate/Master's", "PhD", "Other"];
const GENRES = ["Essay", "Discussion post", "Short answer", "Lab report", "Reflection", "Research writing", "Other"];

export default function NewWritingSamplePage() {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [form, setForm] = useState({
    title: "", genre: "Essay", course_id: "", academic_level: "", sample_date: "", representativeness: "preferred", content: "",
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    supabase.from("courses").select("*").order("name").then(({ data }) => setCourses(data ?? []));
  }, [supabase]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onUpload(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast("error", "That file is over 10 MB. Please paste the text instead.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const json = await res.json();
      if (res.ok && json.data?.extracted_text) {
        setForm((f) => ({ ...f, content: json.data.extracted_text }));
        toast("info", json.data.notes || "Text loaded from your file — review it below.");
      } else {
        toast("error", json.error || "Could not read that file. You can paste the text instead.");
      }
    } catch {
      toast("error", "Upload failed. You can paste the text instead.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      toast("error", "Please give the sample a title.");
      return;
    }
    if (!form.content.trim() || form.content.trim().length < 30) {
      toast("error", "Paste a bit more writing (at least 30 characters) so the sample is useful.");
      return;
    }
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("writing_samples").insert({
      user_id: user!.id,
      title: form.title.trim(),
      genre: form.genre || null,
      course_id: form.course_id || null,
      academic_level: form.academic_level || null,
      sample_date: form.sample_date || null,
      representativeness: form.representativeness,
      content: form.content,
    });
    setBusy(false);
    if (error) {
      toast("error", "Could not save: " + error.message);
      return;
    }
    toast("success", "Sample saved.");
    router.push("/writing");
  }

  return (
    <AppShell title="Add a writing sample" backHref="/writing">
      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <Label htmlFor="title">Title *</Label>
          <Input id="title" required className="mt-1.5" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder='e.g. "History essay — Civil War"' />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="genre">Genre</Label>
            <Select id="genre" className="mt-1.5" value={form.genre} onChange={(e) => set("genre", e.target.value)}>
              {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="course">Course</Label>
            <Select id="course" className="mt-1.5" value={form.course_id} onChange={(e) => set("course_id", e.target.value)}>
              <option value="">None</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
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
            <Label htmlFor="date">Date written</Label>
            <Input id="date" type="date" className="mt-1.5" value={form.sample_date} onChange={(e) => set("sample_date", e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor="repr">Does this represent how you want to write?</Label>
          <Select id="repr" className="mt-1.5" value={form.representativeness} onChange={(e) => set("representativeness", e.target.value)}>
            <option value="preferred">Represents how I want to write (preferred)</option>
            <option value="neutral">Neutral / okay example</option>
            <option value="not_representative">Does NOT represent my style</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="content">Your writing *</Label>
          <Textarea id="content" className="mt-1.5 min-h-64" value={form.content} onChange={(e) => set("content", e.target.value)} placeholder="Paste your writing here" />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="inline-flex h-11 cursor-pointer items-center rounded-lg border border-ink/15 px-4 text-sm font-medium text-ink hover:bg-ink/5">
              {uploading ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {uploading ? "Reading file…" : "…or upload a text file or PDF"}
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.md,.pdf"
                className="sr-only"
                onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
              />
            </label>
            {form.content && <span className="text-xs text-ink-soft">{form.content.length.toLocaleString()} characters</span>}
          </div>
        </div>
        <Button type="submit" disabled={busy} className="w-full" size="lg">
          {busy ? "Saving…" : "Save sample"}
        </Button>
      </form>
    </AppShell>
  );
}
