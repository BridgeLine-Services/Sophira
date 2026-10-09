"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, Spinner, Textarea, useToast } from "@/components/ui";

interface Problem { id: number; problem?: string; answer?: string; steps?: string[]; concept?: string }
interface Check { correct?: boolean; where?: string; explanation?: string; follow_up?: string }
interface Mat { id: string; title: string | null }

export default function PracticePage() {
  return <Suspense fallback={null}><PracticeInner /></Suspense>;
}

function PracticeInner() {
  const courseId = useSearchParams().get("course_id");
  const supabase = createClient();
  const { toast } = useToast();
  const [topic, setTopic] = useState("");
  const [materials, setMaterials] = useState<Mat[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [revealed, setRevealed] = useState<number[]>([]);
  const [attempts, setAttempts] = useState<Record<number, string>>({});
  const [checks, setChecks] = useState<Record<number, Check>>({});

  useEffect(() => {
    supabase.from("study_materials").select("id, title").order("created_at", { ascending: false }).limit(50)
      .then(({ data }) => setMaterials((data as Mat[]) ?? []));
  }, [supabase]);

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch("/api/math/practice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "generate", topic, count: 5, material_ids: picked, course_id: courseId, past_problems: problems.map((p) => p.problem ?? "") }),
      });
      const json = await res.json();
      if (!res.ok) { toast("error", json.error ?? "Could not generate problems."); return; }
      setProblems((prev) => [...prev, ...(json.data.problems ?? [])]);
      setRevealed([]);
      setAttempts({});
      setChecks({});
    } finally { setBusy(false); }
  }

  async function checkAttempt(p: Problem) {
    const attempt = (attempts[p.id] ?? "").trim();
    if (!attempt) { toast("error", "Write your attempt first — attempt the problem before checking."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/math/practice", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "check", problem: p.problem, student_answer: attempt, course_id: courseId }),
      });
      const json = await res.json();
      if (!res.ok) { toast("error", json.error ?? "Could not check your attempt."); return; }
      setChecks((c) => ({ ...c, [p.id]: json.data }));
      setRevealed((r) => (r.includes(p.id) ? r : [...r, p.id]));
    } finally { setBusy(false); }
  }

  return (
    <AppShell title="Practice problems" backHref={courseId ? `/courses/${courseId}` : "/math"}>
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-ink-soft">
          Practice problems generated from material you provide — your notes, worksheets,
          textbooks, or study guides. Attempt each problem before revealing the answer; feedback
          targets your demonstrated weaknesses.
        </p>
        <Card>
          <CardContent className="space-y-3 p-4">
            <label htmlFor="prtopic" className="text-sm font-medium text-ink">Topic (or just pick material)</label>
            <Textarea id="prtopic" className="min-h-16" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Solving quadratic equations" />
            {materials.length > 0 && (
              <div>
                <p className="text-sm font-medium text-ink">Generate from your Library material</p>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {materials.map((m) => (
                    <button key={m.id} type="button"
                      className={`rounded-lg border px-3 py-1.5 text-xs ${picked.includes(m.id) ? "border-accent bg-accent/10 text-accent" : "border-ink/10 text-ink-soft hover:bg-ink/5"}`}
                      onClick={() => setPicked((p) => (p.includes(m.id) ? p.filter((x) => x !== m.id) : [...p, m.id]))}>
                      {m.title || "Untitled"}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-ink-soft"><Link href={courseId ? `/library?course_id=${courseId}` : "/library"} className="text-accent underline">Add material in the Library</Link>.</p>
              </div>
            )}
            <Button onClick={generate} disabled={busy || (!topic.trim() && picked.length === 0)}>{busy ? <Spinner /> : "Generate problems"}</Button>
          </CardContent>
        </Card>

        {problems.map((p, i) => (
          <Card key={p.id + "-" + i}>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm font-medium text-ink">Problem {i + 1}{p.concept ? <> <Badge tone="neutral">{p.concept}</Badge></> : null}</p>
              <p className="whitespace-pre-wrap text-sm text-ink">{p.problem}</p>
              <Textarea className="min-h-20" placeholder="Your attempt — try the problem before revealing the answer…"
                value={attempts[p.id] ?? ""} onChange={(e) => setAttempts((a) => ({ ...a, [p.id]: e.target.value }))} />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => checkAttempt(p)} disabled={busy}>Check my attempt</Button>
                <Button size="sm" variant="secondary" onClick={() => setRevealed((r) => (r.includes(p.id) ? r : [...r, p.id]))}>Reveal answer</Button>
              </div>
              {checks[p.id] && (
                <div className={`rounded-card border p-3 text-sm ${checks[p.id].correct ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}`}>
                  <p className="font-medium text-ink">{checks[p.id].correct ? "Correct — nicely done." : "Not quite yet."}</p>
                  {checks[p.id].where && <p className="mt-1 text-ink-soft">{checks[p.id].where}</p>}
                  {checks[p.id].explanation && <p className="mt-1 text-ink-soft">{checks[p.id].explanation}</p>}
                  {checks[p.id].follow_up && <p className="mt-1 text-ink-soft"><span className="font-medium text-ink">Follow-up: </span>{checks[p.id].follow_up}</p>}
                </div>
              )}
              {revealed.includes(p.id) && p.answer && (
                <div className="rounded-card border border-ink/10 p-3 text-sm">
                  <p className="font-medium text-ink">Answer: {p.answer}</p>
                  {p.steps?.length ? (
                    <ol className="mt-2 list-inside list-decimal space-y-1 text-xs text-ink-soft">
                      {p.steps.map((s, j) => <li key={j}>{s}</li>)}
                    </ol>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
