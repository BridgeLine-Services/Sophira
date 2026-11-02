// CLIENT-SAFE history vocabulary and wording (Stage 4, 2026-11-02).
//
// WHY THIS FILE EXISTS: the timeline UI needs the event vocabulary and the
// plain-language descriptions, but `history.ts` touches the service-role Supabase
// client. Importing that module into a client component pulled
// SUPABASE_SERVICE_ROLE_KEY into a browser chunk - caught by the repo's secret
// scan. So the pure, side-effect-free half lives here, and `history.ts` re-exports
// it so every existing server import keeps working unchanged.
//
// Nothing here reads environment variables, opens a connection, or records an event.

export type HistoryProvider = "google" | "microsoft";

export const HISTORY_EVENT_TYPES = [
  "document_discovered", "baseline_captured", "document_read", "draft_prepared",
  "insertion_attempted", "insertion_confirmed", "document_created",
  "replacement_attempted", "replacement_confirmed",
  "external_change_observed", "conflict_detected",
  "restore_attempted", "restore_completed", "restore_refused",
  // Stage 4 (2026-11-02): a partial insertion that ended early, and the retained
  // copy of whatever was NOT written. Both describe real events: the stop is a
  // user/provider fact and the recovery copy is text Sophira actually stored.
  "insertion_stopped", "recovery_copy_created",
] as const;
export type HistoryEventType = (typeof HISTORY_EVENT_TYPES)[number];

export const HISTORY_ACTORS = ["user", "sophira", "external", "provider"] as const;
export type HistoryActor = (typeof HISTORY_ACTORS)[number];

export const HISTORY_PROVENANCE = [
  "sophira-generated", "sophira-inserted", "user-requested", "user-confirmed",
  "external-observed", "provider-reported", "unknown",
] as const;
export type HistoryProvenance = (typeof HISTORY_PROVENANCE)[number];

export const HISTORY_OUTCOMES = ["pending", "confirmed", "failed", "conflicted", "unavailable"] as const;
export type HistoryOutcome = (typeof HISTORY_OUTCOMES)[number];

export const HISTORY_DISCLAIMER =
  "Document history records changes Sophira performed and versions it was able to observe. Some changes may have happened outside Sophira. Version history and writing-analysis tools cannot reliably prove who physically typed or originally authored every passage.";
export function describeProvenance(p: HistoryProvenance): string {
  switch (p) {
    case "sophira-generated": return "Sophira produced this content.";
    case "sophira-inserted": return "Sophira inserted this into the document and the provider confirmed the write.";
    case "user-requested": return "You asked Sophira to perform this operation.";
    case "user-confirmed": return "You explicitly confirmed this operation.";
    case "external-observed": return "The document changed outside a confirmed Sophira write, or the origin could not be established.";
    case "provider-reported": return "The provider supplied this version metadata; it is not proof of who typed anything.";
    case "unknown": return "The available evidence is not sufficient to classify the origin.";
  }
}

/**
 * One event, rendered for a non-technical reader. `origin` and `confirmation`
 * are separate on purpose: "who asked for it" and "did the provider confirm it"
 * are different facts, and collapsing them is how fake provenance starts.
 */
export function describeHistoryEvent(e: {
  eventType: HistoryEventType;
  actor: HistoryActor;
  provenance: HistoryProvenance;
  outcome: HistoryOutcome;
  occurredAt?: string | null;
}): { what: string; origin: string; confirmation: string } {
  const what: Record<HistoryEventType, string> = {
    document_discovered: "A document was found in the connected account.",
    baseline_captured: "Sophira saved a copy of the document as it was before the change.",
    document_read: "The document was opened and its text read.",
    draft_prepared: "A draft was prepared from your Sophira work.",
    insertion_attempted: "Sophira asked the provider to insert content.",
    insertion_confirmed: "The provider confirmed content was inserted.",
    insertion_stopped: "The insertion ended before all of the text was written.",
    recovery_copy_created: "A recovery copy of the remaining text was saved.",
    document_created: "A new document was created in the connected account.",
    replacement_attempted: "Sophira asked the provider to replace a file.",
    replacement_confirmed: "The provider confirmed the file was replaced.",
    external_change_observed: "The document changed outside Sophira.",
    conflict_detected: "The document had changed since you reviewed it, so Sophira stopped.",
    restore_attempted: "A restore of an earlier version was requested.",
    restore_completed: "An earlier version was restored and confirmed.",
    restore_refused: "A restore was refused.",
  };
  const origin = e.actor === "user" ? "You asked for this."
    : e.actor === "sophira" ? "Sophira did this after you approved it."
      : e.actor === "external" ? "Something changed outside Sophira. Sophira cannot tell who did it."
        : "Reported by the provider as part of its own record.";
  const confirmation = e.outcome === "confirmed" ? "Confirmed by the provider."
    : e.outcome === "pending" ? "Not confirmed yet."
      : e.outcome === "conflicted" ? "Stopped: the document had changed."
        : e.outcome === "failed" ? "The operation reported a failure."
          : "The provider could not supply a confirmation.";
  return { what: what[e.eventType] ?? "An event was recorded.", origin, confirmation };
}
