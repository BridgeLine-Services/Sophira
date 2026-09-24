"use client";
import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, Input, Label, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { MODES } from "@/lib/modes";
import type { Course, Mode, Teacher } from "@/lib/types";
import {
  BookOpen, ClipboardCheck, FileText, Layers, Lightbulb, PenLine, Sparkles, Wrench, X,
} from "lucide-react";

const MODE_ICONS: Record<Mode, React.ReactNode> = {
  learn: <BookOpen className="h-5 w-5" />,
  assignment: <FileText className="h-5 w-5" />,
  check: <ClipboardCheck className="h-5 w-5" />,
  writing: <PenLine className="h-5 w-5" />,
  study: <Layers className="h-5 w-5" />,
  explain: <Lightbulb className="h-5 w-5" />,
  custom: <Wrench className="h-5 w-5" />,
};

interface Attachment {
  file_name: string;
  extracted_text: string;
  confidence: "high" | "medium" | "low";
  notes: string;
  storage_path: string | null;
  /** kept in memory only (never uploaded twice) so a low-confidence read can be retried */
  original?: File;
  /** true when the student should review/correct the interpretation before solving */
  needsReview: boolean;
}

function Wizard() {
  const router = useRouter();
  const search = useSearchParams();
  const supabase = createClient();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<Mode>(
    (MODES.some((m) => m.id === search.get("mode")) ? (search.get("mode") as Mode) : "assignment")
  );
  const [courses, setCourses] = useState<Course[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [courseId, setCourseId] = useState(search.get("course_id") || "");
  const [teacherId, setTeacherId] = useState("");
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("courses").select("*").order("name"),
      supabase.from("teachers").select("*").order("name"),
    ]).then(([c, t]) => {
      setCourses(c.data ?? []);
      setTeachers(t.data ?? []);
      const preselect = search.get("course_id");
      if (preselect) {
        const course = (c.data ?? []).find((x) => x.id === preselect);
        if (course?.teacher_id) setTeacherId(course.teacher_id);
      }
    });
  }, [supabase, search]);

  function pickCourse(id: string) {
    setCourseId(id);
    const course = courses.find((c) => c.id === id);
    if (course?.teacher_id) setTeacherId(course.teacher_id);
  }

  async function onFiles(files: FileList) {
    setUploading(true);
    for (const file of Array.from(files).slice(0, 6)) {
      if (file.size > 10 * 1024 * 1024) {
        toast("error", `${file.name} is over 10 MB — too big. Please split or compress it.`);
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/extract", { method: "POST", body: fd });
        const json = await res.json();
        if (res.ok && json.data) {
          const needsReview =
            json.data.confidence !== "high" ||
            /handwriting/i.test(json.data.notes || "");
          setAttachments((a) => [
            ...a,
            {
              file_name: json.data.file_name,
              extracted_text: json.data.extracted_text,
              confidence: json.data.confidence,
              notes: json.data.notes || "",
              storage_path: json.data.storage_path,
              original: file,
              needsReview,
            },
          ]);
          toast(
            needsReview ? "info" : "success",
            needsReview
              ? `${json.data.file_name} — please check the interpretation below before solving.`
              : `${json.data.file_name}: ${json.data.notes || "read"}`
          );
        } else {
          toast("error", `${file.name} — ${json.error || "could not be read"}`);
        }
      } catch {
        toast("error", `${file.name} — upload failed. Please try again or paste the text.`);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  /** Retry the extraction of one attachment (fresh read of the original file). */
  async function retryRead(index: number) {
    const att = attachments[index];
    if (!att?.original) {
      toast("error", "The original file is no longer available — please re-attach it.");
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", att.original);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const json = await res.json();
      if (res.ok && json.data) {
        const needsReview = json.data.confidence !== "high" || /handwriting/i.test(json.data.notes || "");
        setAttachments((list) =>
          list.map((a, i) =>
            i === index
              ? {
                  ...a,
                  extracted_text: json.data.extracted_text,
                  confidence: json.data.confidence,
                  notes: json.data.notes || "",
                  needsReview,
                }
              : a
          )
        );
        toast(needsReview ? "info" : "success", needsReview ? "Still unsure — please correct the text yourself below." : "Read again — looks good now.");
      } else {
        toast("error", json.error || "Retry failed — you can still edit the text below.");
      }
    } catch {
      toast("error", "Retry failed — you can still edit the text below.");
    } finally {
      setUploading(false);
    }
  }

  async function start() {
    const effectiveQuestion = question.trim() ||
      (attachments.length ? "Please work through the attached assignment documents." : "");
    if (!effectiveQuestion && attachments.length === 0) {
      toast("error", "Add your question or at least one file.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/ai/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          question: effectiveQuestion,
          title: title.trim() || undefined,
          course_id: courseId || null,
          teacher_id: teacherId || null,
          custom_instructions: customInstructions.trim() || undefined,
          files: attachments.map((a) => ({ file_name: a.file_name, extracted_text: a.extracted_text })),
        }),
      });
      const json = await res.json();

      if (res.status === 401) {
        toast("error", "Your session expired — please sign in again.");
        setBusy(false);
        return;
      }
      if (!res.ok) {
        toast("error", json.error || "Something went wrong. Your work is still here — please try again.");
        setBusy(false);
        return;
      }

      // Persist attachments against the new assignment (best effort).
      const assignmentId: string = json.data.assignment_id;
      const { data: { user } } = await supabase.auth.getUser();
      if (user && attachments.length) {
        await supabase.from("assignment_files").insert(
          attachments.map((a) => ({
            user_id: user.id,
            assignment_id: assignmentId,
            file_name: a.file_name,
            storage_path: a.storage_path || "",
            mime_type: null,
            extracted_text: a.extracted_text,
            extraction_confidence: a.confidence,
            extraction_notes: a.notes,
          }))
        );
      }
      toast("success", "Here it is.");
      router.push(`/assignments/${assignmentId}`);
    } catch {
      toast("error", "Could not reach the server. Your work is still here — please try again.");
      setBusy(false);
    }
  }

  const stepLabels = ["What do you need?", "Course & teacher", "Your assignment"];

  return (
    <AppShell title="New assignment" backHref="/dashboard">
      <div className="space-y-5">
        <div aria-hidden className="flex gap-1.5">
          {[1, 2, 3].map((n) => (
            <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-accent" : "bg-ink/10"}`} />
          ))}
        </div>
        <p className="text-sm font-medium text-ink-soft">
          Step {step} of 3 — {stepLabels[step - 1]}
        </p>

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  aria-pressed={mode === m.id}
                  className={`rounded-card border bg-white p-4 text-left transition ${
                    mode === m.id ? "border-accent ring-2 ring-accent" : "border-ink/10 hover:border-accent/40"
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium text-ink">
                    <span className="text-accent">{MODE_ICONS[m.id]}</span> {m.label}
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-ink-soft">{m.description}</span>
                </button>
              ))}
            </div>
            <Button size="lg" className="w-full" onClick={() => setStep(2)}>Continue</Button>
          </div>
        )}

        {step === 2 && (
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <Label htmlFor="course">Course (optional)</Label>
                <Select id="course" className="mt-1.5" value={courseId} onChange={(e) => pickCourse(e.target.value)}>
                  <option value="">No course — general question</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="teacher">Teacher (optional)</Label>
                <Select id="teacher" className="mt-1.5" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
                  <option value="">No teacher</option>
                  {teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <p className="mt-1.5 text-xs text-ink-soft">
                  Course &amp; teacher rules are applied automatically — only the selected ones.
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <Button size="lg" onClick={() => setStep(3)}>Continue</Button>
                <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="title">Give it a name (optional)</Label>
              <Input id="title" className="mt-1.5" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Problem set 3" />
            </div>

            <div>
              <Label htmlFor="question">Type or paste your assignment or question</Label>
              <Textarea
                id="question"
                className="mt-1.5 min-h-44"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder={"Paste the assignment text here, or just type your question.\nUse the upload button below for PDFs, text files, and photos of the page."}
              />
            </div>

            <div>
              <label className="inline-flex h-11 cursor-pointer items-center rounded-lg border border-ink/15 px-4 text-sm font-medium text-ink hover:bg-ink/5">
                {uploading ? <Spinner className="mr-2 h-4 w-4" /> : null}
                {uploading ? "Reading files…" : "Attach files (PDF, text, or a photo — up to 10 MB each)"}
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  accept=".pdf,.txt,.md,image/*"
                  className="sr-only"
                  onChange={(e) => e.target.files?.length && onFiles(e.target.files)}
                />
              </label>
              {attachments.length > 0 && (
                <div className="mt-3 space-y-2">
                  {attachments.map((a, i) => (
                    <Fragment key={i}>
                    <div className="flex items-start gap-2 rounded-lg border border-ink/10 bg-white p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{a.file_name}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone={a.confidence === "high" ? "success" : "warn"}>
                            {a.confidence === "high" ? "Read well" : a.confidence === "medium" ? "Read okay — check it" : "Hard to read — check it"}
                          </Badge>
                          <span className="text-xs text-ink-soft">{a.extracted_text.length.toLocaleString()} characters</span>
                        </div>
                        {a.notes && <p className="mt-1 text-xs text-ink-soft">{a.notes}</p>}
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${a.file_name}`}
                        onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                        className="rounded-lg p-1.5 text-ink-soft hover:bg-ink/5"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {a.needsReview && (
                      <div className="mt-3 space-y-2 rounded-lg bg-warn/10 p-3">
                        <p className="text-sm font-medium text-ink">
                          Check this interpretation{a.original?.type.startsWith("image/") ? " (handwritten/photo content is never assumed correct)" : ""}
                        </p>
                        {a.notes && <p className="text-xs text-ink-soft">{a.notes}</p>}
                        <Textarea
                          aria-label={`Correct the extracted text for ${a.file_name}`}
                          className="min-h-28 bg-white"
                          value={a.extracted_text}
                          onChange={(e) =>
                            setAttachments((list) =>
                              list.map((x, j) => (j === i ? { ...x, extracted_text: e.target.value } : x))
                            )
                          }
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            onClick={() =>
                              setAttachments((list) => list.map((x, j) => (j === i ? { ...x, needsReview: false } : x)))
                            }
                          >
                            Accept interpretation
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => retryRead(i)} disabled={uploading}>
                            {uploading ? "Reading again…" : "Retry reading"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setAttachments((list) => list.filter((_, j) => j !== i))}
                          >
                            Cancel (remove file)
                          </Button>
                        </div>
                      </div>
                    )}
                    </Fragment>
                  ))}
                </div>
              )}
            </div>

            <div>
              <Label htmlFor="extra">Anything else I should know?</Label>
              <Textarea
                id="extra"
                className="mt-1.5 min-h-20"
                value={customInstructions}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder={'Optional — e.g. "only question 2", "I attempted part (a) myself", "needs to be under 300 words"'}
              />
            </div>

            {/* Review & start */}
            <Card>
              <CardContent className="space-y-2 p-4">
                <p className="text-sm font-semibold text-ink">Ready when you are</p>
                <p className="text-sm text-ink-soft">
                  Mode: <strong>{MODES.find((m) => m.id === mode)?.label}</strong>
                  {courseId && <> · Course: <strong>{courses.find((c) => c.id === courseId)?.name}</strong></>}
                  {teacherId && <> · Teacher: <strong>{teachers.find((t) => t.id === teacherId)?.name}</strong></>}
                  {attachments.length > 0 && <> · {attachments.length} file{attachments.length > 1 ? "s" : ""} attached</>}
                </p>
                <Button size="lg" className="w-full" onClick={start} disabled={busy}>
                  {busy ? <><Spinner className="mr-2 h-4 w-4" /> Working on it…</> : <><Sparkles className="h-4 w-4" /> Start working</>}
                </Button>
                {busy && (
                  <p className="text-center text-xs text-ink-soft">This can take up to a minute for big assignments…</p>
                )}
              </CardContent>
            </Card>

            <Button variant="ghost" onClick={() => setStep(2)}>← Back</Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

export default function NewAssignmentPage() {
  return (
    <Suspense>
      <Wizard />
    </Suspense>
  );
}
