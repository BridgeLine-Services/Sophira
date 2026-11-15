import { Badge } from "@/components/ui";
import type { SourceSummary } from "@/lib/research/source-intelligence";

/**
 * WHAT KIND OF SOURCE THIS IS, in a student's words (directive Part 11).
 *
 * The rule this component exists for: a student must never have to know what a
 * "misinformation risk" or a "publication state" is. They see "News reporting",
 * "Opinion", "Satire", and - when it matters - the plain sentence "Not usable as
 * evidence" with the reason underneath.
 *
 * No hooks and no client directive: it renders identically on the server and in the
 * browser, so the same words appear in a rendered page test and on screen.
 */

function tone(summary: SourceSummary): "success" | "warn" | "danger" | "neutral" {
  if (!summary.usable) return "danger";
  if (summary.risk === "elevated" || summary.publicationState === "corrected" || summary.publicationState === "expression_of_concern") {
    return "warn";
  }
  return "neutral";
}

export function SourceTypeLabel({ summary }: { summary: SourceSummary }) {
  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone(summary)}>{summary.label}</Badge>
        {summary.role === "primary" && <Badge tone="neutral">First-hand account</Badge>}
        {summary.role === "secondary" && <Badge tone="neutral">Describes other work</Badge>}
        {summary.peerReview === "preprint" && <Badge tone="warn">Not yet reviewed</Badge>}
        {summary.publicationState === "retracted" && <Badge tone="danger">Retracted</Badge>}
        {!summary.usable && <Badge tone="danger">Not usable as evidence</Badge>}
      </div>
      <p className="mt-1 text-xs text-ink-soft">{summary.explanation}</p>
      {!summary.usable && summary.blockedReason && <p className="mt-1 text-xs text-ink-soft">{summary.blockedReason}</p>}
    </div>
  );
}
