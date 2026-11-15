import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { SignOutButton } from "@/components/app/SignOutButton";
import { AppShell } from "@/components/app/AppShell";
import { AutonomousRuns } from "@/components/app/AutonomousRuns";

export const dynamic = "force-dynamic";

/**
 * AUTONOMOUS ASSIGNMENT RUNS (directive 2026-11-15, Part 4 + Part 7).
 *
 * The runner and its routes shipped before this page; a student had no screen to reach them.
 * The page itself does no work and makes no claim: it renders the client panel, which reports
 * exactly what the server stored. The manual workflow at /writing is untouched.
 */
export default async function AutonomousRunsPage() {
  const supabase = createClient();
  const user = await requireUser(supabase);

  const { profile, reason: profileReason } = await readProfileWithRepair(supabase, user.id);
  if (!profile) {
    return (
      <AppShell subtitle="Assignments Sophira works through for you." title="Account problem">
        <div className="mx-auto max-w-md space-y-3 py-10 text-center">
          <h1 className="text-xl font-semibold text-ink">Your account could not be loaded</h1>
          <p className="text-sm text-ink-soft">
            You are signed in, but your profile record could not be read. Sign out and sign back in; if
            it persists, the account needs the operator&apos;s attention.
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

  return (
    <AppShell title="Assignment runs" backHref="/writing" subtitle="Assignments Sophira works through for you.">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-ink">Assignment runs</h1>
          <p className="text-sm text-ink-soft">
            Sophira can plan, write and check an assignment for you one step at a time, and it shows you
            exactly how far it has really got.
          </p>
        </div>
        <AutonomousRuns />
      </div>
    </AppShell>
  );
}
