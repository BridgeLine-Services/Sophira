/**
 * OWNER ACTION ITEMS (2026-11-12).
 *
 * The Owner Dashboard already had a "Needs attention" area, but it could only speak about
 * invitations and provider keys - the two things the page happened to have loaded. Three
 * situations that genuinely need the Owner were invisible: a database that has not received its
 * newest update, members who are suspended (and therefore cannot sign in), and a member list
 * Sophira could not read.
 *
 * This module keeps that decision in one pure, testable place instead of growing the page. Two
 * rules run through it:
 *
 *   - "unknown" is not "zero". A count that could not be read produces a plain statement that it
 *     could not be read, never a cheerful "nothing to do" and never a fabricated number.
 *   - every item says what it means for the people using Sophira and what the Owner can do next,
 *     in words that assume no technical background. No error codes, no migration numbers.
 */

export type ActionTone = "urgent" | "info";

export interface ActionItem {
  /** Stable key, so the UI can order and test items without matching on prose. */
  key: string;
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
  tone: ActionTone;
}

export interface ActionInputs {
  /** Pending invitation requests, or null when they could not be read. */
  requestsWaiting: number | null;
  /** Members whose account is suspended, or null when the list could not be read. */
  suspendedMembers: number | null;
  /** True when the newest database pieces are not installed (a directory read failed as missing). */
  databaseOutdated: boolean;
  /** True when membership statistics could not be loaded at all. */
  membersUnreadable: boolean;
  /** True when the AI service has an active provider. */
  aiReady: boolean;
  microsoftReady: boolean;
  googleReady: boolean;
  searchReady: boolean;
}

const BODY_LIMIT = 400;

/** Trim a message down to plain, safe display text - never a raw database error wall. */
function plain(text: string): string {
  const oneLine = text.replace(/[\r\n]+/g, " ").trim();
  return oneLine.length > BODY_LIMIT ? `${oneLine.slice(0, BODY_LIMIT - 1)}…` : oneLine;
}

export function describeUnreadableMembers(detail: string | null | undefined): string {
  const reason = detail ? ` (${plain(detail)})` : "";
  return (
    "Sophira could not read your member list this time" +
    reason +
    ". Your members have not been changed, and invitations still work. Reload the page to try again."
  );
}

export function buildActionItems(input: ActionInputs): ActionItem[] {
  const urgent: ActionItem[] = [];
  const info: ActionItem[] = [];

  if (input.databaseOutdated) {
    urgent.push({
      key: "database",
      tone: "urgent",
      title: "Your database needs its newest update",
      body:
        "Sophira looked for its newest abilities - who is online right now, and the history of " +
        "role changes - and did not find them in your database. Nothing has been lost: the " +
        "update only adds things, and it is safe to run more than once. Open the database page " +
        "and press the update button.",
      href: "/owner/database",
      linkLabel: "Open the database page",
    });
  }

  if (input.membersUnreadable) {
    urgent.push({
      key: "members-unreadable",
      tone: "urgent",
      title: "Your member list could not be read",
      body:
        "Sophira could not read the member list this time. Nobody's access has changed, and " +
        "invitations still work. Reload the page to try again; if it keeps happening, the " +
        "database page will say whether your database is reachable.",
      href: "/owner/database",
      linkLabel: "Check the database",
    });
  }

  if (input.requestsWaiting !== null && input.requestsWaiting > 0) {
    info.push({
      key: "requests",
      tone: "info",
      title: `${input.requestsWaiting} access ${input.requestsWaiting === 1 ? "request is" : "requests are"} waiting for you`,
      body:
        "Someone asked to join your private network. Until you approve or decline, they cannot " +
        "sign up.",
      href: "/owner/requests",
      linkLabel: "Review the requests",
    });
  }

  if (input.suspendedMembers !== null && input.suspendedMembers > 0) {
    info.push({
      key: "suspended",
      tone: "info",
      title: `${input.suspendedMembers} ${input.suspendedMembers === 1 ? "member is" : "members are"} suspended`,
      body:
        "A suspended account cannot sign in. If that is what you intended, nothing needs doing; " +
        "if someone is waiting to be let back in, restore them from the Members page.",
      href: "/owner/members",
      linkLabel: "Open Members",
    });
  }

  if (!input.aiReady) {
    info.push({
      key: "ai",
      tone: "info",
      title: "The AI service is not running yet",
      body:
        "Sophira starts its own local AI service, so the other parts of the app still work. " +
        "Writers will not get answers until it is running. The System Health page says what is " +
        "configured and what is missing.",
      href: "/owner/health",
      linkLabel: "Open System Health",
    });
  }

  if (!input.microsoftReady || !input.googleReady) {
    info.push({
      key: "documents",
      tone: "info",
      title: "Word and Google document saving is not set up",
      body:
        "Members cannot connect their own Microsoft or Google account until the two provider " +
        "apps are registered. No other feature is affected.",
      href: "/owner/integrations",
      linkLabel: "Open Integrations",
    });
  }

  if (!input.searchReady) {
    info.push({
      key: "search",
      tone: "info",
      title: "Live web research is not configured",
      body:
        "Research falls back to the library sources your members upload and what the AI model " +
        "already knows. Add a search key whenever you want live web results.",
      href: "/owner/integrations",
      linkLabel: "Open Integrations",
    });
  }

  return [...urgent, ...info];
}

/** How many items genuinely need the Owner's attention (both tones are actionable). */
export function countActionItems(items: ActionItem[]): number {
  return items.length;
}

/** Whether anything urgent is waiting - used for the badge next to the section title. */
export function hasUrgentAction(items: ActionItem[]): boolean {
  return items.some((i) => i.tone === "urgent");
}

/**
 * Distinguish "the database is behind" from "the database could not be reached".
 *
 * A missing function (the update has not been applied) has a specific signature; a connection or
 * permissions failure does not. Reporting the first as the second would send the Owner to press
 * an update button that cannot help, so the two are kept apart.
 */
export function isMissingDatabasePiece(error: { message?: string | null; code?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = (error.code ?? "").toUpperCase();
  if (code === "PGRST202" || code === "42P01" || code === "42883") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("could not find the function") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}
