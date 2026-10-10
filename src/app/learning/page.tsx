import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { SignOutButton } from "@/components/app/SignOutButton";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { CorrectionsPanel } from "@/components/app/CorrectionsPanel";
import { MemoryManager } from "@/components/app/MemoryManager";
import type { LearningPattern } from "@/lib/learning/patterns";
import type { StudentMemory } from "@/lib/memory/engine";
import { subjectBySlug, classifyEngine } from "@/lib/courses/engines";

export const dynamic = "force-dynamic";

/**
 * Learning / Memory (2026-10-09): one user-facing destination consolidating
 * the former /corrections (Learning) and /memories (Memory) pages, per the
 * course-engine specification. Data, tables, routes, and RLS policies are
 * UNCHANGED — the same records are read here, clearly separated into
 * sections. Global vs subject/course-scoped learning stays distinct: a
 * pattern's scope column governs where it applies (a calculus correction
 * never influences biology writing).
 */
export default async function LearningPage({
  searchParams,
}: {
  searchParams?: { course_id?: string; subject?: string };
}) {
  const supabase = createClient();
  const user = await requireUser(supabase);

  // Course workspace context: narrow the memories section to the course's
  // subject (plus global memories). RLS still governs every row; this only
  // narrows the signed-in student's own view.
  let course: { name: string; subject: string | null } | null = null;
  if (searchParams?.course_id) {
    const { data } = await supabase
      .from("courses")
      .select("name, subject")
      .eq("id", searchParams.course_id)
      .single();
    course = (data as { name: string; subject: string | null } | null) ?? null;
  }

  // Subject workspace context (?subject=<slug>): narrow the memories to the
  // user's own courses in that subject group plus intentionally global
  // memories. RLS governs every row; this only narrows the owner of the data.
  let subjectScope: { label: string; subjects: string[] } | null = null;
  if (!searchParams?.course_id && searchParams?.subject) {
    const node = subjectBySlug(searchParams.subject);
    if (node) {
      const { data: groupCourses } = await supabase.from("courses").select("subject").order("name");
      const subjects = Array.from(new Set(
        (groupCourses ?? [])
          .filter((c: { subject: string | null }) => c.subject && node.engines.includes(classifyEngine(c.subject)))
          .map((c: { subject: string | null }) => (c.subject as string).toLowerCase())
      ));
      subjectScope = { label: node.label, subjects };
    }
  }

  const { profile, reason: profileReason } = await readProfileWithRepair(supabase, user.id);
  if (!profile) {
    return (
      <AppShell title="Account problem">
        <div className="mx-auto max-w-md space-y-3 py-10 text-center">
          <h1 className="text-xl font-semibold text-ink">Your account could not be loaded</h1>
          <p className="text-sm text-ink-soft">
            You are signed in, but your profile record could not be read. Sign out and sign back in;
            if it persists, the account needs the operator&apos;s attention.
          </p>
          {profileReason && (
            <p className="text-xs text-ink-soft" role="note">Reason: {profileReason}</p>
          )}
          <SignOutButton />
        </div>
      </AppShell>
    );
  }
  if (profile.status === "revoked") redirect("/access-denied");
  if (!profile.onboarded) redirect("/onboarding");

  const [{ data: patterns, error: patternsError }, { data: memories }, { data: changeHistory }] = await Promise.all([
    supabase
      .from("learning_patterns")
      .select("*")
      .eq("user_id", user.id)
      .order("last_observed", { ascending: false }),
    supabase
      .from("student_memories")
      .select("id, user_id, category, statement, details, subject, subject_tags, confidence, status, improvement_trend, origin, source, first_observed, last_observed, last_used_at, created_at, updated_at")
      .eq("user_id", user.id)
      .neq("status", "forgotten")
      .order("last_observed", { ascending: false }),
    // GLOBAL CHANGES (merged destination, spec §3.4): the real decided
    // change history — nothing invented, ownership and timestamps preserved.
    supabase
      .from("profile_update_proposals")
      .select("id, target_type, change_summary, status, created_at, decided_at")
      .neq("status", "pending")
      .order("decided_at", { ascending: false })
      .limit(10),
  ]);

  const [writingProfile, teacherProfile, typingBaseline] = await Promise.all([
    supabase.from("writing_profiles").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("teacher_profiles").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("typing_attempts").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_baseline", true),
  ]);

  const setupItems: { label: string; href: string; done: boolean; note: string }[] = [
    {
      label: "Writing style & formatting", href: "/writing",
      done: (writingProfile?.count ?? 0) > 0,
      note: "Save a writing sample so essays match your voice",
    },
    {
      label: "Teacher methods & notation", href: "/teachers",
      done: (teacherProfile?.count ?? 0) > 0,
      note: "Teacher-specific math methods, notation, and rules",
    },
    {
      label: "Typing calibration", href: "/writing/typing",
      done: (typingBaseline?.count ?? 0) > 0,
      note: "Optional — sets a comfortable pace for calibrated text reveal",
    },
    {
      label: "Global academic preferences", href: "/settings",
      done: true,
      note: "Explanation level, answer style, formatting, language — in Settings",
    },
    {
      label: "Privacy & data controls", href: "/settings",
      done: true,
      note: "Inspect, correct, or reset personalization at any time",
    },
  ];

  return (
    <AppShell title={subjectScope ? `Learning / Memory — ${subjectScope.label}` : "Learning / Memory"}>
      <div className="mb-4 space-y-1">
        <p className="text-sm text-ink-soft">
          Everything Sophira has learned about how you work academically — in one place: global
          preferences, corrections and recurring mistakes, approved learning patterns, and
          subject- and course-specific memories. Each user&apos;s learning profile is separate and private; the owner cannot read another member&apos;s data.
        </p>
        <p className="text-xs text-ink-soft">
          Global learning and subject-specific learning stay distinct: a pattern or memory scoped
          to calculus never influences biology writing. AI-inferred items are evidence-backed
          hypotheses, never asserted facts, and nothing approved is silently overwritten.
        </p>
      </div>

      {/* Personalization setup */}
      <Card className="mb-4">
        <CardHeader><CardTitle>Personalization setup</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-ink-soft">
            Every step is optional and can be finished later — the app works without them. Teacher
            instructions and the current assignment always take priority over saved preferences.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {setupItems.map((item) => (
              <li key={item.href + item.label} className="flex items-start justify-between gap-2 rounded-card border border-ink/10 p-3">
                <div>
                  <p className="text-sm font-medium text-ink">{item.label}</p>
                  <p className="text-xs text-ink-soft">{item.note}</p>
                </div>
                <Link
                  href={item.href}
                  className="shrink-0 rounded-lg border border-ink/10 px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/5"
                >
                  {item.done ? "Review" : "Set up"}
                </Link>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {/* Section 1: corrections, recurring mistakes, approved learning patterns */}
      <section aria-label="Corrections and learning patterns" className="mb-6">
        <h2 className="mb-2 text-base font-semibold text-ink">Corrections &amp; learning patterns</h2>
        <p className="mb-4 text-sm leading-relaxed text-ink-soft">
          Recurring mistakes, methods you actually use, and corrections you&apos;ve confirmed — with
          each pattern&apos;s scope, confidence, and lifecycle under your control.
        </p>
        {patternsError ? (
          <p className="text-sm text-ink-soft">Learning data is unavailable: {patternsError.message}. Run migration 0005 in Supabase.</p>
        ) : (
          <CorrectionsPanel initialPatterns={(patterns || []) as LearningPattern[]} />
        )}
      </section>

      {/* Section 2: long-term memories */}
      <section aria-label="Long-term memories" className="mb-6">
        <h2 className="mb-2 text-base font-semibold text-ink">Subject &amp; course memories</h2>
        <p className="mb-4 text-sm leading-relaxed text-ink-soft">
          Your long-term academic memory — goals, strengths, weaknesses, habits, and strategies,
          scoped by subject and course. Inspect the evidence behind any AI-inferred memory,
          disable it, or permanently forget it.
        </p>
        {subjectScope && (
          <p className="rounded-lg border border-ink/10 bg-paper p-3 text-sm text-ink-soft">
            Subject workspace view: memories narrowed to {subjectScope.label} plus intentionally
            global memories. <Link href="/learning" className="text-accent underline">View all memories</Link>
          </p>
        )}
        {course && (
          <p className="mb-2 text-xs text-ink-soft" role="note">
            Course workspace view: memories narrowed to {course.subject || "this course's subject"} plus
            global ones. <Link href="/learning" className="font-medium text-accent underline">All memories</Link>
          </p>
        )}
        <MemoryManager
          initialMemories={(memories || []) as StudentMemory[]}
          subjectFilter={course ? course.subject : subjectScope ? subjectScope.subjects : null}
        />
      </section>

      {/* Section 3: history + GLOBAL CHANGES (merged destination, spec §3.4) */}
      <section aria-label="Profile and version history">
        <h2 className="mb-2 text-base font-semibold text-ink">Changes &amp; versions</h2>
        <p className="mb-3 text-sm text-ink-soft">
          Your global change history: decided profile updates, recorded corrections, and
          configuration changes. Subject-specific changes stay in each subject workspace.
        </p>
        {(changeHistory ?? []).length === 0 ? (
          <p className="rounded-lg border border-ink/10 bg-paper p-3 text-sm text-ink-soft">
            No decided changes yet. When you approve a proposed correction or profile update,
            it is recorded here with its reason and timestamp — nothing is invented.
          </p>
        ) : (
          <ul className="space-y-2">
            {(changeHistory ?? []).map((d: { id: string; target_type: string | null; change_summary: string | null; status: string | null; decided_at: string | null }) => (
              <li key={d.id} className="rounded-lg border border-ink/10 bg-paper p-3">
                <p className="text-sm font-medium text-ink">{d.change_summary ?? "Profile update"}</p>
                <p className="text-xs text-ink-soft">
                  {d.target_type ? `${d.target_type} · ` : ""}{d.status ?? "decided"}
                  {d.decided_at ? ` · ${new Date(d.decided_at).toLocaleDateString()}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-ink-soft">
          Every proposed correction, its reason, and its approval status — with rollback where
          supported — in{" "}
          <Link href="/proposals" className="font-medium text-accent underline">the full Changes history</Link>.
        </p>
      </section>
    </AppShell>
  );
}
