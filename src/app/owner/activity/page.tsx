import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireOwnerPage } from "@/lib/owner/page-context";
import { loadOwnerRoster } from "@/lib/owner/roster";
import { buildActivity } from "@/lib/owner-activity";

export const dynamic = "force-dynamic";

/**
 * Recent Activity (2026-11-03, phase 1). Every entry comes from a stored timestamp through
 * the existing buildActivity module - nothing is invented, and no member academic work is
 * read. Newest first, in plain language.
 */
export default async function OwnerActivityPage() {
  const { supabase } = await requireOwnerPage();
  const { members, invitations, statsError } = await loadOwnerRoster(supabase);
  const items = buildActivity({ members, invitations });

  return (
    <AppShell title="Recent Activity" variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">What has happened in your network</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Joins, acceptances, invitations and revocations, newest first. Each line comes from a
              real date already recorded in Sophira. You will never see a member&apos;s essays,
              notes or other coursework here.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">Back to overview</Link>
        </div>

        {statsError && (
          <div role="status" className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm text-ink">{statsError}</div>
        )}

        {items.length === 0 ? (
          <EmptyState
            icon={<span aria-hidden className="text-lg">·</span>}
            title="Nothing has happened yet"
            description="When someone accepts an invitation or access changes, it will appear here."
          />
        ) : (
          <Card>
            <CardContent className="divide-y divide-line p-0">
              {items.map((item) => (
                <div key={item.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:gap-4">
                  <time className="shrink-0 text-xs text-ink-soft sm:w-40" dateTime={item.at}>
                    {new Date(item.at).toLocaleString()}
                  </time>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{item.title}</p>
                    <p className="text-xs text-ink-soft">{item.detail}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
