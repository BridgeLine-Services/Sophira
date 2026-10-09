import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { SignOutButton } from "@/components/app/SignOutButton";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import Link from "next/link";
import { MemoryManager } from "@/components/app/MemoryManager";
import type { StudentMemory } from "@/lib/memory/engine";

export const dynamic = "force-dynamic";

/**
 * Memory Management (workflow §28): the student's long-term academic memory.
 * RLS-scoped: every row read here is the signed-in student's own. The owner
 * has no path to another member's memories — same as all academic data.
 */
export default async function MemoriesPage() {
  const supabase = createClient();
  // Shared session validation + LOOP-PROOF account guard (2026-10-08): an
  // incomplete/unreadable profile NEVER redirects to /login (that was the
  // redirect loop); the user sees one explicit account-problem screen.
  const user = await requireUser(supabase);

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
            <p className="text-xs text-ink-soft" role="note">
              Reason: {profileReason}
            </p>
          )}
          <SignOutButton />
        </div>
      </AppShell>
    );
  }
  if (profile.status === "revoked") redirect("/access-denied");
  if (!profile.onboarded) redirect("/onboarding");

  // PERSONALIZATION SETUP PROGRESS (STEP G, 2026-10-08): the Memory page
  // introduces the personalization setup — what is configured, what is
  // optional, and where to finish it. All steps are skippable; the app
  // never blocks on optional preferences (required account setup is the
  // /onboarding flow, already completed to reach this page).
  const [writingProfile, teacherProfile, typingBaseline] = await Promise.all([
    supabase.from("writing_profiles").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("teacher_profiles").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("typing_attempts").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_baseline", true),
  ]);
  const setupItems: { label: string; href: string; done: boolean; note: string }[] = [
    {
      label: "Writing style & formatting", href: "/writing",
      done: (writingProfile.count ?? 0) > 0,
      note: "Save a writing sample so essays match your voice",
    },
    {
      label: "Teacher methods & notation", href: "/teachers",
      done: (teacherProfile.count ?? 0) > 0,
      note: "Teacher-specific math methods, notation, and rules",
    },
    {
      label: "Typing calibration", href: "/typing-calibration",
      done: (typingBaseline.count ?? 0) > 0,
      note: "Optional — sets a comfortable pace for calibrated text reveal",
    },
    {
      label: "Privacy & data controls", href: "/settings",
      done: true,
      note: "Inspect, correct, or reset personalization at any time",
    },
  ];

  const { data: memories } = await supabase
    .from("student_memories")
    .select("id, user_id, category, statement, details, subject, subject_tags, confidence, status, improvement_trend, origin, source, first_observed, last_observed, last_used_at, created_at, updated_at")
    .eq("user_id", user.id)
    .neq("status", "forgotten")
    .order("last_observed", { ascending: false });

  return (
    <AppShell title="Memory">
      <div className="mb-4 space-y-1">
        <p className="text-sm text-ink-soft">
          Your long-term academic memory — goals, strengths, weaknesses, habits, and strategies.
          The AI considers these when explaining, hinting, and recommending.
        </p>
        <p className="text-xs text-ink-soft">
          AI-inferred memories are evidence-backed hypotheses, never asserted facts: you can inspect
          every piece of evidence behind them, and disable or permanently forget any memory.
          Manually added memories are marked as student-stated facts.
        </p>
      </div>
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Personalization setup</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-ink-soft">
            Every step is optional and can be finished later — the app works
            without them. Teacher instructions and the current assignment always
            take priority over saved preferences.
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
          <p className="text-xs text-ink-soft">
            Each user&apos;s learning profile is separate and private; the owner
            cannot read another member&apos;s memories or preferences.
          </p>
        </CardContent>
      </Card>
      <MemoryManager initialMemories={(memories || []) as StudentMemory[]} />
    </AppShell>
  );
}
