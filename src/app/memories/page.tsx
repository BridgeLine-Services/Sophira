import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("status, onboarded").eq("id", user.id).single();
  if (!profile) redirect("/login");
  if (profile.status === "revoked") redirect("/access-denied");
  if (!profile.onboarded) redirect("/onboarding");

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
      <MemoryManager initialMemories={(memories || []) as StudentMemory[]} />
    </AppShell>
  );
}
