import Link from "next/link";
import { evaluateOwnerSetup, probeOwnerSetup, type OwnerSetupStatus } from "@/lib/owner-setup";
import SetupDiagnostics from "./SetupDiagnostics";
import SetupWizard from "./SetupWizard";

/**
 * FIRST-LAUNCH SETUP WIZARD (2026-10-07) - SERVER component.
 *
 * The non-technical owner's guided setup: "Welcome to Sophira" with a
 * short plain-English checklist. All technical terminology (environment
 * variable names, migration filenames, database internals) lives ONLY in
 * the collapsible "Advanced diagnostics" section below - never in the
 * normal owner-facing flow.
 *
 * The database probe (which reads SERVER-ONLY environment variables) runs
 * here on the server - secret names never reach the client bundle. This
 * page must never display secret VALUES and never imply a default owner
 * password (the owner always chooses their own).
 */
export default async function SetupPage() {
  const status: OwnerSetupStatus = evaluateOwnerSetup(await probeOwnerSetup());
  const creation = status.ownerCreation;
  const connected = status.probe.supabaseConfigured;
  const databaseReady = status.probe.migrationsPresent === true;
  const ownerReady = status.probe.ownerAccount === "active";

  const checklist: { label: string; done: boolean; hint: string }[] = [
    { label: "Connect Sophira", done: connected, hint: "Sophira isn't connected to its private database yet. A simple administrator setup instruction is in Advanced diagnostics below." },
    { label: "Prepare your private database", done: databaseReady, hint: "Your Sophira database needs to be initialized." },
    { label: "Create your owner account", done: ownerReady, hint: "The first account you create becomes the owner." },
    { label: "Finish setup", done: status.ready === true, hint: "Your private Sophira is almost ready." },
  ];

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Welcome to Sophira</h1>
      <p className="mt-2 text-ink-soft">Let&apos;s set up your private academic assistant.</p>

      {/* ---------- Guided checklist (plain language) ---------- */}
      <section className="mt-8 rounded-xl border bg-card p-6">
        <ol className="space-y-3">
          {checklist.map((item, i) => (
            <li key={item.label} className="flex items-start gap-3 text-sm">
              <span
                className={
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs " +
                  (item.done ? "bg-success/15 text-success" : "bg-warn/15 text-warn")
                }
              >
                {item.done ? "✓" : i + 1}
              </span>
              <span>
                <span className={item.done ? "line-through opacity-70" : ""}>{item.label}</span>
                {!item.done && <span className="block text-ink-soft">{item.hint}</span>}
              </span>
            </li>
          ))}
        </ol>

        {!connected && (
          <p className="mt-5 text-sm text-ink-soft">
            Sophira isn&apos;t connected to its private database yet. This is a one-time connection step -
            open Advanced diagnostics below for the exact, short instruction.
          </p>
        )}

        <SetupWizard
          available={status.repair.available && status.repair.action === "migrations"}
          reason={status.repair.reason}
          needsDatabase={connected && !databaseReady && status.probe.ownerAccount !== "active" && status.probe.ownerAccount !== "revoked"}
        />

        {databaseReady && !ownerReady && creation?.possible === true && (
          <>
            <p className="mt-5 text-sm text-ink-soft">
              Your database is ready. Create your owner account - just your email and a password you choose.
              Owner creation then closes permanently, and new people join by invitation only.
            </p>
            <Link href="/create-owner" className="mt-4 inline-block rounded-lg bg-accent px-5 py-2.5 font-medium text-white">
              Create Owner Account
            </Link>
          </>
        )}
        {databaseReady && creation?.possible === false && (
          <p className="mt-5 text-sm text-ink-soft">
            {creation.reason} <Link href="/login" className="text-accent hover:underline">Go to sign in</Link>
          </p>
        )}
        {ownerReady && (
          <p className="mt-5 text-sm text-success">Your private Sophira is ready. <Link href="/owner" className="text-accent hover:underline">Open your dashboard</Link></p>
        )}

        <div className="mt-6 border-t pt-4 text-sm text-ink-soft">
          <span className="font-medium text-ink">AI status:</span>{" "}
          {status.probe.aiConfigured
            ? "Free remote AI is connected as an optional enhancement."
            : "No remote AI account is connected - that is optional. Local AI is built in, needs no API key, and no paid AI is ever used unless you explicitly turn it on."}
        </div>
      </section>

      {/* ---------- Advanced diagnostics (collapsible, technical) ---------- */}
      <details className="mt-8 rounded-xl border p-6">
        <summary className="cursor-pointer text-sm font-medium text-ink-soft">
          Advanced diagnostics (for administrators/maintenance)
        </summary>
        <div className="mt-4 space-y-4">
          <p className="text-sm text-ink-soft">
            {!connected
              ? "Administrator setup: connect the Vercel project to its Supabase project with the official Supabase integration - it provisions every required connection automatically (see docs/VERCEL_DEPLOYMENT.md). No tokens, no GitHub configuration, no SQL."
              : status.repair.available === false && status.state === "SETUP_REQUIRED"
                ? status.repair.reason
                : "Everything below is the technical state; the steps above are the guided flow."}
          </p>
          <SetupDiagnostics status={status} />
        </div>
      </details>
    </main>
  );
}
