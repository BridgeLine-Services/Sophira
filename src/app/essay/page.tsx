"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { PacingController } from "@/lib/pacing-controller";
import { formatAssignmentPlan, type AssignmentPlan, type OutlineSection } from "@/lib/essay/pipeline";
import { OUTPUT_MODE_LABELS, effectiveRevealWpm, restoreReveal, serializeReveal, revealStorageKey, type CalibratedProfile, type OutputMode, type SectionRevealState } from "@/lib/essay/pacing";
import { CalendarClock, FileText, Pause, Play, Timer } from "lucide-react";

/**
 * Essay workspace (2026-10-06 hardening): the staged pipeline is VISIBLE —
 * compact assignment plan before drafting, sources + evidence for research
 * essays, outline approval/edit gate, then ONE SECTION AT A TIME with paced
 * presentation (local timer, pause/resume, restore on reopen).
 */

interface SectionRow { id: string; draft: string | null; audits: { citation: string; rubric: string; style: string } | null }
interface SessionData {
  id: string; title: string; question: string; status: string; stage: string;
  plan: AssignmentPlan; outline: OutlineSection[]; outline_approved: boolean;
  sections: SectionRow[]; final_verification: { status: string; note: string } | null;
  output_mode: OutputMode; custom_wpm: number | null; deadline: string | null;
  break_preference_seconds: number | null; schedule_verdict: string | null;
}

const TICK_MS = 250;

export default function EssayPage() {
  // useSearchParams requires a Suspense boundary for prerendering.
  return (
    <Suspense fallback={null}>
      <EssayPageInner />
    </Suspense>
  );
}

