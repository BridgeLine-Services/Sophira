import { Spinner } from "@/components/ui";

/**
 * Loading state for /lectures (Phase 5, 2026-11-09). While the session and the
 * member's recordings are being resolved, say so in plain words. No skeleton
 * placeholders: nothing is displayed that is not really there.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4">
      <Spinner />
      <p className="text-sm text-ink-soft">Loading your recordings…</p>
    </div>
  );
}
