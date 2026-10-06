import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { Cpu, WifiOff, CloudOff, ShieldCheck } from "lucide-react";

// LOCAL-FIRST TESTING LANDING PAGE (docs/QUICK_START_LOCAL.md). Pure static
// content: it explains the local testing experience and links into the
// EXISTING offline/local-AI interface — it duplicates no engine code.
export default function LocalTestPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Test Sophira locally</h1>
      <p className="rounded-lg border border-warn/30 bg-warn/5 p-4 text-sm">
        <strong>Local testing mode.</strong> Your AI runs on this device. Cloud synchronization
        is not connected — nothing is pretending otherwise.
      </p>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="h-4 w-4" /> What this mode means</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-ink-soft">
          <p>1. Sophira is running on this device.</p>
          <p>2. No paid AI is being used — no OpenAI, no Gemini, no API key.</p>
          <p>3. You can download a local AI model (you choose which — never automatic).</p>
          <p>4. The model stays on this device. Your prompts are not sent to any server.</p>
          <p>5. After the model is downloaded, basic AI tasks run without internet.</p>
          <p>6. Cloud features are unavailable until Supabase is connected — accounts, invitations, and sync do not work in this mode.</p>
          <p>7. Online research and remote AI are unavailable in this mode.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><WifiOff className="h-4 w-4" /> One-time setup (honest)</CardTitle></CardHeader>
        <CardContent className="text-sm text-ink-soft">
          <p>
            One-time setup: Sophira needs an internet connection to download the AI engine and
            the model. After setup is complete, supported local AI can run without internet.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><CloudOff className="h-4 w-4" /> Not connected (by design)</CardTitle></CardHeader>
        <CardContent className="text-sm text-ink-soft">
          <p>
            Cloud synchronization, invitations, and remote AI show as not connected until a
            backend is configured. Local encrypted storage, model downloads, local inference,
            and deterministic offline math keep working.
          </p>
        </CardContent>
      </Card>
      <Link href="/offline" className="inline-block rounded-lg bg-accent px-6 py-3 font-medium text-white">
        Test Local AI
      </Link>
      <p className="flex items-center gap-2 text-xs text-ink-soft">
        <ShieldCheck className="h-4 w-4" /> Production deployments keep full authentication and
        invitation-only access. This mode is development-only and cannot activate in production.
      </p>
    </main>
  );
}
