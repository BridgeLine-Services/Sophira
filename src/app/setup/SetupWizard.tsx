"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * FIRST-LAUNCH SETUP WIZARD (2026-10-07).
 *
 * Plain-English, non-technical database initialization. The button carries
 * no SQL, no credentials, and no account identifiers: it asks the server to
 * prepare the private database (probe frontier -> apply the repository's
 * own embedded chain -> verify), and reports progress in everyday language.
 * Technical detail never appears here - it lives in Advanced diagnostics.
 */
const PROGRESS_STEPS = [
  "Preparing your private database...",
  "Installing Sophira's security rules...",
  "Preparing owner access...",
  "Checking everything...",
];

export default function SetupWizard({
  available,
  reason,
  needsDatabase,
  channel,
  supabaseIntegrationsUrl,
  sqlEditorUrl,
  setupSqlUrl,
}: {
  available: boolean;
  reason: string;
  needsDatabase: boolean;
  channel: "direct-postgres" | "management-api" | "none";
  supabaseIntegrationsUrl: string | null;
  sqlEditorUrl: string | null;
  setupSqlUrl: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "failed">("idle");

  async function run() {
    setBusy(true);
    setResult(null);
    setStep(0);
    const ticker = setInterval(() => {
      setStep((s) => (s < PROGRESS_STEPS.length - 1 ? s + 1 : s));
    }, 1400);
    try {
      const r = await fetch("/api/setup-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "migrations" }),
      });
      const d = await r.json().catch(() => null);
      clearInterval(ticker);
      if (d?.ok) {
        setStep(PROGRESS_STEPS.length);
        setResult("Setup complete. Your private database is ready. Opening owner account creation…");
        // 2026-10-28: advance automatically - the owner never has to guess
        // the next step or press "Check again".
        router.push("/create-owner");
        router.refresh();
      } else {
        setStep(-1);
        setResult(
          d?.message ||
            "Setup couldn't finish yet. Nothing was skipped - try again in a moment, or open Advanced diagnostics."
        );
      }
      router.refresh();
    } catch {
      clearInterval(ticker);
      setStep(-1);
      setResult("Setup couldn't finish yet. Nothing was skipped - try again in a moment, or open Advanced diagnostics.");
      setBusy(false);
      return;
    }
    setBusy(false);
  }

  // 2026-10-28: automatic first-launch behaviour.
  //  1. When the app CAN prepare the database itself, do it immediately -
  //     no "Continue setup" click, no "Check again".
  //  2. When a real external prerequisite is missing, re-check on a timer so
  //     setup resumes by itself the moment the connection becomes available.
  const autoTried = useRef(false);
  const [autoStopped, setAutoStopped] = useState(false);
  useEffect(() => {
    if (!needsDatabase) return;
    if (available && !autoTried.current) {
      autoTried.current = true;
      void run();
      return;
    }
    if (!available) {
      // Bounded: never spin forever on an unconfirmed workspace. Six
      // attempts over ~90s, then the page states the truth and offers a path.
      const LIMIT = 6;
      let n = 0;
      const t = setInterval(() => {
        n += 1;
        if (n >= LIMIT) {
          clearInterval(t);
          setAutoStopped(true);
          return;
        }
        router.refresh();
      }, 15000);
      return () => clearInterval(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsDatabase, available]);

  if (!needsDatabase) return null;

  return (
    <section className="mt-6 rounded-xl border border-warn/30 bg-warn/5 p-6">
      <h2 className="font-medium">Prepare your private database</h2>
      <p className="mt-2 text-sm text-ink-soft">
        {available
          ? "Sophira can prepare everything for you automatically. This usually takes under a minute."
          : channel === "none"
            ? "Sophira needs a one-time connection to prepare your database automatically. Open your Sophira database dashboard with the button below, choose Vercel, press Connect project, and pick your Sophira - then come back and press Check again. That single connection is the only step; no passwords to copy, no SQL, nothing else."
            : "Sophira could not reach your database directly from this hosting platform, so the one-click setup cannot run here. The manual path below takes about two minutes and needs no technical knowledge."}
      </p>
      {available && (
        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="mt-4 rounded-lg bg-accent px-5 py-2.5 font-medium text-white disabled:opacity-60"
        >
          {busy ? "Working..." : "Set Up Sophira"}
        </button>
      )}
      {!available && channel === "none" && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {supabaseIntegrationsUrl && (
            <a
              href={supabaseIntegrationsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white"
            >
              Open your database dashboard
            </a>
          )}
          <button
            type="button"
            onClick={() => router.refresh()}
            className="rounded-lg border px-5 py-2.5 font-medium"
          >
            Check again
          </button>
        </div>
      )}
      {autoStopped && (
        <p className="mt-4 rounded-lg border border-ink/15 bg-accent-soft/40 p-3 text-sm text-ink">
          Sophira could not confirm the database on its own. That is not a dead end:
          press <strong>Create owner account</strong> above and that page retries the setup for
          you, or open <strong>Advanced</strong> below for the technical reason.
        </p>
      )}
      {!available && channel === "direct-postgres" && (
        <div className="mt-4 space-y-3 text-sm">
          <button
            type="button"
            onClick={async () => {
              try {
                const r = await fetch(setupSqlUrl);
                const text = await r.text();
                await navigator.clipboard.writeText(text);
                setCopied("ok");
              } catch {
                setCopied("failed");
              }
            }}
            className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white"
          >
            Copy the setup text
          </button>
          {copied === "ok" && (
            <p className="text-sm text-ink-soft">
              Copied. Now paste it into the Supabase window (Ctrl+V / Cmd+V) and press Run.
            </p>
          )}
          {copied === "failed" && (
            <p className="text-sm text-ink-soft">
              Your browser blocked copying.{" "}
              <a className="font-medium text-accent underline" href={setupSqlUrl} target="_blank" rel="noopener noreferrer">
                Open the setup text
              </a>{" "}
              and press Ctrl+A / Cmd+A, then Ctrl+C / Cmd+C.
            </p>
          )}
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Open{" "}
              {sqlEditorUrl ? (
                <a className="font-medium text-accent underline" href={sqlEditorUrl} target="_blank" rel="noopener noreferrer">
                  your Supabase SQL editor
                </a>
              ) : (
                "your Supabase project's SQL editor"
              )}{" "}
              in a new tab.
            </li>
            <li>
              Open the{" "}
              <a className="font-medium text-accent underline" href={setupSqlUrl} target="_blank" rel="noopener noreferrer">
                one-time setup file
              </a>
              , select all of it (Ctrl+A / Cmd+A), copy, and paste it into the SQL editor.
            </li>
            <li>
              Press <strong>Run</strong> in Supabase. It finishes in a few seconds and never deletes anything.
            </li>
            <li>
              Return here and press <strong>Check again</strong>.
            </li>
          </ol>
          <p className="text-sm text-ink-soft">
            If you see "permission denied" or "already exists", just press Run again - it is safe.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => router.refresh()}
              className="rounded-lg bg-accent px-5 py-2.5 font-medium text-white"
            >
              Check again
            </button>
          </div>
        </div>
      )}
      {step >= 0 && step < PROGRESS_STEPS.length && (
        <p className="mt-3 text-sm text-ink-soft" role="status">{PROGRESS_STEPS[step]}</p>
      )}
      {step === PROGRESS_STEPS.length && (
        <p className="mt-3 text-sm font-medium text-success" role="status">Setup complete.</p>
      )}
      {result && <p className="mt-3 text-sm">{result}</p>}
    </section>
  );
}
