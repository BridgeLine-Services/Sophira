import Link from "next/link";
import { Badge, Card, CardContent } from "@/components/ui";
import {
  ALERT_SOURCE_LABEL,
  alertPage,
  type OwnerAlert,
  type OwnerAlerts as OwnerAlertsResult,
} from "@/lib/owner/alerts";

/**
 * EVERYTHING THAT NEEDS YOU (2026-11-16).
 *
 * The Owner's alerts, rendered. All judgement - severity, order, deduplication against the existing
 * action items, what could not be checked - lives in src/lib/owner/alerts.ts, where it is tested
 * without a browser. This file only draws it.
 *
 * It states an incomplete picture rather than an all-clear: an alert that could not be checked is
 * named above the list, never omitted.
 */

function Row({ alert }: { alert: OwnerAlert }) {
  return (
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{alert.title}</p>
        {alert.why ? <p className="mt-0.5 text-sm text-ink-soft">{alert.why}</p> : null}
        {alert.who ? <p className="mt-0.5 text-sm text-ink-soft">{alert.who}</p> : null}
        <p className="mt-1 meta text-ink-soft">
          {ALERT_SOURCE_LABEL[alert.source]}
          {alert.waitingFor ? ` · waiting ${alert.waitingFor}` : ""}
        </p>
      </div>
      {alert.href ? (
        <Link
          href={alert.href}
          className="shrink-0 text-sm font-medium text-accent underline-offset-4 hover:underline"
        >
          {alert.linkLabel ?? "Open"}
        </Link>
      ) : null}
    </li>
  );
}

export function OwnerAlerts({ result }: { result: OwnerAlertsResult }) {
  const { visible, hidden } = alertPage(result);
  const today = visible.filter((a) => a.severity === "today");
  const watch = visible.filter((a) => a.severity === "watch");

  return (
    <section aria-labelledby="owner-alerts-h">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="owner-alerts-h" className="meta-strong">Everything that needs you</h2>
        {result.counts.total !== null ? (
          <p className="meta text-ink-soft">
            {result.counts.today ?? 0} today · {result.counts.watch ?? 0} worth knowing
          </p>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-ink">{result.headline}</p>

          {result.unavailable.length > 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              {result.unavailable.map((u) => u.label).join(", ")} could not be checked just now, so something may be
              missing from this list. Nothing has been thrown away. Try again in a moment, and if it keeps happening,
              open System status.
            </p>
          ) : null}

          {visible.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              {result.unavailable.length > 0
                ? "No alert could be confirmed."
                : "Nothing here. This list fills as soon as something genuinely needs you."}
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {[
                { label: "Today" as const, items: today },
                { label: "Worth knowing" as const, items: watch },
              ]
                .filter((group) => group.items.length > 0)
                .map((group) => (
                  <div key={group.label}>
                    <p className="flex items-center gap-2 meta-strong">
                      <Badge tone={group.label === "Today" ? "accent" : "neutral"}>{group.label}</Badge>
                      <span className="text-ink-soft">
                        {group.items.length} item{group.items.length === 1 ? "" : "s"}
                      </span>
                    </p>
                    <ul className="mt-1 divide-y divide-line">
                      {group.items.map((alert) => (
                        <Row key={alert.id} alert={alert} />
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}

          {hidden > 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              {hidden} more, each on the page it belongs to. The lists above this panel hold the rest.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
