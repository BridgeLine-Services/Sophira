"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * ONE-CLICK "Repair Setup" (2026-10-07). Shown ONLY when the server says
 * the first-owner bootstrap is missing pieces - and after the single
 * owner exists it never renders at all. The button carries no SQL, no
 * credentials, and no account identifiers: it just asks the server to
 * run the fixed, idempotent repair it already knows how to perform.
 */
export default function SetupRepair({ available, reason }: { available: boolean; reason: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function repair() {
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch("/api/setup-repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "migrations" }),
      });
      const d = await r.json().catch(() => null);
      setResult(d?.message || "The repair could not be completed.");
      router.refresh();
    } catch {
      setResult("The repair could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-4 text-sm">
      <p className="font-medium">Repair Setup</p>
      <p className="mt-1 text-ink-soft">{reason}</p>
      {available && (
        <button type="button" onClick={repair} disabled={busy}
          className="mt-3 rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-60">
          {busy ? "Repairing..." : "Repair Setup"}
        </button>
      )}
      {result && <p className="mt-3">{result}</p>}
    </div>
  );
}
