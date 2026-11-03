import { Spinner } from "@/components/ui";

/**
 * Loading state for /offline (phase 2, 2026-11-03). Same pattern as the dashboard fix: while the
 * server resolves the session and this page's data, say so in plain words instead of leaving an
 * empty screen. No shimmer, no fake skeleton content - nothing is shown that is not really there.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4">
      <Spinner />
      <p className="text-sm text-ink-soft">Loading your offline work…</p>
    </div>
  );
}
