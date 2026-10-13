import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/guard";
import { IntegrationsPanel } from "@/components/app/IntegrationsPanel";
import { AppShell } from "@/components/app/AppShell";

export const dynamic = "force-dynamic";

/**
 * SETTINGS -> INTEGRATIONS (2026-10-11): one page for the Microsoft Word and
 * Google Docs connections. Every user manages ONLY their own connections
 * (tokens are stored per user and never cross accounts). Statuses come from
 * the real provider verification routes, never from a configured variable.
 */
export default async function IntegrationsPage() {
  const supabase = createClient();
  const guard = await requireUser(supabase);
  if (!guard.ok) return guard.response;
  return (
    <AppShell title="Integrations" backHref="/settings">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-ink-soft">
          Connect a Microsoft or Google account to save documents directly into it. Your downloads (DOCX, PDF, PPTX) always work without a connection.
        </p>
        <IntegrationsPanel />
        <p className="mt-6 text-xs text-ink-soft">
          Setup guide for the owner: <a className="underline" href="https://github.com/BridgeLine-Services/Sophira/blob/master/docs/WORD_GOOGLE_DOCS_SETUP.md">docs/WORD_GOOGLE_DOCS_SETUP.md</a>.
          Tokens live only on Sophira&apos;s server, scoped to your account, and are removed the moment you disconnect.
        </p>
      </div>
    </AppShell>
  );
}
