"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, CardContent, Input, Label, Spinner, useToast } from "@/components/ui";
import { Check, Pencil, Target, X } from "lucide-react";

/**
 * MY LEARNING GOALS (2026-11-12).
 *
 * Three things this panel must never do, each of which it used to do:
 *   1. show a FAILED query as "you have no goals" - a read error now has its own state and a
 *      retry, because losing your goals and failing to fetch them are different messages;
 *   2. insert a goal with no owner - the session is checked first and an unanswered `getUser`
 *      is a visible refusal, not an `undefined` written to the row;
 *   3. offer only "+25%" - you can now set the progress you actually made, edit the goal, give
 *      it a target date, mark it achieved and reopen it.
 *
 * Rows live in public.learning_goals under RLS (user_id = auth.uid()), so this component can
 * only ever read and write the signed-in member's own goals.
 */
interface Goal {
  id: string;
  title: string;
  detail: string | null;
  target_date: string | null;
  status: string;
  progress: number;
}

type LoadState = "loading" | "ready" | "error";

const cleanProgress = (value: number | string) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

/** A plain next step derived from the row itself - a date, or the fact there isn't one. */
function nextStep(goal: Goal): string {
  if (goal.status === "achieved") return "Achieved - well done.";
  if (goal.progress >= 100) return "Every step is done. Mark it achieved when you are ready.";
  if (!goal.target_date) return "Add a target date so this goal has a finish line.";
  const target = new Date(goal.target_date);
  if (Number.isNaN(target.getTime())) return "Add a target date so this goal has a finish line.";
  const today = new Date();
  const days = Math.round(
    (Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate()) -
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) / 86_400_000,
  );
  if (days < 0) return `The target date passed ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago - move it or close the goal.`;
  if (days === 0) return "The target date is today.";
  return `${days} day${days === 1 ? "" : "s"} until the target date.`;
}

