import Link from "next/link";

/**
 * Friendly 404 (Stage 5, 2026-11-02). Next.js otherwise serves a bare
 * "This page could not be found" with no way back, which reads as a crash to a
 * non-technical user. Nothing technical is printed here.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-on-accent">?</span>
      <h1 className="text-xl font-semibold text-ink">We couldn&apos;t find that page</h1>
      <p className="text-sm text-ink-soft">
        The link may be out of date, or the page may have moved. Nothing in your
        account has changed. Head back to your dashboard to pick up where you left off.
      </p>
      <div className="flex gap-2">
        <Link
          href="/dashboard"
          className="rounded-button bg-accent px-4 py-2 text-sm font-medium text-on-accent shadow-sm"
        >
          Go to dashboard
        </Link>
        <Link
          href="/courses"
          className="rounded-button border border-line bg-card px-4 py-2 text-sm font-medium text-ink shadow-sm"
        >
          Browse courses
        </Link>
      </div>
    </div>
  );
}
