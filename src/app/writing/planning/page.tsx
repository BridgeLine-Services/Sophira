"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Spinner, Textarea, useToast } from "@/components/ui";
import { ListChecks } from "lucide-react";

interface Plan { understanding?: string; steps?: { step: number; title: string; detail?: string }[]; outline?: string[]; research_questions?: string[]; evidence_needed?: string[]; checklist?: string[] }

export default function PlanningPage() {
  return <Suspense fallback={null}><PlanningInner /></Suspense>;
}

function PlanningInner() {
  const courseId = useSearchParams().get("course_id");
  const { toast } = useToast();
  const [instructions, setInstructions] = useState("");
  const [topic, setTopic] = useState("");
  const [deadline, setDeadline] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [checked, setChecked] = useState<boolean[]>([]);

  async function makePlan() {
    if (!instructions.trim() && !topic.trim()) { toast("error", "Add the assignment instructions or a topic first."); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/writing/plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instructions, topic, deadline: deadline || null, course_id: courseId }),
      });
      const json = await res.json();
      if (!res.ok) { toast("error", json.error ?? "Planning failed."); return; }
      setPlan(json.data);
      setChecked((json.data.checklist ?? []).map(() => false));
    } finally { setBusy(false); }
  }

  return (
    <AppShell title="Planning" backHref={courseId ? `/courses/${courseId}` : "/writing"}>
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-ink-soft">
          Plan an assignment without completing it: understand the instructions, break it into
          steps, outline, develop research questions, organize evidence, and build a checklist.
          This tool never writes the assignment for you.
        </p>
        <Card>
          <CardContent className="space-y-3 p-4">
            <div><Label htmlFor="pinstr">Assignment instructions</Label>
              <Textarea id="pinstr" className="mt-1.5" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Paste the assignment instructions…" /></div>
            <div><Label htmlFor="ptopic">Topic (if there are no instructions)</Label>
              <Input id="ptopic" className="mt-1.5" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Causes of the French Revolution" /></div>
            <div><Label htmlFor="pdead">Deadline (optional)</Label>
              <Input id="pdead" type="date" className="mt-1.5" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></div>
            <Button onClick={makePlan} disabled={busy}>{busy ? <Spinner /> : "Make a plan"}</Button>
          </CardContent>
        </Card>

        {plan && (
          <div className="space-y-4">
            {plan.understanding && (
              <Card><CardHeader><CardTitle>What this assignment is asking</CardTitle></CardHeader>
                <CardContent><p className="text-sm text-ink-soft">{plan.understanding}</p></CardContent></Card>
            )}
            {plan.steps?.length ? (
              <Card><CardHeader><CardTitle>Steps</CardTitle></CardHeader><CardContent className="space-y-2">
                {plan.steps.map((s) => (
                  <div key={s.step} className="rounded-card border border-ink/10 p-3">
                    <p className="text-sm font-medium text-ink">{s.step}. {s.title}</p>
                    {s.detail && <p className="mt-1 text-xs text-ink-soft">{s.detail}</p>}
                  </div>
                ))}
              </CardContent></Card>
            ) : null}
            {plan.outline?.length ? (
              <Card><CardHeader><CardTitle>Outline</CardTitle></CardHeader><CardContent>
                <ul className="list-inside list-disc space-y-1 text-sm text-ink">{plan.outline.map((o, i) => <li key={i}>{o}</li>)}</ul>
              </CardContent></Card>
            ) : null}
            {plan.research_questions?.length ? (
              <Card><CardHeader><CardTitle>Research questions</CardTitle></CardHeader><CardContent>
                <ul className="list-inside list-disc space-y-1 text-sm text-ink">{plan.research_questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              </CardContent></Card>
            ) : null}
            {plan.evidence_needed?.length ? (
              <Card><CardHeader><CardTitle>Evidence to gather</CardTitle></CardHeader><CardContent>
                <ul className="list-inside list-disc space-y-1 text-sm text-ink">{plan.evidence_needed.map((e, i) => <li key={i}>{e}</li>)}</ul>
              </CardContent></Card>
            ) : null}
            {plan.checklist?.length ? (
              <Card><CardHeader><CardTitle className="flex items-center gap-2"><ListChecks className="h-4 w-4 text-accent" /> Completion checklist</CardTitle></CardHeader><CardContent className="space-y-1">
                {plan.checklist.map((c, i) => (
                  <label key={i} className="flex items-start gap-2 rounded-card p-2 text-sm text-ink hover:bg-ink/5">
                    <input type="checkbox" className="mt-1" checked={checked[i] ?? false}
                      onChange={() => setChecked((prev) => prev.map((v, j) => (j === i ? !v : v)))} />
                    <span>{c}</span>
                  </label>
                ))}
              </CardContent></Card>
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}
