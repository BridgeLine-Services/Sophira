"use client";

import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";

/**
 * SECURITY HISTORY, SEARCHABLE (2026-11-13).
 *
 * The role-change audit was readable only as the last few rows on the Members page, which is the
 * wrong shape for the question an owner actually asks: "did anything happen that I did not
 * expect?" It now has its own searchable list.
 *
 * Two rules the interface keeps:
 *   - a REFUSED change is shown, not hidden: "Sophira stopped this" is the entry an owner most
 *     needs to see;
 *   - searching filters what is already recorded. Nothing is re-read, re-sorted by guess or
 *     summarised by the client, so what you see is exactly what the server returned.
 */

export interface SecurityHistoryEntry {
  id: string;
  at: string;
  actorName: string;
  targetName: string;
  fromRole: string;
  toRole: string;
  success: boolean;
  reason: string | null;
}

export function SecurityHistory({
  entries,
  available,
}: {
  entries: SecurityHistoryEntry[];
  available: boolean;
}) {
  const [query, setQuery] = useState("");
  const [refusalsOnly, setRefusalsOnly] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return entries.filter((entry) => {
      if (refusalsOnly && entry.success) return false;
      if (!needle) return true;
      const haystack = [
        entry.actorName,
        entry.targetName,
        entry.fromRole,
        entry.toRole,
        entry.reason ?? "",
        entry.success ? "allowed changed" : "refused blocked stopped",
        formatWhen(entry.at),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [entries, query, refusalsOnly]);

  if (!available) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-ink-soft">
          This database cannot show a change history yet, so none is displayed. That is different
          from &quot;nothing has happened&quot;: Sophira is not going to claim a quiet history it
          cannot read.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="flex-1">
          <span className="sr-only">Search the change history</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by person, role or reason"
            className="w-full rounded-card border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-soft focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={refusalsOnly}
            onChange={(event) => setRefusalsOnly(event.target.checked)}
            className="h-4 w-4 rounded border-line"
          />
          Only refusals
        </label>
      </div>

      <p className="text-xs text-ink-soft" role="status">
        {visible.length === entries.length
          ? `${entries.length} ${entries.length === 1 ? "entry" : "entries"} recorded.`
          : `Showing ${visible.length} of ${entries.length} entries.`}
      </p>

      {entries.length === 0 ? (
        <EmptyState
          icon={<span aria-hidden className="text-lg">·</span>}
          title="No role changes recorded yet"
          description="When someone's role is changed, or Sophira refuses a change, it will appear here."
        />
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-4 text-sm text-ink-soft">
            Nothing matches that search. Clear the box to see all {entries.length} entries.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-line p-0">
            {visible.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:gap-4">
                <time className="shrink-0 text-xs text-ink-soft sm:w-40" dateTime={entry.at}>
                  {formatWhen(entry.at)}
                </time>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                    {entry.success ? "Role changed" : "Change refused"}
                    <Badge>{entry.success ? "allowed" : "refused"}</Badge>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-soft">
                    {entry.actorName} changed {entry.targetName} from {entry.fromRole} to {entry.toRole}.
                  </p>
                  {!entry.success && entry.reason && (
                    <p className="mt-1 text-xs text-ink-soft">Sophira refused it: {entry.reason}</p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  return date.toLocaleString();
}
