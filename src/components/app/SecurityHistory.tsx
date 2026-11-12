import Link from "next/link";
import { Card, CardContent } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Badge } from "@/components/ui/Badge";
import {
  auditHref,
  describeAction,
  describeAuditEntry,
  hasFilters,
  RECORDED_ACTIONS,
  type AuditEntry,
  type AuditFilters,
  type AuditQueryResult,
} from "@/lib/owner/audit-page";

/**
 * SECURITY HISTORY, SEARCHABLE AND PAGED (2026-11-13; server-side filters 2026-11-11).
 *
 * The browser no longer receives the whole history and filters it. It asks for one page, and the
 * database applies the date range, the kind of event, the administrator, the member and the
 * outcome. That is both less data on the wire and a search that reaches further back than the
 * first screenful.
 *
 * Two rules the interface keeps:
 *   - a REFUSED change is shown, not hidden: "Sophira stopped this" is the entry an owner most
 *     needs to see;
 *   - an empty result is described as "nothing matched", never as "nothing happened".
 *
 * The filters are a plain form, so the page works without JavaScript and the back button behaves.
 */

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  return date.toLocaleString();
}

function Entry({ entry }: { entry: AuditEntry }) {
  return (
    <div className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:gap-4">
      <time className="shrink-0 text-xs text-ink-soft sm:w-40" dateTime={entry.at}>
        {formatWhen(entry.at)}
      </time>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
          {describeAction(entry.action)}
          <Badge>{entry.success ? "allowed" : "refused"}</Badge>
        </p>
        <p className="mt-0.5 text-sm text-ink-soft">{describeAuditEntry(entry)}</p>
      </div>
    </div>
  );
}

export function SecurityHistory({
  result,
  filters,
  people,
}: {
  result: AuditQueryResult;
  filters: AuditFilters;
  people: Array<{ id: string; name: string }>;
}) {
  if (!result.available) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-ink-soft">
          This database cannot show a change history yet, so none is displayed. That is different
          from &quot;nothing has happened&quot;: Sophira is not going to claim a quiet history it
          cannot read. Press <span className="font-medium text-ink">Update database</span> on the
          database page to add it.
        </CardContent>
      </Card>
    );
  }

  const filtered = hasFilters(filters);

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4">
          <form method="get" action="/owner/security" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="text-xs text-ink-soft">
              Search by person
              <input
                type="search"
                name="q"
                defaultValue={filters.search}
                placeholder="Name or email"
                className="mt-0.5 w-full rounded-card border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-soft"
              />
            </label>

            <label className="text-xs text-ink-soft">
              Kind of event
              <select
                name="action"
                defaultValue={filters.action ?? ""}
                className="mt-0.5 w-full rounded-card border border-line bg-card px-3 py-2 text-sm text-ink"
              >
                <option value="">Every recorded event</option>
                {RECORDED_ACTIONS.map((action) => (
                  <option key={action.value} value={action.value}>{action.label}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-ink-soft">
              Outcome
              <select
                name="outcome"
                defaultValue={filters.outcome ?? ""}
                className="mt-0.5 w-full rounded-card border border-line bg-card px-3 py-2 text-sm text-ink"
              >
                <option value="">Allowed and refused</option>
                <option value="allowed">Allowed only</option>
                <option value="refused">Refused only</option>
              </select>
            </label>

            <label className="text-xs text-ink-soft">
              Administrator
              <select
                name="actor"
                defaultValue={filters.actorId ?? ""}
                className="mt-0.5 w-full rounded-card border border-line bg-card px-3 py-2 text-sm text-ink"
              >
                <option value="">Anyone</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>

            <label className="text-xs text-ink-soft">
              Member affected
              <select
                name="target"
                defaultValue={filters.targetId ?? ""}
                className="mt-0.5 w-full rounded-card border border-line bg-card px-3 py-2 text-sm text-ink"
              >
                <option value="">Anyone</option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>{person.name}</option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-ink-soft">
                From
                <input
                  type="date"
                  name="from"
                  defaultValue={filters.from ?? ""}
                  className="mt-0.5 w-full rounded-card border border-line bg-card px-3 py-2 text-sm text-ink"
                />
              </label>
              <label className="text-xs text-ink-soft">
                To
                <input
                  type="date"
                  name="to"
                  defaultValue={filters.to ?? ""}
                  className="mt-0.5 w-full rounded-card border border-line bg-card px-3 py-2 text-sm text-ink"
                />
              </label>
            </div>

            <div className="flex items-end gap-2 sm:col-span-2 xl:col-span-3">
              <button
                type="submit"
                className="rounded-card border border-line bg-card px-3 py-2 text-sm font-medium text-ink hover:bg-accent/5"
              >
                Show matching entries
              </button>
              {filtered && (
                <Link href="/owner/security" className="px-2 py-2 text-sm text-accent hover:underline">
                  Clear the filters
                </Link>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <p className="text-xs text-ink-soft" role="status">
        {result.total === 0
          ? filtered
            ? "No recorded entry matches those filters."
            : "No entry is recorded yet."
          : `${result.total.toLocaleString("en-US")} ${result.total === 1 ? "entry matches" : "entries match"}. Showing page ${result.page} of ${result.pageCount}.`}
      </p>

      {result.error && (
        <Card>
          <CardContent className="p-4 text-sm text-ink-soft">{result.error}</CardContent>
        </Card>
      )}

      {result.entries.length === 0 ? (
        filtered ? (
          <Card>
            <CardContent className="p-4 text-sm text-ink-soft">
              Nothing matches those filters. That is not a statement that nothing happened: widen the
              dates or clear the filters to see the whole record.
            </CardContent>
          </Card>
        ) : (
          <EmptyState
            icon={<span aria-hidden className="text-lg">·</span>}
            title="Nothing recorded yet"
            description="When someone's access, role or an invitation changes - or Sophira refuses a change - it will appear here."
          />
        )
      ) : (
        <Card>
          <CardContent className="divide-y divide-line p-0">
            {result.entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </CardContent>
        </Card>
      )}

      {result.pageCount > 1 && (
        <nav aria-label="Security history pages" className="flex flex-wrap items-center gap-2">
          {result.page > 1 && (
            <Link
              href={auditHref(filters, { page: result.page - 1 })}
              className="rounded-card border border-line bg-card px-3 py-1.5 text-sm text-ink hover:bg-accent/5"
            >
              Previous page
            </Link>
          )}
          <span className="text-xs text-ink-soft">
            Page {result.page} of {result.pageCount}
          </span>
          {result.page < result.pageCount && (
            <Link
              href={auditHref(filters, { page: result.page + 1 })}
              className="rounded-card border border-line bg-card px-3 py-1.5 text-sm text-ink hover:bg-accent/5"
            >
              Next page
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
