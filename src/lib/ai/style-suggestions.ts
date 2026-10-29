/**
 * Style-suggestion plumbing (2026-10-29).
 *
 * Bridges the pure analyser in writing-profile-learning.ts to the existing
 * proposal -> approval machinery (profile_update_proposals). Everything here is
 * pure so it can be tested without a database, a network, or an AI provider -
 * which is the point: style suggestions must work on the free tier with no model
 * configured, and must never mutate a profile on the user's behalf.
 */
import type { StyleSuggestion } from "./writing-profile-learning";

export interface ProposalRow {
  user_id: string;
  target_type: "writing";
  target_id: string;
  change_summary: string;
  proposed_changes: Record<string, unknown>;
  context: Record<string, unknown>;
  status: "pending";
}

const MAX_DESCRIPTION = 600;

/**
 * Turn an accepted suggestion into a PENDING proposal row.
 *
 * Column names follow the real `profile_update_proposals` schema
 * (0001_init.sql): change_summary / proposed_changes / context / status. An
 * earlier version of this file used a single `payload` key, which is not a
 * column - PostgREST would have rejected every insert. Fixed here, and the
 * exact keys are pinned by a test so it cannot drift again.
 */
export function proposalRowFor(userId: string, profileId: string, s: StyleSuggestion): ProposalRow {
  const description = s.description.slice(0, MAX_DESCRIPTION);
  return {
    user_id: userId,
    target_type: "writing",
    target_id: profileId,
    change_summary: `Style suggestion: ${s.category.replace(/_/g, " ")} (${s.scope})`,
    proposed_changes: {
      // The key is `guidance` because ProposalsPanel already applies writing
      // proposals as an ADDENDUM on top of approved guidance. Reusing it means
      // approvals work through the existing review UI with no new screen, and
      // each approval takes a version snapshot like every other profile change.
      guidance: description,
      suggestion_id: s.id,
      category: s.category,
      confidence: s.confidence,
      scope: s.scope,
      source: "writing-profile-learning",
    },
    // Kept in context, not proposed_changes: this is provenance, not a profile field.
    context: { requires_approval: true, origin: "writing-profile-learning" },
    status: "pending",
  };
}

/**
 * Validate the user's selection against what was actually offered. Unknown ids
 * are dropped rather than trusted: the client cannot approve a suggestion the
 * server never produced.
 */
export function pickAccepted(suggestions: StyleSuggestion[], ids: unknown): StyleSuggestion[] {
  if (!Array.isArray(ids)) return [];
  const wanted = new Set(ids.filter((v): v is string => typeof v === "string"));
  const picked = suggestions.filter((s) => wanted.has(s.id));
  // De-duplicate defensively; ids are unique today but this must not depend on it.
  const seen = new Set<string>();
  return picked.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}

/** Human-readable refusal when there is nothing to analyse yet. */
export function noSamplesMessage(): string {
  return "Add a few samples of your own writing first. Suggestions are based only on what you provide, so there is nothing to analyse yet.";
}

/** Keep the honest framing attached to every response. */
export function suggestionDisclaimer(): string {
  return "These are suggestions about your own writing. Nothing changes until you approve it. Sophira does not simulate typing, fabricate revision history, or claim that text was written by hand.";
}
