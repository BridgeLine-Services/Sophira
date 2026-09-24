"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Badge, Button } from "@/components/ui";
import { Apple, Download, Smartphone, Check } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function InstallCard() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setOutcome("installed");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (window.matchMedia("(display-mode: standalone)").matches) setInstalled(true);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    setOutcome(outcome);
    if (outcome === "accepted") setInstalled(true);
  }

  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Download className="h-5 w-5 text-accent" />
          <CardTitle>Install Sophira on this device</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {installed ? (
          <div className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2.5 text-sm text-success">
            <Check className="h-4 w-4" /> Sophira is installed — you&apos;re running it as an app right now.
          </div>
        ) : promptEvent ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">Your browser supports one-tap installation.</p>
            <Button onClick={install}>
              <Download className="h-4 w-4" /> Install app
            </Button>
            {outcome === "dismissed" && <p className="text-sm text-ink-soft">No problem — you can install any time from this page.</p>}
          </div>
        ) : (
          <p className="text-sm text-ink-soft">
            {isIOS
              ? "Your browser doesn't show a one-tap install button, but the steps below take under a minute."
              : "Your browser hasn't offered one-tap install yet — use the steps below."}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-ink/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
              <Apple className="h-4 w-4" /> iPhone / iPad (Safari)
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
              <li>Open this page in <strong>Safari</strong>.</li>
              <li>Tap the <strong>Share</strong> button (the square with an arrow).</li>
              <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
              <li>Tap <strong>Add</strong>. Sophira now has its own icon, like any app.</li>
            </ol>
          </div>
          <div className="rounded-lg border border-ink/10 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
              <Smartphone className="h-4 w-4" /> Android (Chrome)
            </div>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
              <li>Open this page in <strong>Chrome</strong>.</li>
              <li>Tap the <strong>⋮ menu</strong> (top right).</li>
              <li>Tap <strong>Install app</strong> (or &quot;Add to Home screen&quot;).</li>
              <li>Confirm. Sophira now has its own icon, like any app.</li>
            </ol>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-ink-soft">
          This installs Sophira as a Progressive Web App — it gets its own icon and full-screen window and keeps you signed
          in, but it is not an App Store / Google Play download. App stores are not required to use Sophira.
        </p>
      </CardContent>
    </Card>
  );
}

export default function InstallPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold text-ink">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white">S</span>
          Sophira
        </Link>
        <Badge tone="accent">Private academic assistant</Badge>
      </div>
      <InstallCard />
      <p className="mt-6 text-center text-sm">
        <Link href="/dashboard" className="text-accent hover:underline">Back to Sophira</Link>
      </p>
    </div>
  );
}
