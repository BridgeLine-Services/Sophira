"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { Button, Card, CardContent, Input, Label, Select, useToast } from "@/components/ui";
import { BookOpen, GraduationCap, PenLine, Smartphone } from "lucide-react";
import Link from "next/link";

const LEVELS = ["Kindergarten/Elementary", "Middle school", "High school", "College/Undergraduate", "Graduate/Master's", "PhD", "Other"];
const EXPLANATION = ["Simple", "Standard", "Advanced"];

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [academicLevel, setAcademicLevel] = useState("");
  const [explanationLevel, setExplanationLevel] = useState("");
  const [courseName, setCourseName] = useState("");
  const [subject, setSubject] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        router.replace("/login");
        return;
      }
      setUserId(user.id);
      supabase
        .from("profiles")
        .select("display_name, academic_level, explanation_level")
        .eq("id", user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setDisplayName(data.display_name || "");
            setAcademicLevel(data.academic_level || "");
            setExplanationLevel(data.explanation_level || "");
          }
        });
    });
  }, [supabase, router]);

  async function saveProfile(): Promise<boolean> {
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim(),
        academic_level: academicLevel || null,
        explanation_level: explanationLevel || null,
      })
      .eq("id", userId!);
    if (error) {
      toast("error", "Could not save your preferences: " + error.message);
      return false;
    }
    return true;
  }

  async function saveCourseTeacher(): Promise<void> {
    let teacherId: string | null = null;
    if (teacherName.trim()) {
      const { data: t, error: tErr } = await supabase
        .from("teachers")
        .insert({ user_id: userId, name: teacherName.trim(), notes: "" })
        .select("id")
        .single();
      if (tErr) {
        toast("error", "Could not save the teacher: " + tErr.message);
        return;
      }
      teacherId = t.id;
      await supabase.from("teacher_profiles").insert({ user_id: userId, teacher_id: teacherId });
    }
    if (courseName.trim()) {
      const { error: cErr } = await supabase.from("courses").insert({
        user_id: userId,
        name: courseName.trim(),
        subject: subject.trim() || null,
        teacher_id: teacherId,
        instructions: "",
      });
      if (cErr) toast("error", "Could not save the course: " + cErr.message);
    }
  }

  async function finish() {
    setBusy(true);
    const { error } = await supabase.from("profiles").update({ onboarded: true }).eq("id", userId!);
    setBusy(false);
    if (error) {
      toast("error", "Could not finish setup: " + error.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  async function nextFrom(stepNo: number, opts: { saveProfile?: boolean } = {}) {
    setBusy(true);
    if (opts.saveProfile) {
      const ok = await saveProfile();
      if (!ok) {
        setBusy(false);
        return;
      }
    }
    setBusy(false);
    setStep(stepNo);
    window.scrollTo({ top: 0 });
  }

  return (
    <AppShell title="Welcome to Sophira">
      <div className="mx-auto max-w-xl space-y-6">
        <p className="text-sm font-medium text-ink-soft">Step {Math.min(step, 4)} of 4</p>
        <div className="flex gap-1.5" aria-hidden>
          {[1, 2, 3, 4].map((n) => (
            <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-accent" : "bg-ink/10"}`} />
          ))}
        </div>

        {step === 1 && (
          <Card>
            <CardContent className="space-y-4 p-5">
              <h2 className="text-lg font-semibold text-ink">Hello! Here&apos;s what Sophira does</h2>
              <ul className="space-y-2.5 text-sm text-ink-soft">
                <li className="flex gap-2"><BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Adapts to your courses and each teacher&apos;s exact requirements — methods, steps, notation, formats.</li>
                <li className="flex gap-2"><PenLine className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Learns your writing style from samples you provide — never without them.</li>
                <li className="flex gap-2"><GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Works from elementary school through PhD-level subjects.</li>
                <li className="flex gap-2"><Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-accent" /> Private to you: nobody else — not even the owner — can see your work.</li>
              </ul>
              <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
                Honest note: I won&apos;t know your personal writing style until you give me writing samples.
              </p>
              <div className="flex flex-col gap-2">
                <Button size="lg" onClick={() => setStep(2)}>Get started</Button>
                <Button variant="ghost" onClick={finish} disabled={busy}>Skip setup</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardContent className="space-y-4 p-5">
              <h2 className="text-lg font-semibold text-ink">How should I explain things to you?</h2>
              <div>
                <Label htmlFor="name">Your name</Label>
                <Input id="name" className="mt-1.5" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How should I greet you?" />
              </div>
              <div>
                <Label htmlFor="level">Academic level</Label>
                <Select id="level" className="mt-1.5" value={academicLevel} onChange={(e) => setAcademicLevel(e.target.value)}>
                  <option value="">Choose one (optional)</option>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="expl">Explanation style</Label>
                <Select id="expl" className="mt-1.5" value={explanationLevel} onChange={(e) => setExplanationLevel(e.target.value)}>
                  <option value="">Choose one (optional)</option>
                  {EXPLANATION.map((l) => <option key={l} value={l}>{l}</option>)}
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Button size="lg" disabled={busy} onClick={() => nextFrom(3, { saveProfile: true })}>
                  {busy ? "Saving…" : "Save & continue"}
                </Button>
                <Button variant="ghost" onClick={() => setStep(3)}>Skip</Button>
                <Button variant="ghost" onClick={() => setStep(1)}>← Back</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <CardContent className="space-y-4 p-5">
              <h2 className="text-lg font-semibold text-ink">Add a course &amp; teacher (optional)</h2>
              <p className="text-sm text-ink-soft">This is what makes Sophira follow your teacher&apos;s rules. You can add more any time.</p>
              <div>
                <Label htmlFor="course">Course name</Label>
                <Input id="course" className="mt-1.5" value={courseName} onChange={(e) => setCourseName(e.target.value)} placeholder="e.g. AP Calculus BC" />
              </div>
              <div>
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" className="mt-1.5" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Calculus" />
              </div>
              <div>
                <Label htmlFor="teacher">Teacher</Label>
                <Input id="teacher" className="mt-1.5" value={teacherName} onChange={(e) => setTeacherName(e.target.value)} placeholder="e.g. Mr. Adeyemi" />
              </div>
              <div className="flex flex-col gap-2">
                <Button size="lg" disabled={busy} onClick={async () => { setBusy(true); await saveCourseTeacher(); setBusy(false); setStep(4); window.scrollTo({ top: 0 }); }}>
                  {busy ? "Saving…" : "Continue"}
                </Button>
                <Button variant="ghost" onClick={() => setStep(4)}>Skip</Button>
                <Button variant="ghost" onClick={() => setStep(2)}>← Back</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 4 && (
          <>
            <Card>
              <CardContent className="space-y-3 p-5">
                <h2 className="text-lg font-semibold text-ink">You&apos;re set up</h2>
                <p className="text-sm text-ink-soft">A few things you can do next — none are required.</p>
                <div className="grid gap-2">
                  <Link href="/writing" className="flex items-center gap-2 rounded-lg border border-ink/10 p-3 text-sm font-medium text-ink hover:border-accent/40">
                    <PenLine className="h-4 w-4 text-accent" /> Add writing samples so my writing sounds like you
                  </Link>
                  <Link href="/install" className="flex items-center gap-2 rounded-lg border border-ink/10 p-3 text-sm font-medium text-ink hover:border-accent/40">
                    <Smartphone className="h-4 w-4 text-accent" /> Install Sophira on your phone
                  </Link>
                </div>
              </CardContent>
            </Card>
            <Button size="lg" className="w-full" disabled={busy} onClick={finish}>
              {busy ? "Opening your dashboard…" : "Jump straight in"}
            </Button>
          </>
        )}
      </div>
    </AppShell>
  );
}
