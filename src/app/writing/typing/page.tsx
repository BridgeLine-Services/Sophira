import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { SignOutButton } from "@/components/app/SignOutButton";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { TypingTest } from "@/components/app/TypingTest";
import { Gauge } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Typing Calibration (Writing Engine, 2026-10-09): relocated from Settings
 * per the course-engine specification. The same TypingTest component, the
 * same /api/typing backend, the same attempts and baseline — history and
 * pacing are preserved; no recalibration is required.
 */
export default async function TypingCalibrationPage() {
  const supabase = createClient();
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
            <p className="text-xs text-ink-soft" role="note">Reason: {profileReason}</p>
          )}
          <SignOutButton />
        </div>
      </AppShell>
    );
  }
  if (profile.status === "revoked") redirect("/access-denied");
  if (!profile.onboarded) redirect("/onboarding");

  return (
    <AppShell title="Typing calibration" backHref="/writing">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Gauge className="h-4 w-4 text-accent" /> Typing calibration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink-soft">
              Paced writing reveals text at a speed calibrated to you. Take the test, then choose
              which valid attempt becomes your baseline — only your choice sets it, and you can
              retake or replace it any time. Your attempts are private (row-level security) and the
              typed text itself is never stored.
            </p>
            <TypingTest />
            <p className="text-xs text-ink-soft">
              Instant presentation always remains available; calibrated or custom pacing are optional
              choices in the essay workflow.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
