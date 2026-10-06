"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label } from "@/components/ui";
import { Sparkles } from "lucide-react";

export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();
  const [mode, setMode] = useState<"request" | "set" | "done">("request");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    // Recovery links may arrive with Supabase error params when the link
    // is expired, invalid, malformed, tampered, or already used
    // (e.g. ?error=access_denied&error_code=otp_expired). Fail safely and
    // VISIBLY: no session is established, and the user is told to request
    // a fresh link. Nothing is exposed about the account.
    const params = new URLSearchParams(
      window.location.search.includes("error") || window.location.search.includes("code")
        ? window.location.search
        : window.location.hash.startsWith("#error") || window.location.hash.startsWith("#code") || window.location.hash.includes("error=")
          ? window.location.hash.slice(1)
          : ""
    );
    if (params.get("error") || params.get("error_code")) {
      setLinkError("This password-reset link is invalid, expired, or was already used. For your security it cannot be reused — request a new reset link below.");
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      // A valid recovery link establishes a Supabase recovery session;
      // only then does the page switch into password-change mode. This is
      // a NORMAL Supabase session: it does NOT bypass Sophira's
      // invitation/active-access authorization — the middleware still
      // checks profile status on every request, RLS still applies, and
      // no profile, role, or status field is ever written here.
      if (data.session) setMode("set");
    });
  }, [supabase]);

  // Honest, privacy-preserving request handling. Password recovery is an
  // ONLINE authentication operation (Supabase Auth sends the email). We
  // never reveal whether an email belongs to a Sophira account: success
  // and "no such account" produce the SAME generic message. Only two
  // classes of error are shown honestly, and neither reveals account
  // existence: offline/fetch failures (we did NOT send an email) and
  // provider rate limits (applied to all addresses alike).
  async function onRequest(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setBusy(false);
      setError("Password recovery requires an internet connection — it is an online authentication operation. Nothing was sent while you are offline; try again once you are connected.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + "/reset-password",
    });
    setBusy(false);
    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (/fetch|network|offline|failed to fetch|load failed/.test(msg)) {
        setError("Password recovery requires connectivity — the reset service could not be reached, so no email was sent. This is an online operation; try again once you are connected.");
        return;
      }
      if (/rate|once every|seconds|too many/.test(msg)) {
        setError("The reset provider is limiting requests for security. Please wait a moment and try again.");
        return;
      }
      // Any other error (including "user not found"-style responses that
      // could reveal account existence) gets the SAME generic response
      // as success. Nothing about this message depends on the account.
      setSent(true);
      return;
    }
    setSent(true);
  }

  async function onSet(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("Please choose a password with at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    await supabase.auth.signOut();
    setMode("done");
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-10">
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-white">
          <Sparkles className="h-6 w-6" />
        </span>
        <h1 className="text-xl font-semibold text-ink">
          {mode === "set" ? "Choose a new password" : sent || mode === "done" ? "Check your inbox" : "Reset your password"}
        </h1>
      </div>

      {mode === "request" && !sent && (
        <form onSubmit={onRequest} className="rounded-card border border-ink/10 bg-white p-5 shadow-sm" noValidate>
          <div className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                className="mt-1.5"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full" size="lg">
              {busy ? "Sending…" : "Send reset link"}
            </Button>
          </div>
        </form>
      )}

      {mode === "request" && linkError && (
        <div className="rounded-card border border-danger/20 bg-danger/5 p-5 text-center shadow-sm" role="alert">
          <p className="text-sm text-danger">{linkError}</p>
          <button
            type="button"
            className="mt-3 text-sm text-accent hover:underline"
            onClick={() => { setLinkError(null); setSent(false); }}
          >
            Request a new reset link
          </button>
        </div>
      )}

      {mode === "request" && sent && (
        <div className="rounded-card border border-ink/10 bg-white p-5 text-center shadow-sm">
          <p className="text-sm text-ink-soft">
            If that email has a Sophira account, a reset link is on its way. Open it and you can set a new password here.
          </p>
        </div>
      )}

      {mode === "set" && (
        <form onSubmit={onSet} className="rounded-card border border-ink/10 bg-white p-5 shadow-sm" noValidate>
          <div className="space-y-4">
            <div>
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                className="mt-1.5"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
              />
            </div>
            <div>
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                className="mt-1.5"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <Button type="submit" disabled={busy} className="w-full" size="lg">
              {busy ? "Saving…" : "Save new password"}
            </Button>
          </div>
        </form>
      )}

      {mode === "done" && (
        <div className="rounded-card border border-ink/10 bg-white p-5 text-center shadow-sm">
          <p className="text-sm text-ink-soft">Your password has been updated. You can sign in with it now.</p>
        </div>
      )}

      <p className="mt-5 text-center text-sm">
        <Link href="/login" className="text-accent hover:underline">Back to sign in</Link>
      </p>
    </div>
  );
}
