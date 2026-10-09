"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { Button, Card, CardContent, Spinner, Textarea, useToast } from "@/components/ui";
import { GraduationCap } from "lucide-react";

export default function TutorPage() {
  return <Suspense fallback={null}><TutorInner /></Suspense>;
}

function TutorInner() {
  const courseId = useSearchParams().get("course_id");
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<{ role: "you" | "engine"; text: string }[]>([]);

  async function ask() {
    const q = question.trim();
    if (!q) return;
    setBusy(true);
    setThread((t) => [...t, { role: "you", text: q }]);
    setQuestion("");
    try {
      const res = await fetch("/api/tutor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, course_id: courseId }),
      });
      const json = await res.json();
      if (!res.ok) { toast("error", json.error ?? "The engine could not answer."); return; }
      setThread((t) => [...t, { role: "engine", text: json.data.answer }]);
    } finally { setBusy(false); }
  }

  return (
    <AppShell title="Subject engine" backHref={courseId ? `/courses/${courseId}` : "/courses"}>
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-ink-soft">
          Ask this subject&apos;s engine anything from your course material — concepts, terminology,
          processes, worked understanding. Answers use your course context and your own saved
          materials, never another student&apos;s.
        </p>
        <Card>
          <CardContent className="space-y-3 p-4">
            <label htmlFor="tq" className="text-sm font-medium text-ink">Your question</label>
            <Textarea id="tq" className="min-h-24" value={question} onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. Explain how the electron transport chain creates ATP" />
            <Button onClick={ask} disabled={busy || !question.trim()}>{busy ? <Spinner /> : "Ask"}</Button>
          </CardContent>
        </Card>
        {thread.length > 0 && (
          <div className="space-y-3">
            {thread.map((m, i) => (
              <Card key={i} className={m.role === "you" ? "border-accent/30" : ""}>
                <CardContent className="p-4">
                  <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-ink-soft">
                    {m.role === "you" ? "You" : <><GraduationCap className="h-3.5 w-3.5 text-accent" /> Subject engine</>}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{m.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
