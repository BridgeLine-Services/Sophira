import { Spinner } from "@/components/ui";

/**
 * Loading state for the assignment views (phase 2, 2026-11-03). Both /assignments/[id] and
 * /assignments/new sit under this segment and inherit it, so the member sees "Loading your
 * assignment…" while the server fetches it instead of an empty screen.
 */
export default function Loading() {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4">
      <Spinner />
      <p className="text-sm text-ink-soft">Loading your assignment…</p>
    </div>
  );
}
