import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { CorrectionsPanel } from "@/components/app/CorrectionsPanel";
import type { LearningPattern } from "@/lib/learning/patterns";

export const dynamic = "force-dynamic";

/**
 * Learning & Corrections — structured personal learning state (workflow §9–§12).
 * Data is RLS-scoped to the signed-in user; the owner sees only their own
 * patterns here, same as everyone else.
 */
export default async function CorrectionsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("status, onboarded").eq("id", user.id).single();
  if (!profile) redirect("/login");
  if (profile.status === "revoked") redirect("/access-denied");
  if (!profile.onboarded) redirect("/onboarding");

  const { data: patterns, error } = await supabase
    .from("learning_patterns")
    .select("*")
    .eq("user_id", user.id)
    .order("last_observed", { ascending: false });

  if (error) {
    return (
      <AppShell title="Learning &amp; Corrections">
        <p className="text-sm text-ink-soft">Learning data is unavailable: {error.message}. Run migration 0005 in Supabase.</p>
      </AppShell>
    );
  }

  return (
    <AppShell title="Learning &amp; Corrections">
      <p className="mb-6 text-sm leading-relaxed text-ink-soft">
        This is what Sophira has learned about how you work academically — recurring mistakes, methods
        you actually use, and corrections you&apos;ve confirmed. It is structured knowledge, not chat
        history: every pattern has a scope, a confidence, and a lifecycle you control.
      </p>
      <CorrectionsPanel initialPatterns={(patterns || []) as LearningPattern[]} />
    </AppShell>
  );
}
