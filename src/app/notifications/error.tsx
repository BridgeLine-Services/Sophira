"use client";

/**
 * The notification centre failing to load (2026-11-13). It says what happened in the member's
 * own words and offers one action; it never shows an error code or suggests the member's
 * notices were lost, because nothing is deleted by a failed page load.
 */
export default function NotificationsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl p-6">
      <h1 className="text-lg font-semibold text-ink">Notifications couldn&apos;t be loaded</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Sophira couldn&apos;t reach your notifications just now. Nothing has been lost — your notices
        are still there and will appear when the page loads.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg border px-3 py-1.5 text-sm font-medium text-ink"
      >
        Try again
      </button>
    </div>
  );
}
