import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { loadOwnerRoster } from "@/lib/owner/roster";
import { providerDiagnostics, readAiEnv } from "@/lib/ai/provider";
import { providerSetupStatus } from "@/lib/integrations/setup-status";
import { canvasConfigured } from "@/lib/integrations/canvas";
import { emailProviderConfigured } from "@/lib/invitations/delivery";
import { countAiFailures, loadAiUsage } from "@/lib/owner/ai-usage";
import {
  buildFeatureCatalog,
  countByState,
  featuresNeedingOwner,
  formatVerifiedAt,
  stateExplanation,
  stateLabel,
  type FeatureEntry,
  type FeatureState,
} from "@/lib/owner/feature-catalog";

export const dynamic = "force-dynamic";

const STATE_ORDER: FeatureState[] = ["working", "available", "not-configured", "problems", "unavailable", "not-implemented"];

/**
 * FEATURE HEALTH (2026-11-13).
 *
 * One page that answers "which parts of Sophira actually work?" for every capability in the
 * catalogue, without asking the owner to read a log. Every state is derived from a real,
 * checkable input, and where Sophira cannot know it says "not verified here" instead of borrowing
 * credit from its test suite.
 *
 * The page never infers health from the navigation: a route existing is not a feature working.
 */
export default async function OwnerFeaturesPage() {
  const { supabase } = await requireOwnerPage();
  const roster = await loadOwnerRoster(supabase);
  const env = readAiEnv();
  const diag = providerDiagnostics(env);
  const setup = providerSetupStatus();

  // A RECORDED failure outranks a configured provider, so the usage record is read here too. Null
  // (unreadable) is passed through unchanged and produces no failure claim at all.
  const aiUsage = await loadAiUsage({ windowDays: 7, maxRows: 2000 });
  const recentAiFailures = countAiFailures(aiUsage.rows);

  const databaseReachable = roster.statsError ? roster.members.length > 0 : true;
  const entries = buildFeatureCatalog({
    aiConfigured: diag.candidates.length > 0,
    aiActive: Boolean(diag.activeProvider),
    localInferenceConfigured: Boolean(env.LOCAL_LLM_BASE_URL),
    databaseReachable,
    searchConfigured: setup.search,
    googleConfigured: setup.google,
    microsoftConfigured: setup.microsoft,
    canvasConfigured: canvasConfigured(),
    emailConfigured: emailProviderConfigured(),
    recentAiFailures,
  });

  const counts = countByState(entries);
  const needingOwner = featuresNeedingOwner(entries);

  return (
    <AppShell title="Feature health" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">What works, and what is waiting on you</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              {entries.length} capabilities, each checked against something real: a connection that
              exists, a service that is running, or a database that answered. &quot;Available&quot; means it is
              ready, not that Sophira sent a test just now - that difference is written on every row.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">Back to overview</Link>
        </div>

        <Card>
          <CardContent className="flex flex-wrap gap-2 p-3 text-sm">
            {STATE_ORDER.filter((state) => counts[state]).map((state) => (
              <span key={state} className="flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1">
                <StateDot state={state} />
                <span className="text-ink">{stateLabel(state)}</span>
                <span className="font-semibold text-ink">{counts[state]}</span>
              </span>
            ))}
          </CardContent>
        </Card>

        {needingOwner.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="font-medium text-ink">Waiting on you</p>
              <ul className="mt-2 space-y-2 text-sm text-ink-soft">
                {needingOwner.map((entry) => (
                  <li key={entry.key} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-ink">{entry.name}</span>
                    <span>- {entry.ownerAction}</span>
                    {entry.href && (
                      <Link href={entry.href} className="text-accent hover:underline">Open &rarr;</Link>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {(["Study and writing", "Workspace", "Documents", "Connections"] as const).map((group) => {
          const groupEntries = entries.filter((e) => e.group === group);
          if (groupEntries.length === 0) return null;
          return (
            <section key={group} aria-labelledby={`feature-group-${group.replace(/\s+/g, "-").toLowerCase()}`}>
              <h3
                id={`feature-group-${group.replace(/\s+/g, "-").toLowerCase()}`}
                className="mb-2 meta-strong"
              >
                {group}
              </h3>
              <div className="grid gap-2">
                {groupEntries.map((entry) => (
                  <FeatureCard key={entry.key} entry={entry} />
                ))}
              </div>
            </section>
          );
        })}

        <Card>
          <CardContent className="space-y-2 p-4 text-xs text-ink-soft">
            <p className="text-sm font-medium text-ink">How to read these words</p>
            {STATE_ORDER.map((state) => (
              <p key={state}>
                <span className="font-medium text-ink">{stateLabel(state)}:</span> {stateExplanation(state)}
              </p>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function StateDot({ state }: { state: FeatureState }) {
  const colour: Record<FeatureState, string> = {
    working: "bg-emerald-500",
    available: "bg-sky-500",
    "not-configured": "bg-line",
    problems: "bg-red-500",
    unavailable: "bg-amber-500",
    "not-implemented": "bg-ink-soft/40",
  };
  return <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${colour[state]}`} />;
}

function FeatureCard({ entry }: { entry: FeatureEntry }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-medium text-ink">
            <StateDot state={entry.state} />
            {entry.name}
          </p>
          <Badge>{stateLabel(entry.state)}</Badge>
        </div>
        <p className="mt-1 text-sm text-ink-soft">{entry.what}</p>
        <p className="mt-2 text-sm text-ink">{entry.detail}</p>

        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-ink-soft sm:grid-cols-2">
          <div className="flex gap-1">
            <dt className="font-medium">Members affected:</dt>
            <dd>{entry.membersAffected ? "yes, they would notice" : "no, this is administrative or optional"}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium">Last live check:</dt>
            <dd>{formatVerifiedAt(entry.facts.lastVerified)}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium">Checked by Sophira&apos;s tests:</dt>
            <dd>{entry.facts.verifiedByTests ? "yes" : "no"}</dd>
          </div>
          <div className="flex gap-1">
            <dt className="font-medium">Last failure:</dt>
            <dd>{entry.facts.lastFailure ?? "None recorded"}</dd>
          </div>
        </dl>

        {entry.ownerAction && (
          <p className="mt-2 text-sm text-ink">
            <span className="font-medium">What to do: </span>
            {entry.ownerAction}
          </p>
        )}
        {entry.href && (
          <Link href={entry.href} className="mt-2 inline-block text-sm text-accent hover:underline">
            {entry.state === "not-configured" ? "Set it up" : "Open"} &rarr;
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
