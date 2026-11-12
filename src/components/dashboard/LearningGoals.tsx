"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, CardContent, Input, Label, Spinner, useToast } from "@/components/ui";
import { Target } from "lucide-react";

/**
 * MY LEARNING GOALS (2026-11-12): the student's own objectives, stored in
 * learning_goals under RLS (private to the signed-in user). Real rows only;
 * the empty state says plainly that no goals exist yet.
 */
interface Goal { id: string; title: string; detail: string | null; target_date: string | null; status: string; progress: number }

export function LearningGoals() {
  const supabase = createClient();
  const { toast } = useToast();
  const [rows, setRows] = useState<Goal[] | null>(null);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("learning_goals")
      .select("id, title, detail, target_date, status, progress")
      .order("created_at", { ascending: false })
      .limit(6);
    setRows((data as Goal[] | null) ?? []);
  }, [supabase]);

  useEffect(() => { void load(); }, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("learning_goals").insert({
      user_id: user?.id,
      title: title.trim(),
      target_date: target || null,
    });
    setBusy(false);
    if (error) { toast("error", "We couldn't save that goal. Please try again."); return; }
    setTitle(""); setTarget(""); setOpen(false);
    toast("success", "Goal added.");
    void load();
  }

  async function setProgress(id: string, progress: number) {
    const status = progress >= 100 ? "achieved" : "active";
    const { error } = await supabase.from("learning_goals").update({ progress, status }).eq("id", id);
    if (error) { toast("error", "We couldn't update that goal."); return; }
    void load();
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">My learning goals</h2>
        <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>{open ? "Cancel" : "Add a goal"}</Button>
      </div>

      {open && (
        <Card className="mb-3">
          <CardContent className="p-4">
            <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div>
                <Label htmlFor="goal-title">Goal</Label>
                <Input id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Finish calculus unit 3" />
              </div>
              <div>
                <Label htmlFor="goal-date">Target date</Label>
                <Input id="goal-date" type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
              </div>
              <div className="flex items-end"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      {rows === null ? (
        <Card><CardContent className="flex items-center gap-2 p-4 text-sm text-ink-soft"><Spinner /> Loading your goals…</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-4 text-sm text-ink-soft">
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>No goals yet. Set one above and I&apos;ll keep its progress here with your real work.</span>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-line p-0">
            {rows.map((g) => (
              <div key={g.id} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className={`truncate font-medium ${g.status === "achieved" ? "text-ink-soft line-through" : "text-ink"}`}>{g.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-ink/10">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${g.progress}%` }} />
                    </div>
                    <span className="text-xs text-ink-soft">{g.progress}%{g.target_date ? ` · by ${g.target_date}` : ""}</span>
                  </div>
                </div>
                {g.status !== "achieved" && (
                  <Button size="sm" variant="ghost" onClick={() => setProgress(g.id, Math.min(100, g.progress + 25))}>+25%</Button>
                )}
                {g.status === "achieved" && <span className="text-xs font-medium text-success">Achieved</span>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
