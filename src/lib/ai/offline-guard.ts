/**
 * Offline AI routing guard (2026-10-06).
 *
 * WHEN THE USER IS OFFLINE, AI ROUTING MUST NEVER ATTEMPT:
 *   fetch() to any AI endpoint · Gemini · OpenAI · remote search ·
 *   remote source verification
 * — unless the user reconnects and explicitly leaves offline mode.
 *
 * This module is the single client-side enforcement point: every client AI
 * call goes through `guardedAiFetch()`, which REFUSES (throws, no network
 * touched) whenever the browser reports offline or the user has chosen
 * offline mode, and tells the caller to use the local engine instead.
 * The decision function itself is pure and unit-tested; the browser facts
 * (navigator.onLine) are injected so tests can simulate offline.
 */

export interface AiRouteFacts {
  navigatorOnLine: boolean;
  /** explicit user choice (e.g. an offline-mode toggle). null = no choice made */
  userOfflineChoice: boolean | null;
}

export interface AiRouteDecision {
  route: "local" | "remote";
  reason: string;
}

export class OfflineAiBlockedError extends Error {
  readonly routeDecision: AiRouteDecision;
  constructor(decision: AiRouteDecision) {
    super(decision.reason);
    this.name = "OfflineAiBlockedError";
    this.routeDecision = decision;
  }
}

/**
 * Pure routing decision (tested). OFFLINE FACTS WIN:
 *  - navigator offline → LOCAL, no remote attempt is ever made
 *  - the user chose offline mode → LOCAL even if the network is back,
 *    until they explicitly leave offline mode (userOfflineChoice=false)
 *  - otherwise → REMOTE (the server's free-first provider policy applies)
 */
export function decideAiRoute(facts: AiRouteFacts): AiRouteDecision {
  if (facts.navigatorOnLine === false) {
    return {
      route: "local",
      reason:
        "The device is offline — no remote AI, search, or source-verification request was attempted. Use the local model (Offline page).",
    };
  }
  if (facts.userOfflineChoice === true) {
    return {
      route: "local",
      reason:
        "Offline mode is on — no remote AI request was attempted. Leave offline mode to use the online free-tier path again.",
    };
  }
  return { route: "remote", reason: "online" };
}

/** Live facts from the browser (injected for tests). */
function liveFacts(userOfflineChoice: boolean | null): AiRouteFacts {
  const persisted =
    userOfflineChoice === null || userOfflineChoice === undefined ? getOfflineModeChoice() : userOfflineChoice;
  return {
    navigatorOnLine: typeof navigator === "undefined" ? true : navigator.onLine,
    userOfflineChoice: persisted,
  };
}

/**
 * Client-side AI fetch that CANNOT attempt a remote call while offline.
 * Throws OfflineAiBlockedError (touching no network at all) when the
 * decision is local; the caller should route to the offline engine.
 */
export async function guardedAiFetch(
  input: string,
  init?: RequestInit,
  opts?: { userOfflineChoice?: boolean | null }
): Promise<Response> {
  const decision = decideAiRoute(liveFacts(opts?.userOfflineChoice ?? null));
  if (decision.route === "local") throw new OfflineAiBlockedError(decision);
  return fetch(input, init);
}

/** The user's offline-mode choice (set by the Offline page toggle). */
const OFFLINE_CHOICE_KEY = "sophira.offlineModeChoice";
export function setOfflineModeChoice(on: boolean): void {
  try {
    localStorage.setItem(OFFLINE_CHOICE_KEY, JSON.stringify(on));
  } catch {
    /* storage unavailable — navigator.onLine still guards */
  }
}
export function getOfflineModeChoice(): boolean | null {
  try {
    const raw = localStorage.getItem(OFFLINE_CHOICE_KEY);
    if (raw === null) return null;
    return JSON.parse(raw) === true;
  } catch {
    return null;
  }
}