function EssayPageInner() {
  const searchParams = useSearchParams();
  const courseId = searchParams.get("course_id");
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [session, setSession] = useState<SessionData | null>(null);
  const [form, setForm] = useState({ title: "", question: "", genre: "Essay", deadline: "", breakSeconds: "600", outputMode: "calibrated" as OutputMode, customWpm: "40" });
  const [outlineDraft, setOutlineDraft] = useState<OutlineSection[]>([]);
  const [profile, setProfile] = useState<CalibratedProfile | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      const res = await fetch("/api/typing", { cache: "no-store" });
      const json = await res.json();
      if (res.ok && json.data?.baseline) {
        const b = json.data.baseline; const p = json.data.profile;
        setProfile({
          baselineWpm: Number(b.wpm), recentWpm: p ? Number(p.recent_average_wpm) : null,
          accuracy: b.accuracy != null ? Number(b.accuracy) : null,
          confidence: p?.confidence ?? null, autoAdjustEnabled: p?.auto_adjust_enabled === true,
          manualWpm: p?.manual_wpm != null ? Number(p.manual_wpm) : null,
          recommendedWpm: p ? Number(p.recommended_wpm) : null,
        });
      } else setProfile(null);
    } catch { setProfile(null); }
  }, []);

  const restoreSession = useCallback(async (id: string) => {
    const res = await fetch(`/api/essay/plan?session_id=${id}`, { cache: "no-store" });
    const json = await res.json();
    if (res.ok && json.data) {
      setSession(json.data as SessionData);
      setOutlineDraft((json.data as SessionData).outline ?? []);
    }
  }, []);

  useEffect(() => {
    void loadProfile();
    // restore the last session on reopen (progress restore is per-section below)
    try {
      const lastId = localStorage.getItem("sophira:essay:last-session");
      if (lastId) void restoreSession(lastId);
    } catch { /* storage unavailable */ }
  }, [loadProfile, restoreSession]);

  async function createPlan() {
    if (!form.question.trim()) { toast("error", "Describe the assignment first."); return; }
    setPlanning(true);
    try {
      const res = await fetch("/api/essay/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title, question: form.question, genre: form.genre,
          deadline: form.deadline || null,
          break_preference_seconds: form.breakSeconds ? Number(form.breakSeconds) : null,
          output_mode: form.outputMode, custom_wpm: form.outputMode === "custom" ? Number(form.customWpm) : null,
          ...(courseId ? { course_id: courseId } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.data) { toast("error", json.error ?? "Planning failed."); return; }
      if (json.data.impossible) toast("error", json.data.verdict);
      else toast("success", json.data.schedule_verdict ?? "Assignment plan ready — review and approve the outline.");
      localStorage.setItem("sophira:essay:last-session", json.data.session_id);
      await restoreSession(json.data.session_id);
    } finally { setPlanning(false); }
  }

  async function approveOutline(outline: OutlineSection[]) {
    if (!session) return;
    const res = await fetch("/api/essay/draft-section", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: session.id, outline, approved: true }),
    });
    const json = await res.json();
    if (res.ok) {
      toast("success", "Outline approved — sections will be drafted one at a time.");
      await restoreSession(session.id);
    } else toast("error", json.error ?? "Could not approve the outline.");
  }

  async function draftNextSection() {
    if (!session) return;
    setBusy(true);
    try {
      const res = await fetch("/api/essay/draft-section", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: session.id }),
      });
      const json = await res.json();
      if (!res.ok || !json.data) { toast("error", json.error ?? "Drafting failed."); return; }
      if (json.data.allDrafted) {
        toast(json.data.finalVerification?.status === "VERIFIED" ? "success" : "error",
          json.data.finalVerification?.status === "VERIFIED"
            ? "All sections drafted and the final verification passed."
            : `Final verification: ${json.data.finalVerification?.note}`);
      }
      await restoreSession(session.id);
    } finally { setBusy(false); }
  }

  return (
    <AppShell title="Essay workflow" backHref={courseId ? `/courses/${courseId}` : undefined}>
      <div className="mx-auto max-w-3xl space-y-4">
        {courseId && (
          <p className="text-sm text-ink-soft">
            Working in a course workspace.{" "}
            <Link href={`/courses/${courseId}`} className="font-medium text-accent underline">Back to the course</Link>
          </p>
        )}
        {!session && (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Start an essay (staged, never opaque)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-ink/60">
                Sophira plans FIRST: assignment analysis, rubric, teacher requirements, selected sources and evidence (research essays),
                thesis, and an outline you approve or edit. Only then are sections drafted — one at a time, with citation/rubric/style audits
                and final verification — and revealed at your calibrated pace with pause/resume and saved progress.
              </p>
              <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Hamlet essay" /></div>
              <div><Label>Assignment / prompt</Label><Textarea value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} placeholder="Paste the full assignment prompt…" /></div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div><Label>Genre</Label><Select value={form.genre} onChange={(e) => setForm({ ...form, genre: e.target.value })}><option>Essay</option><option>Discussion post</option><option>Reflection</option><option>Research writing</option></Select></div>
                <div><Label>Deadline (optional)</Label><Input type="datetime-local" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} /></div>
                <div><Label>Break between sections (s)</Label><Input type="number" min={10} max={21600} value={form.breakSeconds} onChange={(e) => setForm({ ...form, breakSeconds: e.target.value })} /></div>
                <div>
                  <Label>Output mode</Label>
                  <Select value={form.outputMode} onChange={(e) => setForm({ ...form, outputMode: e.target.value as OutputMode })}>
                    <option value="instant">Instant</option><option value="calibrated">Calibrated</option><option value="slow">Slow</option><option value="custom">Custom</option>
                  </Select>
                </div>
              </div>
              {form.outputMode === "custom" && (
                <div><Label>Custom WPM</Label><Input type="number" min={5} max={220} value={form.customWpm} onChange={(e) => setForm({ ...form, customWpm: e.target.value })} /></div>
              )}
              <Button onClick={createPlan} disabled={planning}>{planning ? <Spinner /> : "Plan the assignment"}</Button>
            </CardContent>
          </Card>
        )}

        {session && (
          <>
            {session.schedule_verdict && (
              <p className={`rounded-lg p-3 text-sm ${session.schedule_verdict.startsWith("IMPOSSIBLE") ? "bg-danger/10 text-ink" : "bg-muted/50 text-ink/70"}`}>
                <CalendarClock className="mr-1.5 inline h-4 w-4" /> {session.schedule_verdict}
              </p>
            )}

            {/* COMPACT ASSIGNMENT PLAN — shown before drafting */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Assignment plan
                  <Badge tone={session.outline_approved ? "success" : "warn"}>{session.status.replace(/_/g, " ")}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap rounded-lg border border-ink/10 bg-muted/40 p-3 text-xs leading-5">{formatAssignmentPlan(session.plan)}</pre>
              </CardContent>
            </Card>

            {/* OUTLINE APPROVAL / EDIT GATE */}
            {!session.outline_approved && (
              <Card>
                <CardHeader><CardTitle>Outline — approve or edit before drafting</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {outlineDraft.map((s, i) => (
                    <div key={s.id} className="rounded-lg border border-ink/10 p-3">
                      <div className="flex items-center gap-2">
                        <Input value={s.title} onChange={(e) => setOutlineDraft(outlineDraft.map((o, j) => j === i ? { ...o, title: e.target.value } : o))} className="flex-1" />
                        <Button size="sm" variant="secondary" onClick={() => setOutlineDraft(outlineDraft.filter((_, j) => j !== i))}>Remove</Button>
                      </div>
                      <Input className="mt-2" value={s.points.join("; ")} onChange={(e) => setOutlineDraft(outlineDraft.map((o, j) => j === i ? { ...o, points: e.target.value.split(";").map((p) => p.trim()).filter(Boolean) } : o))} placeholder="points, separated by ;" />
                      <p className="mt-1 text-xs text-ink/50">~{s.targetWords} words{evidenceSuffix(s.evidenceLabels)}</p>
                    </div>
                  ))}
                  <Button size="sm" variant="secondary" onClick={() => setOutlineDraft([...outlineDraft, { id: `s${outlineDraft.length + 1}`, title: "New section", points: [], evidenceLabels: [], targetWords: 150 }])}>Add section</Button>
                  <div className="flex gap-2">
                    <Button onClick={() => approveOutline(outlineDraft)}>Approve outline</Button>
                  </div>
                  <p className="text-xs text-ink/50">Sophira will not draft any section until you approve this outline. Editing is always allowed before approval.</p>
                </CardContent>
              </Card>
            )}

            {/* SECTIONS — one at a time, paced presentation */}
            {session.outline_approved && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Timer className="h-4 w-4" /> Sections ({session.sections.filter((s) => s.draft).length}/{session.outline.length} drafted)
                    {session.final_verification && (
                      <Badge tone={session.final_verification.status === "VERIFIED" ? "success" : "warn"}>{session.final_verification.status}</Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button onClick={draftNextSection} disabled={busy || session.sections.every((s) => s.draft)}>
                    {busy ? <Spinner /> : session.sections.some((s) => s.draft) ? "Draft next section" : "Draft the first section"}
                  </Button>
                  {session.sections.filter((s) => s.draft).map((s) => {
                    const meta = session.outline.find((o) => o.id === s.id);
                    return <PacedSection key={s.id} sessionId={session.id} sectionId={s.id} title={meta?.title ?? s.id} draft={s.draft!} audits={s.audits} mode={session.output_mode} customWpm={session.custom_wpm} profile={profile} />;
                  })}
                  {session.final_verification && (
                    <div className="rounded-lg border border-ink/10 p-3 text-sm">
                      <Badge tone={session.final_verification.status === "VERIFIED" ? "success" : "warn"}>Final verification: {session.final_verification.status}</Badge>
                      <p className="mt-1 text-ink/70">{session.final_verification.note}</p>
                    </div>
                  )}
                  <p className="text-xs text-ink/40">
                    The reveal is a local timer over already-generated text — no network request or database write per character. Progress is saved locally and restored when you reopen the page.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {!session && !planning && <EmptyState title="No essay in progress" description="Plan an assignment to see the full staged workflow." />}
      </div>
    </AppShell>
  );
}

function evidenceSuffix(labels: string[]) { return labels.length ? ` · evidence: ${labels.join(", ")}` : ""; }

/** One section, revealed progressively at the selected WPM with pause/resume + restore. */
function PacedSection({ sessionId, sectionId, title, draft, audits, mode, customWpm, profile }: {
  sessionId: string; sectionId: string; title: string; draft: string;
  audits: { citation: string; rubric: string; style: string } | null;
  mode: OutputMode; customWpm: number | null; profile: CalibratedProfile | null;
}) {
  const { toast } = useToast();
  const [visible, setVisible] = useState("");
  const [running, setRunning] = useState(false);
  const [complete, setComplete] = useState(false);
  const controllerRef = useRef<PacingController | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const wpm = effectiveRevealWpm(mode, profile ?? {
    baselineWpm: null, recentWpm: null, accuracy: null, confidence: null,
    autoAdjustEnabled: false, manualWpm: null, recommendedWpm: null,
  }, customWpm);

  // mount: restore saved progress (close/reopen restores the reveal)
  useEffect(() => {
    const key = revealStorageKey(sessionId, sectionId);
    let saved: SectionRevealState | null = null;
    try { saved = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { saved = null; }
    const effectiveMode: OutputMode = wpm == null ? "instant" : mode;
    const { controller, restored } = restoreReveal(draft, saved, effectiveMode, wpm);
    controllerRef.current = controller;
    setVisible(controller.visible());
    setComplete(controller.isComplete());
    if (restored && !controller.isComplete()) toast("info", `Restored your progress on "${title}" — resume when ready.`);
    if (!restored && wpm == null && mode !== "instant") toast("error", "No typing calibration on file — showing the section instantly instead of inventing a pace.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sectionId, draft]);

  // save progress (active reveal time only — no server involved)
  useEffect(() => {
    const c = controllerRef.current;
    if (!c) return;
    try { localStorage.setItem(revealStorageKey(sessionId, sectionId), JSON.stringify(serializeReveal(c, sectionId, mode))); } catch { /* storage unavailable */ }
  }, [visible, sessionId, sectionId, mode]);

  const start = () => {
    const c = controllerRef.current;
    if (!c || c.isComplete()) return;
    c.resume();
    setRunning(true);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const ctrl = controllerRef.current;
      if (!ctrl) return;
      ctrl.tick(Date.now());
      setVisible(ctrl.visible());
      if (ctrl.isComplete()) { setComplete(true); setRunning(false); if (timerRef.current) clearInterval(timerRef.current); }
    }, TICK_MS);
  };
  const pause = () => {
    controllerRef.current?.pause();
    setRunning(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  return (
    <div className="rounded-lg border border-ink/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">{title}</Badge>
        <Badge tone="accent">{OUTPUT_MODE_LABELS[wpm == null ? "instant" : mode].split(" —")[0]}</Badge>
        {wpm != null && <Badge tone="neutral">{wpm} WPM</Badge>}
        {complete ? <Badge tone="success">revealed</Badge> : (
          <Button size="sm" variant="secondary" onClick={running ? pause : start}>
            {running ? <><Pause className="h-3.5 w-3.5" /> Pause</> : <><Play className="h-3.5 w-3.5" /> Resume</>}
          </Button>
        )}
      </div>
      <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded bg-muted/30 p-3 text-sm leading-6">
        {visible}
        {!complete && <span className="animate-pulse text-ink/30">▌</span>}
      </div>
      <div className="mt-1 h-1.5 rounded bg-ink/10">
        <div className="h-1.5 rounded bg-accent transition-all" style={{ width: `${draft.length ? (visible.length / draft.length) * 100 : 0}%` }} />
      </div>
      {audits && (
        <details className="mt-2 text-xs text-ink/60">
          <summary className="cursor-pointer">Section audits (citation · rubric · style)</summary>
          <ul className="mt-1 space-y-1">
            <li>Citation audit: {audits.citation}</li>
            <li>Rubric audit: {audits.rubric}</li>
            <li>Style audit: {audits.style}</li>
          </ul>
        </details>
      )}
    </div>
  );
}
