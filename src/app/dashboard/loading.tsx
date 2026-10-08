import { Spinner } from "@/components/ui";

/**
 * Loading state for the authenticated dashboard (blank-screen fix
 * 2026-10-08): while the server resolves the session and data, the user
 * sees an explicit loading indicator — never an empty white page.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4">
      <Spinner />
      <p className="text-sm text-ink-soft">Loading your dashboard…</p>
    </div>
  );
}
