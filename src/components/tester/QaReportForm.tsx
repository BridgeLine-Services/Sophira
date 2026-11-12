"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, useToast } from "@/components/ui";

/**
 * Tester workspace: file a bug, feedback item, or idea. Written straight to
 * qa_reports under RLS (own rows); staff triage status changes server-side.
 */
export function QaReportForm({ userId }: { userId: string }) {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();
  const [kind, setKind] = useState<"bug" | "feedback" | "idea">("bug");
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [severity, setSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [actual, setActual] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      toast("error", "Give the report a short title first.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("qa_reports").insert({
      user_id: userId,
      kind,
      title: title.trim(),
      area: area.trim(),
      severity: kind === "bug" ? severity : "low",
      steps: steps.trim(),
      expected: expected.trim(),
      actual: actual.trim(),
    });
    setBusy(false);
    if (error) {
      toast("error", "We couldn't save that report. Please try again.");
      return;
    }
    setTitle(""); setArea(""); setSteps(""); setExpected(""); setActual("");
    toast("success", "Report saved. You'll see its status below.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Report something</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["bug", "feedback", "idea"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} aria-pressed={kind === k}
                className={`rounded-full border px-3 py-1.5 text-sm font-medium capitalize transition ${kind === k ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-ink-soft hover:border-accent/40"}`}>
                {k}
              </button>
            ))}
          </div>
          <div>
            <Label htmlFor="qa-title">Title</Label>
            <Input id="qa-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What went wrong, in one line?" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="qa-area">Where (page or feature)</Label>
              <Input id="qa-area" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Math scan" />
            </div>
            {kind === "bug" && (
              <div>
                <Label htmlFor="qa-sev">Severity</Label>
                <select id="qa-sev" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}
                  className="h-11 w-full rounded-lg border border-line bg-card px-3 text-ink">
                  <option value="low">Low - cosmetic</option>
                  <option value="medium">Medium - annoying</option>
                  <option value="high">High - blocks a task</option>
                  <option value="critical">Critical - data or access</option>
                </select>
              </div>
            )}
          </div>
          {kind === "bug" && (
            <>
              <div>
                <Label htmlFor="qa-steps">Steps to reproduce</Label>
                <textarea id="qa-steps" value={steps} onChange={(e) => setSteps(e.target.value)} rows={3}
                  className="w-full rounded-lg border border-line bg-card p-3 text-ink" placeholder="1. Open Math… 2. Tap Scan…" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="qa-expected">Expected</Label>
                  <Input id="qa-expected" value={expected} onChange={(e) => setExpected(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="qa-actual">What actually happened</Label>
                  <Input id="qa-actual" value={actual} onChange={(e) => setActual(e.target.value)} />
                </div>
              </div>
            </>
          )}
          {kind !== "bug" && (
            <div>
              <Label htmlFor="qa-comment">Your note</Label>
              <textarea id="qa-comment" value={steps} onChange={(e) => setSteps(e.target.value)} rows={3}
                className="w-full rounded-lg border border-line bg-card p-3 text-ink" placeholder="What should we know?" />
            </div>
          )}
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Submit report"}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
