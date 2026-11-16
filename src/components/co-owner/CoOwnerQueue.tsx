import Link from "next/link";
import { Badge, Card, CardContent } from "@/components/ui";
import {
  QUEUE_SOURCE_LABEL,
  queueGroups,
  queuePage,
  type QueueItem,
  type QueueResult,
  type QueueUrgency,
} from "@/lib/co-owner/queue";

/**
 * WORK WAITING FOR YOU (2026-11-15).
 *
 * The Co-Owner's queue, rendered. It is deliberately dumb: every decision - what deserves today,
 * what order, what the sentence at the top says, what could not be read - was made in
 * src/lib/co-owner/queue.ts, where it is tested without a browser.
 *
 * Two things this component will not do:
 *   - it will not draw an empty list when a source failed. A failed read is stated above the
 *     list, in the same sentence the Co-Owner reads first.
 *   - it will not offer a control it cannot honour. Each item links to the screen where the
 *     record actually lives, because that record's own status is the single source of truth.
 */

const URGENCY_TONE: Record<QueueUrgency, "accent" | "neutral"> = {
  today: "accent",
  "this-week": "neutral",
  "when-you-can": "neutral",
};

function Row({ item }: { item: QueueItem }) {
  return (
    <li className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{item.title}</p>
        <p className="mt-0.5 text-sm text-ink-soft">{item.detail}</p>
        <p className="mt-1 meta text-ink-soft">
          {QUEUE_SOURCE_LABEL[item.source]} · waiting {item.waitingFor}
        </p>
      </div>
      <Link
        href={item.href}
        className="shrink-0 text-sm font-medium text-accent underline-offset-4 hover:underline"
      >
        {item.action}
      </Link>
    </li>
  );
}

export function CoOwnerQueue({ result }: { result: QueueResult }) {
  const { visible, hidden } = queuePage(result);
  const groups = queueGroups(visible);

  return (
    <section aria-labelledby="co-queue-h">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="co-queue-h" className="meta-strong">Work waiting for you</h2>
        {result.counts.total !== null ? (
          <p className="meta text-ink-soft">
            {result.counts.today ?? 0} today · {result.counts.thisWeek ?? 0} this week · {result.counts.whenYouCan ?? 0} when you can
          </p>
        ) : null}
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-ink" data-testid="co-queue-headline">
            {result.headline}
          </p>

          {result.unavailable.length > 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              Sophira could not read {result.unavailable.map((u) => u.label.toLowerCase()).join(", ")} just now, so
              the list below may be missing something. Nothing has been deleted: try again in a moment, and tell
              the Owner if it keeps happening.
            </p>
          ) : null}

          {groups.length === 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              {result.unavailable.length > 0
                ? "No item was confirmed as waiting."
                : "There is nothing to show here. Requests, invitations and reports appear as soon as one arrives."}
            </p>
          ) : (
            <div className="mt-3 space-y-4">
              {groups.map((group) => (
                <div key={group.urgency}>
                  <p className="flex items-center gap-2 meta-strong">
                    <Badge tone={URGENCY_TONE[group.urgency]}>{group.label}</Badge>
                    <span className="text-ink-soft">
                      {group.items.length} item{group.items.length === 1 ? "" : "s"}
                    </span>
                  </p>
                  <ul className="mt-1 divide-y divide-line">
                    {group.items.map((item) => (
                      <Row key={item.id} item={item} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {hidden > 0 ? (
            <p className="mt-3 text-sm text-ink-soft">
              {hidden} more not shown here. The lists below hold every one of them.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
