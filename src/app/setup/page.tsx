import Link from "next/link";
import { evaluateOwnerSetup, probeOwnerSetup, type OwnerSetupStep } from "@/lib/owner-setup";
import { Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Operator setup-status page (public, like /login and /install).
 *
 * WHO THIS IS FOR: the person deploying Sophira (with database access).
 * It answers - in one place, honestly, before any account exists:
 *   is the Supabase connection configured? are the migrations applied?
 *   is app_config.owner_email configured? does the owner account exist and
 *   is it active? is the AI provider configured?
 *
 * WHAT IT NEVER DOES: display or imply secrets - no keys, no tokens, no
 * emails, no passwords - and it never implies Sophira has a predefined or
 * default owner password (the owner always chooses their own through the
 * normal signup flow). Machine-checked by the offline suite.
 */
export default async function SetupPage() {
  const probe = await probeOwnerSetup();
  const status = evaluateOwnerSetup(probe);

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-10">
      <header className="mb-8 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-sm font-medium text-accent">
          <Sparkles className="h-4 w-4" aria-hidden /> Sophira
        </div>
        <h1 className="text-2xl font-semibold">Owner setup status</h1>
        <p className="mt-2 text-ink-soft">
          A diagnostic for the person deploying Sophira. It reports configuration
          status only - never keys, tokens, emails, or passwords.
        </p>
      </header>

      <section
        aria-live="polite"
        className={`mb-6 rounded-card border p-4 ${
          status.ready === true
            ? "border-success/40 bg-success/5"
            : status.ready === false
              ? "border-warn/40 bg-warn/5"
              : "border-ink/10 bg-ink/5"
        }`}
      >
        <p className="font-medium">
          {status.ready === true ? "✓ " : status.ready === false ? "• " : "… "}
          {status.headline}
        </p>
      </section>

      <section className="mb-6 space-y-3" aria-label="Setup checklist">
        {status.steps.map((step: OwnerSetupStep) => (
          <div
            key={step.label}
            className={`rounded-card border p-4 ${
              step.done === true ? "border-success/30" : step.done === false ? "border-warn/30" : "border-ink/10"
            }`}
          >
            <p className="flex items-start gap-2 font-medium">
              <span aria-hidden>
                {step.done === true ? "✅" : step.done === false ? "⬜" : "❔"}
              </span>
              <span>{step.label}</span>
            </p>
            <p className="mt-1 pl-7 text-sm leading-relaxed text-ink-soft">{step.detail}</p>
          </div>
        ))}
      </section>

      <section className="mb-6 rounded-card border border-ink/10 p-4">
        <h2 className="font-medium">What to do next</h2>
        {status.guidance.length > 0 ? (
          <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-ink-soft">
            {status.guidance.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-ink-soft">Nothing - setup is complete.</p>
        )}
      </section>

      <section className="mb-6 rounded-card border border-ink/10 p-4">
        <h2 className="font-medium">How the owner account works</h2>
        <ul className="mt-2 space-y-2 text-sm leading-relaxed text-ink-soft">
          <li>
            The initial owner is the exact email configured in{" "}
            <code className="rounded bg-ink/5 px-1">app_config.owner_email</code> in
            the database. Until it is configured, no account can be created at all
            (fail-closed by design - an arbitrary first user can never become the
            owner).
          </li>
          <li>
            The owner account is created through the{" "}
            <Link href="/signup" className="text-accent hover:underline">normal signup flow</Link>{" "}
            with that exact email, and the owner chooses their own password there.
            Sophira has no predefined, default, or generated owner password.
          </li>
          <li>
            Forgot the owner password? Use the existing password-reset flow:{" "}
            <Link href="/reset-password" className="text-accent hover:underline">
              reset your password by email
            </Link>
            .
          </li>
        </ul>
      </section>

      <footer className="mt-auto pt-4 text-center text-sm text-ink-soft">
        <Link href="/login" className="text-accent hover:underline">Back to sign in</Link>
      </footer>
    </div>
  );
}
