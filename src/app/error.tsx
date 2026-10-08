"use client";
import Link from "next/link";

/**
 * Route-level error boundary (blank-screen fix 2026-10-08): a render or
 * data-fetch failure on any page shows a clear message with recovery
 * actions instead of an empty white screen. Error details are never
 * printed (no tokens, emails, or paths leak to the UI).
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white">!</span>
      <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
      <p className="text-sm text-ink-soft">
        Sophira hit an unexpected problem loading this page. Your account and
        saved work are safe. Try again, or head back to your dashboard.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-button bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm transition active:scale-[0.99]"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-button border border-ink/10 bg-white px-4 py-2 text-sm font-medium text-ink shadow-sm"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
