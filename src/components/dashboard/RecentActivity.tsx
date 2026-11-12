"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui";
import { ACTIVITY_FILTERS, groupActivity, type ActivityCategory, type ActivityEvent } from "@/lib/activity/feed";
import { Activity, Sparkles } from "lucide-react";

/**
 * The Recent Activity feed: what HAPPENED, with Upcoming Work kept separate
 * for what needs to happen next. Filters + day grouping happen in the
 * browser so times and "Today" follow the reader's own clock.
 */
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function RecentActivity({ events }: { events: ActivityEvent[] }) {
  const [filter, setFilter] = useState<"all" | ActivityCategory>("all");
  const [expanded, setExpanded] = useState(false);

  const visible = useMemo(
    () => (filter === "all" ? events : events.filter((e) => e.category === filter)),
    [events, filter]
  );
  const shown = expanded ? visible : visible.slice(0, 8);
  const groups = useMemo(() => groupActivity(shown, new Date()), [shown]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Recent activity</h2>
        <div className="flex flex-wrap gap-1.5">
          {ACTIVITY_FILTERS.map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${filter === f.key ? "border-accent bg-accent-soft text-accent" : "border-line bg-card text-ink-soft hover:border-accent/40"}`}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {events.length === 0 ? (
        <Card>
          <CardContent className="flex items-start gap-3 p-4 text-sm text-ink-soft">
            <Activity className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <span>Nothing here yet. As you start assignments, save notes, and complete work, your accomplishments will appear here.</span>
          </CardContent>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-ink-soft">No {filter} activity yet. Try another filter.</CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {groups.map((g) => (
              <div key={g.key}>
                <p className="border-b border-line bg-card-elevated/60 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                  {g.label}
                </p>
                <div className="divide-y divide-line">
                  {g.events.map((e) => (
                    <Link key={e.id} href={e.href} className="flex items-start gap-3 px-4 py-3 transition hover:bg-accent-soft/40">
                      <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-ink">{e.title}</p>
                        {e.detail && <p className="truncate text-xs text-ink-soft">{e.detail}</p>}
                      </div>
                      <span className="shrink-0 text-xs text-ink-soft">{fmtTime(e.at)}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {visible.length > 8 && (
              <div className="border-t border-line p-3 text-center">
                <button type="button" onClick={() => setExpanded((v) => !v)} className="text-sm font-medium text-accent hover:underline">
                  {expanded ? "Show less" : `See all activity (${visible.length})`}
                </button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
