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
  /**
   * Whether members feel this right now: true / false, or null when Sophira cannot say.
   * The Owner asked for this explicitly - "is anyone affected?" is usually the question that
   * decides whether a job is for tonight or for next week.
   */
  membersAffected: boolean | null;
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
  /**
   * Backup picture, or null when it could not be read (then nothing is claimed about it).
   * `reported` false means no backup report has ever reached Sophira, which is unknown - not
   * "no backup exists" and certainly not "backups are fine".
   */
  backup?: { recoverable: boolean; reported: boolean } | null;
  /** True while the legal documents still contain owner-supplied placeholders. */
  legalIncomplete?: boolean | null;
  /** AI requests that failed in the recent window, or null when that was not read. */
  aiFailures?: number | null;
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
      membersAffected: true,
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
      membersAffected: null,
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
      membersAffected: true,
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
      membersAffected: true,
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
      membersAffected: true,
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
      membersAffected: false,
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
      membersAffected: false,
    });
  }

  // A RECORDED AI FAILURE WITH A WORKING PROVIDER (2026-11-13). Distinct from "the AI service is
  // not running": here a provider IS active and requests are still failing, which members notice
  // as an error message. Only reported when the usage record was actually read.
  if (input.aiFailures !== null && input.aiFailures !== undefined && input.aiFailures > 0 && input.aiReady) {
    urgent.push({
      key: "ai-failures",
      tone: "urgent",
      title: `${input.aiFailures} AI ${input.aiFailures === 1 ? "request has" : "requests have"} failed recently`,
      body:
        "The AI service is connected, but some requests did not produce an answer. A member sees a " +
        "plain message when that happens and none of their work is lost. The AI Operations page " +
        "shows which provider failed and how often, so you can decide whether to switch provider.",
      href: "/owner/ai-operations",
      linkLabel: "Open AI Operations",
      membersAffected: true,
    });
  }

  // BACKUPS (2026-11-13). Two very different situations, worded differently: a report Sophira has
  // seen that is incomplete, and no report at all. Neither one is ever "backups are fine".
  if (input.backup) {
    if (input.backup.reported && !input.backup.recoverable) {
      urgent.push({
        key: "backup",
        tone: "urgent",
        title: "Your backups are not proven yet",
        body:
          "Sophira has a backup report, but not every step is done: the backup may be older than a " +
          "week, unchecked, or never restored in a test. If the database were lost tonight, " +
          "recovery is not guaranteed. No member sees a problem today - this is about the day " +
          "something goes wrong.",
        href: "/owner/backup",
        linkLabel: "Open Backup and recovery",
        membersAffected: false,
      });
    } else if (!input.backup.reported) {
      info.push({
        key: "backup-unreported",
        tone: "info",
        title: "No backup has been reported to Sophira",
        body:
          "Nobody has told Sophira about a backup, so it cannot say whether your network is " +
          "protected tonight. This is not a failure: it is simply unknown. The Backup page " +
          "explains the one command that takes a backup and the file that lets Sophira read its " +
          "result.",
        href: "/owner/backup",
        linkLabel: "Open Backup and recovery",
        membersAffected: false,
      });
    }
  }

  // LEGAL PAPERWORK (2026-11-13). Only shown when the documents were actually read and still
  // contain placeholders, so the Owner is never nagged about a file Sophira could not open.
  if (input.legalIncomplete === true) {
    info.push({
      key: "legal",
      tone: "info",
      title: "Your Terms and Privacy pages are still templates",
      body:
        "They contain placeholders where your legal name, address and contact details belong. " +
        "Members can read the pages, and nothing is broken, but the wording is not yet yours. " +
        "This matters before you invite people outside your own household.",
      href: "/owner/status",
      linkLabel: "See what is outstanding",
      membersAffected: false,
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
