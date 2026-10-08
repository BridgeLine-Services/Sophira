"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
}: {
  available: boolean;
  reason: string;
  needsDatabase: boolean;
  channel: "direct-postgres" | "management-api" | "none";
  supabaseIntegrationsUrl: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(-1);
  const [result, setResult] = useState<string | null>(null);

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
        setResult("Setup complete. Your private database is ready.");
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

  if (!needsDatabase) return null;

  return (
    <section className="mt-6 rounded-xl border border-warn/30 bg-warn/5 p-6">
      <h2 className="font-medium">Prepare your private database</h2>
      <p className="mt-2 text-sm text-ink-soft">
        {available
          ? "Sophira can prepare everything for you automatically. This usually takes under a minute."
          : channel === "none"
            ? "Sophira needs a one-time connection to prepare your database automatically. Open your Sophira database dashboard with the button below, choose Vercel, press Connect project, and pick your Sophira - then come back and press Check again. That single connection is the only step; no passwords to copy, no SQL, nothing else."
            : "Automatic setup is temporarily unavailable - open Advanced diagnostics below for the exact state."}
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
