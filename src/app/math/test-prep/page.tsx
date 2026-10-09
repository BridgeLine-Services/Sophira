"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Spinner, Textarea, useToast } from "@/components/ui";

interface Prep { concepts?: { concept: string; review?: string }[]; study_plan?: { session: number; focus?: string; activities?: string }[]; priority?: string; weak_spots?: string }
interface Mat { id: string; title: string | null }

export default function TestPrepPage() {
  return <Suspense fallback={null}><TestPrepInner /></Suspense>;
}

function TestPrepInner() {
  const courseId = useSearchParams().get("course_id");
  const supabase = createClient();
  const { toast } = useToast();
  const [topics, setTopics] = useState("");
  const [examDate, setExamDate] = useState("");
  const [materials, setMaterials] = useState<Mat[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [prep, setPrep] = useState<Prep | null>(null);

  useEffect(() => {
    supabase.from("study_materials").select("id, title").order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => setMaterials((data as Mat[]) ?? []));
  }, [supabase]);

  async function build() {
    setBusy(true);
    try {
      const res = await fetch("/api/math/prepare", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topics, exam_date: examDate || null, material_ids: picked, course_id: courseId }),
      });
      const json = await res.json();
      if (!res.ok) { toast("error", json.error ?? "Could not build the study plan."); return; }
      setPrep(json.data);
    } finally { setBusy(false); }
  }

  return (
    <AppShell title="Test preparation" backHref={courseId ? `/courses/${courseId}` : "/math"}>
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-ink-soft">
          Review concepts, build a study plan, and prepare for exams from the topics you name and
          your own materials. The engine never invents material you did not provide.
        </p>
        <Card>
          <CardContent className="space-y-3 p-4">
            <div><Label htmlFor="ptopics">Topics on the exam</Label>
              <Textarea id="ptopics" className="mt-1.5" value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="e.g. Integration by parts, series convergence, improper integrals" /></div>
            <div><Label htmlFor="pexam">Exam date (optional)</Label>
              <Input id="pexam" type="date" className="mt-1.5" value={examDate} onChange={(e) => setExamDate(e.target.value)} /></div>
            {materials.length > 0 && (
              <div>
                <Label>Practice from your Library material</Label>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {materials.map((m) => (
                    <button key={m.id} type="button"
                      className={`rounded-lg border px-3 py-1.5 text-xs ${picked.includes(m.id) ? "border-accent bg-accent/10 text-accent" : "border-ink/10 text-ink-soft hover:bg-ink/5"}`}
                      onClick={() => setPicked((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]))}>
                      {m.title || "Untitled"}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink-soft">Attach notes, worksheets, or study guides — <Link href={courseId ? `/library?course_id=${courseId}` : "/library"} className="text-accent underline">add more in the Library</Link>.</p>
              </div>
            )}
            <Button onClick={build} disabled={busy || (!topics.trim() && picked.length === 0)}>{busy ? <Spinner /> : "Build study plan"}</Button>
          </CardContent>
        </Card>

        {prep && (
          <div className="space-y-4">
            {prep.priority && <Card><CardHeader><CardTitle>Study first</CardTitle></CardHeader><CardContent><p className="text-sm text-ink-soft">{prep.priority}</p></CardContent></Card>}
            {prep.concepts?.length ? (
              <Card><CardHeader><CardTitle>Concept review</CardTitle></CardHeader><CardContent className="space-y-2">
                {prep.concepts.map((c, i) => (
                  <div key={i} className="rounded-card border border-ink/10 p-3">
                    <p className="text-sm font-medium text-ink">{c.concept}</p>
                    {c.review && <p className="mt-1 text-xs text-ink-soft">{c.review}</p>}
                  </div>
                ))}
              </CardContent></Card>
            ) : null}
            {prep.study_plan?.length ? (
              <Card><CardHeader><CardTitle>Study plan</CardTitle></CardHeader><CardContent className="space-y-2">
                {prep.study_plan.map((s) => (
                  <div key={s.session} className="rounded-card border border-ink/10 p-3">
                    <p className="text-sm font-medium text-ink"><Badge tone="accent">Session {s.session}</Badge> {s.focus}</p>
                    {s.activities && <p className="mt-1 text-xs text-ink-soft">{s.activities}</p>}
                  </div>
                ))}
              </CardContent></Card>
            ) : null}
            {prep.weak_spots && <p className="text-xs text-ink-soft">{prep.weak_spots}</p>}
          </div>
        )}
      </div>
    </AppShell>
  );
}
