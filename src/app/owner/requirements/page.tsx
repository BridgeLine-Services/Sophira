import Link from "next/link";
import { AppShell } from "@/components/app/AppShell";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { requireOwnerPage } from "@/lib/owner/page-context";
import {
  CHANGE_CATEGORY_LABELS,
  PRODUCT_REQUIREMENTS,
  REQUIREMENT_STATUSES,
  isFinished,
  ownerBlockedRequirements,
  requirementsByStatus,
  summariseRequirements,
  type ProductRequirement,
  type RequirementStatus,
} from "@/lib/governance/product-spec";
import { changeSummary, recentChanges, silentCategories } from "@/lib/owner/change-log";

export const dynamic = "force-dynamic";

/**
 * REQUIREMENTS AND CHANGES (2026-11-15).
 *
 * The Owner asked for one place that answers "what did I ask for, what is actually done, what is
 * waiting on me, and what changed?" without reading a codebase. This page renders the same data
 * the test suite pins (`src/lib/governance/product-spec.ts`) and the change record
 * (`src/lib/owner/change-log.ts`), so what the Owner reads and what the suite checks cannot drift.
 *
 * Deliberate honesty rules on this page:
 *  - a status is one of the agreed words, never a softer synonym invented here;
 *  - every requirement shows where it can be checked, and what is still missing;
 *  - "nothing recorded" in the change record is shown as nothing recorded, never as "no change".
 */
