"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, Spinner, useToast } from "@/components/ui";
import { SpellCheck, Check, X } from "lucide-react";

interface Correction { id: number; original: string; suggestion: string; kind?: string; explanation?: string }

export default function GrammarPage() {
  return <Suspense fallback={null}><GrammarInner /></Suspense>;
}

function GrammarInner() {
  const searchParams = useSearchParams();
  const courseId = searchParams.get("course_id");
  const subjectSlug = searchParams.get("subject");
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [overall, setOverall] = useState<string | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [rejected, setRejected] = useState<number[]>([]);

  async function check() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/writing/grammar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, course_id: courseId, ...(courseId ? {} : subjectSlug ? { subject: subjectSlug } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) { toast("error", json.error ?? "The check failed."); return; }
      setOverall(json.data.overall ?? "");
      setCorrections(json.data.corrections ?? []);
      setRejected([]);
    } finally { setBusy(false); }
  }

  function accept(c: Correction) {
    setText((t) => t.replace(c.original, c.suggestion));
    setCorrections((list) => list.filter((x) => x.id !== c.id));
  }
  function reject(c: Correction) {
    setRejected((r) => [...r, c.id]);
    setCorrections((list) => list.filter((x) => x.id !== c.id));
  }
  function applyAll() {
    setText((t) => {
      let out = t;
      for (const c of corrections) out = out.replace(c.original, c.suggestion);
      return out;
    });
    setCorrections([]);
  }

  return (
    <AppShell title="Grammar & Spelling" backHref={courseId ? `/courses/${courseId}` : "/writing"}>
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-ink-soft">
          Grammar, spelling, punctuation, and clarity help. Each correction is explained and you
          accept or reject it individually — your meaning and voice are preserved.
        </p>
        <Card>
          <CardContent className="space-y-3 p-4">
            <label htmlFor="gtext" className="text-sm font-medium text-ink">Your text</label>
            <textarea
              id="gtext"
              className="min-h-52 w-full rounded-card border border-ink/10 p-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste or type the text you want checked…"
            />
            <Button onClick={check} disabled={busy || !text.trim()}>{busy ? <Spinner /> : "Check text"}</Button>
          </CardContent>
        </Card>

        {overall !== null && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-ink"><SpellCheck className="h-4 w-4 text-accent" /> {overall || "Check complete."}</p>
              {corrections.length > 0 && (
                <div className="flex justify-end">
                  <Button size="sm" variant="secondary" onClick={applyAll}>Accept all</Button>
                </div>
              )}
              <ul className="space-y-2">
                {corrections.map((c) => (
                  <li key={c.id} className="rounded-card border border-ink/10 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {c.kind && <Badge tone="neutral">{c.kind}</Badge>}
                      <span className="text-sm text-ink-soft line-through decoration-red-400/60">{c.original}</span>
                      <span className="text-sm text-ink">→ {c.suggestion}</span>
                    </div>
                    {c.explanation && <p className="mt-1 text-xs text-ink-soft">{c.explanation}</p>}
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => accept(c)}><Check className="mr-1 h-3.5 w-3.5" /> Accept</Button>
                      <Button size="sm" variant="secondary" onClick={() => reject(c)}><X className="mr-1 h-3.5 w-3.5" /> Reject</Button>
                    </div>
                  </li>
                ))}
                {corrections.length === 0 && rejected.length === 0 && (
                  <li className="text-sm text-ink-soft">No grammar, spelling, punctuation, or clarity issues found.</li>
                )}
              </ul>
            </CardContent>
          </Card>
        )}
        <p className="text-xs text-ink-soft">
          This tool helps you improve your own writing. It does not misrepresent authorship and
          makes no claims about AI-detection systems.
        </p>
      </div>
    </AppShell>
  );
}
