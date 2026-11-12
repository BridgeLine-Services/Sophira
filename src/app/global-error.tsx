"use client";

/**
 * Last-resort error boundary (2026-11-03).
 *
 * src/app/error.tsx catches errors thrown inside the page tree, but Next does NOT route errors
 * from the root layout through it - those require a global-error, which is also the only boundary
 * required to render its own <html> and <body>. Without this file a layout-level crash showed the
 * visitor a blank white page with no way forward.
 *
 * Styles are inline on purpose: if the root layout failed, its stylesheet may never have loaded,
 * so a Tailwind class here could render as unstyled text or as nothing at all.
 *
 * Honest limit: this component compiles and ships with the build, but no automated check exercises
 * a genuine layout crash, so "renders correctly when triggered" is browser-verifiable work, not
 * something this repository has proven.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // 2026-11-12: the same safe reference the route boundary shows. No stack trace,
  // no user content, nothing transmitted — just the opaque code the platform logs.
  const reference = typeof error?.digest === "string" && error.digest.trim() ? error.digest.trim() : "";
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", background: "rgb(var(--c-paper))", color: "rgb(var(--c-ink))" }}>
        <main style={{ maxWidth: 520, margin: "0 auto", padding: "64px 24px" }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 24px", color: "rgb(var(--c-ink-soft))" }}>
            Sophira could not load this screen. Nothing you had saved has been deleted — this is
            only the page that failed to appear.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{ font: "inherit", fontSize: 15, padding: "10px 18px", borderRadius: 10, border: "1px solid rgb(var(--c-accent))", background: "rgb(var(--c-accent))", color: "rgb(var(--c-on-accent))", cursor: "pointer" }}
            >
              Try again
            </button>
            {/* A plain <a> is deliberate: if the app shell is broken, a client-side Link
                navigation may fail for the same reason this boundary was reached. */}
            <a
              href="/dashboard"
              style={{ font: "inherit", fontSize: 15, padding: "10px 18px", borderRadius: 10, border: "1px solid rgb(var(--c-line))", background: "rgb(var(--c-on-accent))", color: "rgb(var(--c-ink))", textDecoration: "none" }}
            >
              Go to your dashboard
            </a>
          </div>
          {reference && (
            <p style={{ fontSize: 13, margin: "20px 0 0", color: "rgb(var(--c-ink-soft))" }}>
              Reference{" "}
              <code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", userSelect: "all" }}>{reference}</code>
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