export default async function OwnerRequirementsPage() {
  await requireOwnerPage();

  const summary = summariseRequirements();
  const blocked = ownerBlockedRequirements();
  const changes = recentChanges(12);
  const changeCounts = changeSummary();
  const silent = silentCategories();

  const groups = Array.from(new Set(PRODUCT_REQUIREMENTS.map((r) => r.group)));

  return (
    <AppShell
      subtitle="What you asked for, what is done, and what changed."
      title="Requirements and changes"
      variant="owner">
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Your requirements, in your own words</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              {summary.total} requirements are recorded. {summary.finished} are finished,{" "}
              {summary.outstanding} still have work against them, and {summary.blocked} cannot move
              until something outside Sophira is supplied. Each row says where it can be checked and,
              where it applies, what is still missing.
            </p>
          </div>
          <Link href="/owner" className="text-sm font-medium text-accent hover:underline">
            Back to overview
          </Link>
        </div>

        {blocked.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="font-medium text-ink">Waiting on you</p>
              <ul className="mt-2 space-y-2 text-sm text-ink-soft">
                {blocked.map((req) => (
                  <li key={req.id} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium text-ink">
                      {req.id}: {req.title}
                    </span>
                    <span>- {req.ownerAction}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="flex flex-wrap gap-2 p-3 text-sm">
            {REQUIREMENT_STATUSES.map((status) => {
              const count = requirementsByStatus(status).length;
              if (count === 0) return null;
              return (
                <span
                  key={status}
                  className="flex items-center gap-1.5 rounded-full border border-line bg-card px-2.5 py-1">
                  <StatusDot status={status} />
                  <span className="text-ink">{status}</span>
                  <span className="font-semibold text-ink">{count}</span>
                </span>
              );
            })}
          </CardContent>
        </Card>

        {groups.map((group) => {
          const items = PRODUCT_REQUIREMENTS.filter((r) => r.group === group);
          if (items.length === 0) return null;
          const anchor = group.replace(/\s+/g, "-").toLowerCase();
          return (
            <section key={group} aria-labelledby={`req-group-${anchor}`}>
              <h3 id={`req-group-${anchor}`} className="mb-2 meta-strong">
                {group}
              </h3>
              <div className="grid gap-2">
                {items.map((req) => (
                  <RequirementCard key={req.id} req={req} />
                ))}
              </div>
            </section>
          );
        })}

        <section aria-labelledby="req-changes">
          <h3 id="req-changes" className="mb-2 meta-strong">
            What changed
          </h3>
          <Card>
            <CardContent className="space-y-3 p-4">
              <p className="text-sm text-ink-soft">
                {changeCounts.total} changes are recorded across {changeCounts.categories} kinds.
                {silent.length > 0
                  ? ` Nothing is recorded yet for: ${silent.map((c) => CHANGE_CATEGORY_LABELS[c]).join(", ")}.`
                  : " Every kind of change has at least one recorded entry."}
              </p>
              <ul className="space-y-3">
                {changes.map((entry) => (
                  <li
                    key={`${entry.date}-${entry.category}-${entry.title}`}
                    className="border-t border-line pt-3 first:border-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge>{CHANGE_CATEGORY_LABELS[entry.category]}</Badge>
                      <span className="text-xs text-ink-soft">{entry.date}</span>
                    </div>
                    <p className="mt-1 font-medium text-ink">{entry.title}</p>
                    <p className="mt-1 text-sm text-ink-soft">{entry.detail}</p>
                    <p className="mt-1 text-xs text-ink-soft">
                      <span className="font-medium">Decided by:</span> {entry.decidedBy}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">
                      <span className="font-medium">Where to check it:</span> {entry.evidence.join(" · ")}
                    </p>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardContent className="space-y-2 p-4 text-xs text-ink-soft">
            <p className="text-sm font-medium text-ink">How to read the words above</p>
            {REQUIREMENT_STATUSES.map((status) => (
              <p key={status}>
                <span className="font-medium text-ink">{status}:</span> {STATUS_MEANING[status]}
              </p>
            ))}
            <p className="pt-2">
              This page reads the same record Sophira&apos;s own checks read. If a line here were
              untrue, the checks would fail before the page could claim it.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

const STATUS_MEANING: Record<RequirementStatus, string> = {
  "IMPLEMENTED AND TESTED": "The behaviour exists and Sophira's own checks prove it.",
  "IMPLEMENTED, LIVE VERIFICATION REQUIRED":
    "The behaviour exists and is checked offline, but nobody has yet watched it work on the live service. It is not counted as proved until someone does.",
  "PARTIALLY IMPLEMENTED": "Part of it is real; the rest is named on the row rather than left to guess.",
  BLOCKED: "Work cannot continue until something outside Sophira is supplied.",
  "NOT STARTED": "No work has begun.",
  "EXISTING FUNCTIONALITY PRESERVED": "It worked before and still works; nothing about it was changed or weakened.",
  "AWAITING OWNER APPROVAL": "Sophira is waiting for you to say yes or no.",
  DEPRECATED: "Kept on record, no longer part of the product.",
};

function StatusDot({ status }: { status: RequirementStatus }) {
  const colour: Record<RequirementStatus, string> = {
    "IMPLEMENTED AND TESTED": "bg-success",
    "IMPLEMENTED, LIVE VERIFICATION REQUIRED": "bg-accent-soft0",
    "PARTIALLY IMPLEMENTED": "bg-warn",
    BLOCKED: "bg-danger",
    "NOT STARTED": "bg-line",
    "EXISTING FUNCTIONALITY PRESERVED": "bg-success",
    "AWAITING OWNER APPROVAL": "bg-warn",
    DEPRECATED: "bg-ink-soft/40",
  };
  return <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${colour[status]}`} />;
}

function RequirementCard({ req }: { req: ProductRequirement }) {
  const finished = isFinished(req);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 font-medium text-ink">
            <StatusDot status={req.status} />
            {req.id}: {req.title}
          </p>
          <Badge>{req.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-ink-soft">{req.statement}</p>

        <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-ink-soft">
          <div>
            <dt className="inline font-medium">Where it can be checked: </dt>
            <dd className="inline">{req.evidence.join(" · ")}</dd>
          </div>
          <div>
            <dt className="inline font-medium">What is still missing: </dt>
            <dd className="inline">{req.remaining ?? (finished ? "Nothing." : "Not recorded.")}</dd>
          </div>
          {req.ownerAction && (
            <div>
              <dt className="inline font-medium">What you need to do: </dt>
              <dd className="inline">{req.ownerAction}</dd>
            </div>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
