"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Badge, Button, Card, CardContent, CardHeader, CardTitle, ConfirmDialog, Input, Label,
  Select, Spinner, Textarea, useToast,
} from "@/components/ui";
import { ResultBody } from "@/components/app/ResultBody";
import { MODE_MAP } from "@/lib/modes";
import type { AiResponse, Assignment, Course, Teacher, WorkSession } from "@/lib/types";
import { AlertTriangle, Check, Copy, Pencil, Save, Send, X } from "lucide-react";

const QUICK_ACTIONS = [
  "Explain this step",
  "Make it simpler",
  "Show more work",
  "Follow my teacher's example",
  "Check this calculation",
  "Review the rubric again",
  "Make it sound more like my writing",
  "Shorten this",
  "Expand this",
];

const FEEDBACK_KINDS = [
  { kind: "approve", label: "Looks good" },
  { kind: "error", label: "Something's wrong" },
  { kind: "teacher_wanted", label: "Teacher wanted something else" },
  { kind: "note", label: "Note" },
] as const;

export function Workspace({
  assignment, course, teacher, session, latestResponse,
}: {
  assignment: Assignment;
  course: Course | null;
  teacher: Teacher | null;
  session: WorkSession | null;
  latestResponse: AiResponse | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();

  const [title, setTitle] = useState(assignment.title);
  const [editingTitle, setEditingTitle] = useState(false);
  const [busyTitle, setBusyTitle] = useState(false);
  const [status, setStatus] = useState(assignment.status);

  const [followUp, setFollowUp] = useState("");
  const [sending, setSending] = useState(false);

  const [feedbackKind, setFeedbackKind] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [sendingFeedback, setSendingFeedback] = useState(false);

  const [savingToLibrary, setSavingToLibrary] = useState(false);

  async function saveTitle() {
    if (!title.trim()) {
      toast("error", "The title can't be empty.");
      return;
    }
    setBusyTitle(true);
    const { error } = await supabase.from("assignments").update({ title: title.trim() }).eq("id", assignment.id);
    setBusyTitle(false);
    if (error) {
      toast("error", "Could not rename: " + error.message);
      return;
    }
    setEditingTitle(false);
    toast("success", "Renamed.");
    router.refresh();
  }

  async function changeStatus(next: string) {
    const prev = status;
    setStatus(next as Assignment["status"]);
    const { error } = await supabase
      .from("assignments")
      .update({ status: next })
      .eq("id", assignment.id);
    if (error) {
      setStatus(prev);
      toast("error", "Could not update status: " + error.message);
    } else {
      toast("success", `Marked ${next}.`);
    }
  }

  async function copyResult() {
    if (!latestResponse) return;
    await navigator.clipboard.writeText(latestResponse.content);
    toast("success", "Copied.");
  }

  async function saveToLibrary() {
    if (!latestResponse) return;
    setSavingToLibrary(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("study_materials").insert({
      user_id: user!.id,
      category: "ai_response",
      title: `${title} — response`,
      content: latestResponse.content,
      tags: [assignment.mode],
      assignment_id: assignment.id,
    });
    setSavingToLibrary(false);
    if (error) {
      toast("error", "Could not save: " + error.message);
      return;
    }
    toast("success", "Saved to your library.");
  }

  async function sendFeedback(e: FormEvent) {
    e.preventDefault();
    if (!feedbackText.trim()) {
      toast("error", "Tell me a bit about what worked or what didn't.");
      return;
    }
    setSendingFeedback(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("feedback").insert({
      user_id: user!.id,
      response_id: latestResponse?.id ?? null,
      assignment_id: assignment.id,
      course_id: assignment.course_id,
      teacher_id: assignment.teacher_id,
      kind: feedbackKind,
      comment: feedbackText.trim(),
      content: "",
    });
    setSendingFeedback(false);
    if (error) {
      toast("error", "Could not save feedback: " + error.message);
      return;
    }
    setFeedbackText("");
    setFeedbackKind(null);
    toast("success", "Thanks — saved with this assignment.");
  }

  async function sendFollowUp(e: FormEvent) {
    e.preventDefault();
    if (!followUp.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/ai/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: assignment.id,
          session_id: session?.id ?? null,
          mode: assignment.mode,
          question: followUp.trim(),
          course_id: assignment.course_id,
          teacher_id: assignment.teacher_id,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        setFollowUp("");
        toast("success", "Updated.");
        router.refresh();
      } else {
        toast("error", json.error || "Something went wrong — your message is still in the box.");
      }
    } catch {
      toast("error", "Could not reach the server — your message is still in the box.");
    } finally {
      setSending(false);
    }
  }

  const v = latestResponse?.verification;
  const messages = session?.messages ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-3">
        <div className="flex items-start gap-2">
          {editingTitle ? (
            <div className="flex flex-1 items-center gap-2">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Assignment title" />
              <Button size="sm" onClick={saveTitle} disabled={busyTitle}>
                {busyTitle ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditingTitle(false); setTitle(assignment.title); }}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <h2 className="flex-1 text-lg font-semibold text-ink">{title}</h2>
          )}
          {!editingTitle && (
            <Button variant="ghost" size="sm" aria-label="Rename" onClick={() => setEditingTitle(true)}>
              <Pencil className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone="accent">{MODE_MAP[assignment.mode]?.label ?? assignment.mode}</Badge>
          {assignment.subject && <Badge>{assignment.subject}</Badge>}
          {assignment.academic_level && <Badge>{assignment.academic_level}</Badge>}
          {assignment.task_type && <Badge>{assignment.task_type}</Badge>}
          <Badge tone={status === "active" ? "accent" : "neutral"}>{status}</Badge>
          <Select
            aria-label="Assignment status"
            className="ml-auto w-auto text-sm"
            value={status}
            onChange={(e) => changeStatus(e.target.value)}
          >
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </Select>
        </div>
        {(course || teacher) && (
          <p className="text-sm text-ink-soft">
            {course && (
              <>Course: <Link href={`/courses/${course.id}`} className="text-accent hover:underline">{course.name}</Link></>
            )}
            {course && teacher && <> · </>}
            {teacher && (
              <>Teacher: <Link href={`/teachers/${teacher.id}`} className="text-accent hover:underline">{teacher.name}</Link></>
            )}
          </p>
        )}
      </div>

      {/* Verification panel */}
      {latestResponse && v && (
        <Card className={v.status === "needs_verification" ? "border-warn/40" : undefined}>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Verification</CardTitle>
              <Badge tone={v.status === "verified" ? "success" : v.status === "needs_verification" ? "warn" : "neutral"}>
                {v.status === "verified" ? "Verified (self-check)" : v.status === "needs_verification" ? "Needs verification" : "Unverified"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {v.checks?.length > 0 ? (
              <ul className="space-y-1.5">
                {v.checks.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    {c.passed ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <X className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                    )}
                    <span className="text-ink"><strong>{c.name}</strong>{c.detail ? ` — ${c.detail}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-soft">No structured checks were recorded for this response.</p>
            )}
            {v.warnings?.length > 0 && (
              <ul className="space-y-1.5 rounded-lg bg-warn/10 p-3">
                {v.warnings.map((w, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" />
                    {w}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-ink-soft">Self-check by the AI — not a guarantee. Always review important work yourself.</p>
          </CardContent>
        </Card>
      )}

      {/* Latest result */}
      {latestResponse && (
        <Card>
          <CardContent className="p-5">
            <ResultBody content={latestResponse.content} />
            <div className="mt-5 flex flex-wrap gap-2 border-t border-ink/10 pt-4">
              <Button variant="secondary" size="sm" onClick={copyResult}>
                <Copy className="h-4 w-4" /> Copy
              </Button>
              <Button variant="secondary" size="sm" onClick={saveToLibrary} disabled={savingToLibrary}>
                {savingToLibrary ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />} Save to library
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Feedback */}
      <Card>
        <CardHeader><CardTitle>Tell Sophira how this went</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {FEEDBACK_KINDS.map((f) => (
              <button
                key={f.kind}
                type="button"
                onClick={() => setFeedbackKind(feedbackKind === f.kind ? null : f.kind)}
                aria-pressed={feedbackKind === f.kind}
                className={`rounded-full border px-3.5 py-2 text-sm font-medium transition ${
                  feedbackKind === f.kind
                    ? "border-accent bg-accent-soft text-accent"
                    : "border-ink/15 text-ink hover:bg-ink/5"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          {feedbackKind && (
            <form onSubmit={sendFeedback} className="space-y-2">
              <Textarea
                className="min-h-20"
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="What worked? What didn't? What did the teacher actually want?"
                aria-label="Feedback"
              />
              <Button type="submit" disabled={sendingFeedback}>
                {sendingFeedback ? "Sending…" : "Send feedback"}
              </Button>
            </form>
          )}
          <p className="text-xs text-ink-soft">
            Approve a Writing/Teacher profile update from the Writing or Teachers page if Sophira proposes one.
          </p>
        </CardContent>
      </Card>

      {/* History */}
      {messages.length > 0 && (
        <section>
          <h3 className="mb-3 text-base font-semibold text-ink">History</h3>
          <div className="space-y-3">
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-accent-soft px-4 py-2.5 text-sm text-ink">
                  {m.content}
                </div>
              ) : (
                <Card key={i} className="max-w-[95%]">
                  <CardContent className="p-4">
                    <ResultBody content={m.content} />
                  </CardContent>
                </Card>
              )
            )}
          </div>
        </section>
      )}

      {/* Follow-up */}
      <Card>
        <CardHeader><CardTitle>Ask for changes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setFollowUp(q)}
                className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink transition hover:border-accent/50 hover:text-accent"
              >
                {q}
              </button>
            ))}
          </div>
          <form onSubmit={sendFollowUp} className="space-y-2">
            <Textarea
              className="min-h-20"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder="Or type your own request — same teacher rules and course context apply automatically."
              aria-label="Follow-up request"
            />
            <Button type="submit" disabled={sending}>
              {sending ? <><Spinner className="mr-2 h-4 w-4" /> Working…</> : <><Send className="h-4 w-4" /> Send</>}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
