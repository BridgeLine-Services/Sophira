import Link from "next/link";
import { evaluateOwnerSetup, probeOwnerSetup, type OwnerSetupStatus } from "@/lib/owner-setup";
import SetupDiagnostics from "./SetupDiagnostics";
import SetupRepair from "./SetupRepair";

/**
 * Setup experience (2026-10-06 first-owner bootstrap) — SERVER component.
 *
 *   A. "Create my owner account" — plain language, no technical
 *      configuration required. Owner creation NEVER depends on AI
 *      configuration or any API key.
 *
 *   B. "Technical diagnostics" — the operator/developer checklist in a
 *      separate optional client component.
 *
 * The database probe (which reads SERVER-ONLY environment variables)
 * runs here on the server — secret names never reach the client bundle.
 * This page must never display secret VALUES and never imply a default
 * owner password (the owner always chooses their own).
 */
export default async function SetupPage() {
  const status: OwnerSetupStatus = evaluateOwnerSetup(await probeOwnerSetup());
  const creation = status.ownerCreation;

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Getting started with Sophira</h1>

      {/* ---------- A. Owner account (plain language) ---------- */}
      <section className="mt-8 rounded-xl border bg-card p-6">
        <h2 className="font-medium">Your owner account</h2>
        {creation?.possible === true && (
          <>
            <p className="mt-2 text-sm text-ink-soft">
              Sophira has no owner yet. The first account you create becomes the owner — no technical setup needed,
              just your email and a password you choose. Owner creation then closes permanently, and new people join by invitation only.
            </p>
            <Link href="/create-owner" className="mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 font-medium text-white">
              Create Owner Account
            </Link>
          </>
        )}
        {creation?.possible === false && (
          <p className="mt-2 text-sm text-ink-soft">
            {creation.reason} <Link href="/login" className="text-accent hover:underline">Go to sign in</Link>
          </p>
        )}
        {status.state === "SETUP_REQUIRED" && status.probe.ownerAccount !== "active" && status.probe.ownerAccount !== "revoked" && (
          <SetupRepair available={status.repair.available} reason={status.repair.reason} />
        )}
        {creation?.possible === null && (
          <p className="mt-2 text-sm text-ink-soft">
            {creation.reason} You can still try{" "}
            <Link href="/create-owner" className="text-accent hover:underline">creating the owner account</Link> —
            Sophira will tell you honestly if it is not possible yet.
          </p>
        )}
        {status.probe.ownerAccount === "active" && (
          <p className="mt-3 text-sm text-success">Your account is ready.</p>
        )}

        {/* ---------- AI status, plain language ---------- */}
        <div className="mt-5 border-t pt-4 text-sm text-ink-soft">
          <span className="font-medium text-ink">AI status:</span>{" "}
          {status.probe.aiConfigured
            ? "Free remote AI is connected as an optional enhancement."
            : "No remote AI account is connected — that is optional. Local AI is built in, needs no API key, and no paid AI is ever used unless you explicitly turn it on."}
        </div>
      </section>

      {/* ---------- B. Technical diagnostics (optional, separate) ---------- */}
      <section className="mt-8">
        <h2 className="text-sm font-medium text-ink-soft">Technical diagnostics (for developers/maintenance) — optional, never blocks owner creation</h2>
        <SetupDiagnostics status={status} />
      </section>
    </main>
  );
}