export function LearningGoals() {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();

  const [state, setState] = useState<LoadState>("loading");
  const [rows, setRows] = useState<Goal[]>([]);
  const [tab, setTab] = useState<"open" | "achieved">("open");

  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editTarget, setEditTarget] = useState("");
  const [draftProgress, setDraftProgress] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setState("loading");
    const { data, error } = await supabase
      .from("learning_goals")
      .select("id, title, detail, target_date, status, progress")
      .order("created_at", { ascending: false })
      .limit(60);
    if (error) {
      // NOT an empty list: the member may well have goals, we simply could not ask.
      setRows([]);
      setState("error");
      return;
    }
    setRows((data ?? []) as Goal[]);
    setState("ready");
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The server-rendered totals above this panel must agree with what was just saved. */
  const sync = useCallback(() => {
    void load();
    router.refresh();
  }, [load, router]);

  async function currentUserId(): Promise<string | null> {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data?.user?.id ?? null;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const goalTitle = title.trim();
    if (!goalTitle || busy) return;
    setBusy(true);
    const userId = await currentUserId();
    if (!userId) {
      setBusy(false);
      toast("error", "You need to be signed in before Sophira can save a goal.");
      return;
    }
    const { error } = await supabase.from("learning_goals").insert({
      user_id: userId,
      title: goalTitle,
      target_date: target || null,
    });
    setBusy(false);
    if (error) {
      toast("error", "We couldn't save that goal. Please try again.");
      return;
    }
    setTitle("");
    setTarget("");
    setFormOpen(false);
    toast("success", "Goal added. You can update its progress any time.");
    sync();
  }

  async function saveProgress(goal: Goal) {
    const progress = cleanProgress(draftProgress[goal.id] ?? goal.progress);
    const status = progress >= 100 ? "achieved" : goal.status === "achieved" ? "active" : goal.status;
    const { error } = await supabase.from("learning_goals").update({ progress, status }).eq("id", goal.id);
    if (error) {
      toast("error", "We couldn't update that goal. Please try again.");
      return;
    }
    setDraftProgress((current) => {
      const next = { ...current };
      delete next[goal.id];
      return next;
    });
    sync();
  }

  async function markAchieved(goal: Goal) {
    const { error } = await supabase
      .from("learning_goals")
      .update({ progress: 100, status: "achieved" })
      .eq("id", goal.id);
    if (error) {
      toast("error", "We couldn't mark that goal achieved. Please try again.");
      return;
    }
    toast("success", "Marked achieved. Nice work.");
    sync();
  }

  async function reopen(goal: Goal) {
    const { error } = await supabase
      .from("learning_goals")
      .update({ status: "active", progress: Math.min(100, cleanProgress(goal.progress)) })
      .eq("id", goal.id);
    if (error) {
      toast("error", "We couldn't reopen that goal. Please try again.");
      return;
    }
    sync();
  }

  async function saveEdit(goal: Goal) {
    const goalTitle = editTitle.trim();
    if (!goalTitle) return;
    const { error } = await supabase
      .from("learning_goals")
      .update({ title: goalTitle, target_date: editTarget || null })
      .eq("id", goal.id);
    if (error) {
      toast("error", "We couldn't save that change. Please try again.");
      return;
    }
    setEditingId("");
    sync();
  }

  const openGoals = useMemo(() => rows.filter((g) => g.status !== "achieved"), [rows]);
  const achievedGoals = useMemo(() => rows.filter((g) => g.status === "achieved"), [rows]);
  const visible = tab === "open" ? openGoals : achievedGoals;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="dashboard-goals-heading" className="dash-panel-title">My learning goals</h2>
          <p className="dash-panel-sub mt-1">Your own objectives, tracked against the work you actually do.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setFormOpen((open) => !open)}>
          {formOpen ? "Cancel" : "Add a goal"}
        </Button>
      </div>

      {formOpen && (
        <Card className="mb-3">
          <CardContent className="p-4">
            <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div>
                <Label htmlFor="goal-title">Goal</Label>
                <Input
                  id="goal-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="e.g. Finish calculus unit 3"
                />
              </div>
              <div>
                <Label htmlFor="goal-date">Target date</Label>
                <Input id="goal-date" type="date" value={target} onChange={(event) => setTarget(event.target.value)} />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy || !title.trim()}>
                  {busy ? "Saving…" : "Save"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {state === "loading" ? (
        <Card>
          <CardContent className="flex items-center gap-2 p-4 text-sm text-ink-soft">
            <Spinner /> Loading your goals…
          </CardContent>
        </Card>
      ) : state === "error" ? (
        <Card>
          <CardContent className="flex flex-wrap items-start gap-3 p-4 text-sm text-ink-soft">
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink">We couldn&apos;t load your goals just now.</p>
              <p className="mt-1">
                This is not the same as having none - your goals are still saved. Reload them below.
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void load()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-4 text-sm text-ink-soft">
            <Target className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
            <span>No goals yet. Set one above and I&apos;ll keep its progress here with your real work.</span>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Goal lists">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "open"}
              onClick={() => setTab("open")}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${tab === "open" ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-ink-soft hover:border-accent/40"}`}
            >
              In progress ({openGoals.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "achieved"}
              onClick={() => setTab("achieved")}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${tab === "achieved" ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-ink-soft hover:border-accent/40"}`}
            >
              Achieved ({achievedGoals.length})
            </button>
          </div>

          {visible.length === 0 ? (
            <Card>
              <CardContent className="p-4 text-sm text-ink-soft">
                {tab === "open"
                  ? "Nothing in progress. Every goal you have set is achieved."
                  : "No achieved goals yet. When you reach one it moves here, with its history kept."}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="divide-y divide-line p-0">
                {visible.map((goal) => {
                  const draft = draftProgress[goal.id];
                  const shown = draft ?? goal.progress;
                  const dirty = draft !== undefined && draft !== goal.progress;
                  const editing = editingId === goal.id;
                  return (
                    <div key={goal.id} className="p-4">
                      {editing ? (
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                          <Input
                            aria-label="Goal title"
                            value={editTitle}
                            onChange={(event) => setEditTitle(event.target.value)}
                          />
                          <Input
                            aria-label="Target date"
                            type="date"
                            value={editTarget}
                            onChange={(event) => setEditTarget(event.target.value)}
                          />
                          <Button size="sm" onClick={() => void saveEdit(goal)} disabled={!editTitle.trim()}>
                            <Check className="mr-1 h-4 w-4" aria-hidden /> Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId("")}>
                            <X className="mr-1 h-4 w-4" aria-hidden /> Cancel
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                              <p
                                className={`font-medium ${goal.status === "achieved" ? "text-ink-soft line-through" : "text-ink"}`}
                              >
                                {goal.title}
                              </p>
                              <p className="mt-0.5 text-xs text-ink-soft">{nextStep(goal)}</p>
                            </div>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingId(goal.id);
                                setEditTitle(goal.title);
                                setEditTarget(goal.target_date ?? "");
                              }}
                              aria-label={`Edit ${goal.title}`}
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>

                          <div className="mt-2 flex items-center gap-2">
                            <div
                              className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-ink/10"
                              role="img"
                              aria-label={`${goal.title}: ${shown} percent complete`}
                            >
                              <div className="h-full rounded-full bg-accent" style={{ width: `${shown}%` }} />
                            </div>
                            <span className="shrink-0 text-xs tabular-nums text-ink-soft">{shown}%</span>
                          </div>

                          {goal.status !== "achieved" && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <input
                                id={`progress-${goal.id}`}
                                type="range"
                                min={0}
                                max={100}
                                step={5}
                                value={shown}
                                aria-label={`Progress for ${goal.title}`}
                                onChange={(event) =>
                                  setDraftProgress((current) => ({ ...current, [goal.id]: Number(event.target.value) }))
                                }
                                className="dash-range h-1.5 w-40"
                              />
                              <Button size="sm" variant="secondary" onClick={() => void saveProgress(goal)} disabled={!dirty}>
                                Update progress
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => void markAchieved(goal)}>
                                Mark achieved
                              </Button>
                            </div>
                          )}

                          {goal.status === "achieved" && (
                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-success">Achieved</span>
                              <Button size="sm" variant="ghost" onClick={() => void reopen(goal)}>
                                Reopen
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
