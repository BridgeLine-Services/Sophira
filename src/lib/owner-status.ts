/**
 * OWNER SYSTEM STATUS (2026-11-03).
 *
 * A plain-language view of what is working right now. Every row is derived from a real
 * configuration or request outcome - nothing is estimated, and "not set up" is never
 * dressed up as "working". Optional services that are off do not make the system unhealthy.
 */
import type { FeatureState } from "./owner/feature-catalog";

export type StatusState = "ready" | "optional_off" | "attention";

export interface StatusInput {
  aiReady: boolean;
  microsoft: boolean;
  google: boolean;
  search: boolean;
  membersLoaded: boolean;
  /** Absent when the caller has no delivery-layer fact to report. Never guessed. */
  email?: boolean;
}

export interface StatusRow {
  key: string;
  label: string;
  state: StatusState;
  detail: string;
  /**
   * The SAME vocabulary Feature Health uses (2026-11-13, Part 13). `state` stays for the
   * health arithmetic this page and the dashboard already do - "not set up" must never make
   * the system unhealthy - while `stage` is what the owner actually reads, in words that are
   * identical on both pages. Never inferred: a configured extra is "available", not "working",
   * because nothing on this page sent it a live request.
   */
  stage: FeatureState;
}

export function buildStatusRows(input: StatusInput): StatusRow[] {
  return [
    {
      key: "members",
      label: "Member records",
      state: input.membersLoaded ? "ready" : "attention",
      stage: input.membersLoaded ? "working" : "problems",
      detail: input.membersLoaded
        ? "Everyone's account and access status loaded correctly."
        : "The member list could not load. Invitations and access changes still work, but check the database connection.",
    },
    {
      key: "ai",
      label: "AI service",
      state: input.aiReady ? "ready" : "attention",
      // A provider being configured is not the same as one answering, so a ready AI service
      // is "available" until a live request proves otherwise.
      stage: input.aiReady ? "available" : "unavailable",
      detail: input.aiReady
        ? "An AI provider is configured and ready."
        : "No AI provider is configured yet, so writing and research help is unavailable until one is added.",
    },
    {
      key: "microsoft",
      label: "Microsoft connection",
      state: input.microsoft ? "ready" : "optional_off",
      stage: input.microsoft ? "available" : "not-configured",
      detail: input.microsoft ? "Members can connect their Microsoft account." : "Not set up. Members simply won't see this option.",
    },
    {
      key: "google",
      label: "Google connection",
      state: input.google ? "ready" : "optional_off",
      stage: input.google ? "available" : "not-configured",
      detail: input.google ? "Members can connect their Google account." : "Not set up. Members simply won't see this option.",
    },
    // 2026-11-13 (Part 13): invitation email was the one capability the owner could not
    // see the state of anywhere. It is an optional extra - invitations still work by
    // sharing the link - so "not set up" never makes the system unhealthy.
    ...(input.email === undefined ? [] : [{
      key: "email",
      label: "Invitation email",
      state: (input.email ? "ready" : "optional_off") as StatusState,
      stage: (input.email ? "available" : "not-configured") as FeatureState,
      detail: input.email
        ? "Invitations can be emailed to new members. You can still share the link yourself."
        : "Not set up. Invitations still work: copy the invitation link and send it yourself.",
    }]),
    {
      key: "search",
      label: "Web search for research",
      state: input.search ? "ready" : "optional_off",
      stage: input.search ? "available" : "not-configured",
      detail: input.search ? "Research can search the web for sources." : "Not set up. Research still works with sources you provide.",
    },
  ];
}

/** True when every required service is working; optional extras never block this. */
export function statusIsHealthy(rows: StatusRow[]): boolean {
  return rows.every((r) => r.state !== "attention");
}
