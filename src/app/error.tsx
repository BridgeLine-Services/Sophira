"use client";
import Link from "next/link";
import { useState } from "react";

/**
 * Route-level error boundary (blank-screen fix 2026-10-08): a render or
 * data-fetch failure on any page shows a clear message with recovery
 * actions instead of an empty white screen. Error details are never
 * printed (no tokens, emails, or paths leak to the UI).
 *
 * REPORTING (2026-11-12): a user who hit an error could only say "it broke" —
 * the one detail the team needs, the reference code, was buried in developer
 * tools. The screen now shows that reference, offers a copy button, and lets a
 * signed-in person file the failure in Sophira's OWN QA reports table (the
 * existing qa_reports channel, written under RLS as themselves). Deliberate
 * limits:
 *   - nothing is transmitted automatically, only when the person clicks;
 *   - no stack trace, no cookies, no token, no email, no coursework is shown or
 *     sent — only the route and the opaque reference code Vercel already logs;
 *   - every step is wrapped so a reporting failure can never throw inside an
 *     error boundary (that would replace the recovery screen with a blank one).
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Diagnostics (user-requested): log the underlying failure so the cause is
  // visible in the browser console. Only the error's own message/digest —
  // never tokens, cookies, or user content.
  console.error("Sophira page error:", error.message, error.digest ?? "");

  const [report, setReport] = useState<"idle" | "sending" | "sent" | "failed" | "copied">("idle");
  const reference = typeof error.digest === "string" && error.digest.trim() ? error.digest.trim() : "";

  /** Which page failed. A route, never a query string or a fragment. */
  function failedRoute(): string {
    try {
      return window.location.pathname.slice(0, 120);
    } catch {
      return "";
    }
  }

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(
        reference ? `Sophira error reference ${reference} (page ${failedRoute()})` : `Sophira error on page ${failedRoute()}`,
      );
      setReport("copied");
    } catch {
      // Clipboard blocked (permission, insecure context, old browser). The
      // reference is on screen and selectable, so nothing is lost.
      setReport("failed");
    }
  }

  async function reportFailure() {
    setReport("sending");
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data } = await supabase.auth.getUser();
      const userId = data.user?.id;
      if (!userId) {
        setReport("failed");
        return;
      }
      const route = failedRoute();
      const { error: insertError } = await supabase.from("qa_reports").insert({
        user_id: userId,
        kind: "bug",
        title: `Page failed to load${route ? `: ${route}` : ""}`.slice(0, 160),
        area: route,
        severity: "high",
        steps: reference ? `Reference ${reference}` : "",
        expected: "The page opens normally.",
        actual: "Sophira showed its error screen instead of the page.",
      });
      setReport(insertError ? "failed" : "sent");
    } catch {
      setReport("failed");
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-on-accent">!</span>
      <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
      <p className="text-sm text-ink-soft">
        Sophira hit an unexpected problem loading this page. Your account and
        saved work are safe. Try again, or head back to your dashboard.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-button bg-accent px-4 py-2 text-sm font-medium text-on-accent shadow-sm transition active:scale-[0.99]"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-button border border-line bg-card px-4 py-2 text-sm font-medium text-ink shadow-sm"
        >
          Go to dashboard
        </Link>
      </div>

      {/* Safe reference: an opaque code, never a stack trace or user content. */}
      {reference && (
        <p className="text-xs text-ink-soft">
          Reference{" "}
          <code className="select-all rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[0.7rem] text-ink">{reference}</code>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={copyReference}
          className="rounded-button border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-soft shadow-sm hover:text-ink"
        >
          {report === "copied" ? "Copied" : "Copy reference"}
        </button>
        <button
          type="button"
          onClick={reportFailure}
          disabled={report === "sending" || report === "sent"}
          className="rounded-button border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-soft shadow-sm hover:text-ink disabled:opacity-60"
        >
          {report === "sent" ? "Reported" : report === "sending" ? "Reporting…" : "Report this page"}
        </button>
      </div>
      {report === "sent" && (
        <p role="status" className="text-xs text-ink-soft">
          Reported. Whoever manages this network can see it, with the reference above.
        </p>
      )}
      {report === "failed" && (
        <p role="status" className="text-xs text-ink-soft">
          That did not send. The reference above is still the useful detail — please pass it on.
        </p>
      )}
    </div>
  );
}
