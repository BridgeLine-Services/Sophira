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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      // A recovery link creates a session; then we let the user set a new password.
      if (data.session) setMode("set");
    });
  }, [supabase]);

  async function onRequest(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin + "/reset-password",
    });
    setBusy(false);
    if (error) {
      setError(error.message);
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
