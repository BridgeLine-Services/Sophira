/**
 * THE OWNER'S ALERTS, IN ONE PLACE (2026-11-16).
 *
 * WHAT WAS WRONG
 * The Owner dashboard had a good "Needs attention" list (src/lib/owner/action-items.ts), but it
 * could only speak about the inputs it was handed: providers, the database, backups, legal pages.
 * Three things that genuinely need the Owner were invisible there, and only findable by opening the
 * right page and noticing the age of something:
 *
 *   - tester reports that arrived days ago and are still unanswered,
 *   - an access request nobody has decided for over a week,
 *   - an invitation or a member account that has been sitting untouched for a month.
 *
 * WHAT THIS ADDS, AND WHAT IT DOES NOT
 * This module does not replace the action-item list and does not repeat it: the items already
 * produced by `buildActionItems()` are passed in, keep their own wording and links, and are only
 * re-ranked here. What this adds is AGE - the fact that something is old is not visible in a count,
 * and age is usually the thing that makes it the Owner's problem rather than an administrator's.
 *
 * It also keeps the repository's three standing rules:
 *   - "could not read" is not "nothing wrong". A source that failed is named in `unavailable`, and
 *     the headline says the picture is incomplete.
 *   - no claim without evidence: an alert exists only because a record says so, and every alert
 *     says which record and how old it is.
 *   - plain English, and no student's work. Alerts about members say a name and a fact about access,
 *     never anything a student wrote.
 *
 * PURE: no database, no React, no clock. `now` is passed in.
 */

import { daysBetween, waitingWords } from "@/lib/co-owner/queue";

/** Two levels only. A third would be decoration: the Owner's real question is "tonight or not". */
export type AlertSeverity = "today" | "watch";

export const ALERT_SEVERITY_LABEL: Record<AlertSeverity, string> = {
  today: "Today",
  watch: "Worth knowing",
};

export type AlertSource =
  | "action-item"
  | "tester-report"
  | "access-request"
  | "invitation"
  | "quiet-member";

export const ALERT_SOURCE_LABEL: Record<AlertSource, string> = {
  "action-item": "System check",
  "tester-report": "Tester report",
  "access-request": "Access request",
  invitation: "Invitation",
  "quiet-member": "Member activity",
};

/** A tester report nobody has answered for this long is today's work, whoever wrote it. */
export const REPORT_TODAY_DAYS = 2;
export const REPORT_NOTICE_DAYS = 1;
/** An access request undecided for a week is the Owner's problem, not the queue's. */
export const REQUEST_TODAY_DAYS = 7;
export const REQUEST_NOTICE_DAYS = 3;
/** An invitation unaccepted for a month is worth knowing about; two months is stale. */
export const INVITATION_NOTICE_DAYS = 30;
/** A member who signed up and never used Sophira, and one who stopped. */
export const NEVER_ACTIVE_DAYS = 14;
export const DORMANT_DAYS = 60;

/** How many alerts the dashboard shows before it says how many were held back. */
export const ALERT_PAGE_SIZE = 6;

export interface OwnerActionItemInput {
  key: string;
  title: string;
  body: string;
  href?: string;
  linkLabel?: string;
  tone: "urgent" | "info";
  membersAffected: boolean | null;
}

export interface AlertTesterReport {
  id: string;
  title: string;
  severity: string;
  created_at: string;
}

export interface AlertAccessRequest {
  id: string;
  email?: string | null;
  created_at: string;
}

export interface AlertInvitation {
  id: string;
  email?: string | null;
  created_at: string;
}

export interface AlertMember {
  id: string;
  display_name?: string | null;
  status?: string | null;
  created_at: string;
  last_active_at?: string | null;
}

export interface AlertInputs {
  now: string;
  /** The Owner's existing action items, or null when they could not be built. */
  actionItems: readonly OwnerActionItemInput[] | null;
  /** Tester reports still awaiting an answer, or null when they could not be read. */
  testerReports: readonly AlertTesterReport[] | null;
  /** Access requests still pending, or null. */
  accessRequests: readonly AlertAccessRequest[] | null;
  /** Invitations still unaccepted, or null. */
  invitations: readonly AlertInvitation[] | null;
  /** Member accounts with their last meaningful activity, or null. */
  members: readonly AlertMember[] | null;
}

export interface OwnerAlert {
  /** Stable: `${source}:${recordIdOrKey}`. */
  id: string;
  severity: AlertSeverity;
  source: AlertSource;
  title: string;
  /** Why it matters, and to whom. Null when the existing action item already said it. */
  why: string | null;
  /** "Members at their desk cannot sign in" / null when this is not about people right now. */
  who: string | null;
  href: string | null;
  linkLabel: string | null;
  /** How long it has waited, in words. Null when the alert is not about elapsed time. */
  waitingFor: string | null;
  /** Elapsed days used for ordering. 0 when there is no meaningful age. */
  daysWaiting: number;
}

export interface AlertUnavailable {
  source: AlertSource;
  label: string;
}

export interface OwnerAlerts {
  alerts: OwnerAlert[];
  counts: { today: number | null; watch: number | null; total: number | null };
  unavailable: AlertUnavailable[];
  headline: string;
  quiet: boolean;
}

/**
 * Which action-item keys already cover a topic. If one of these is present, the derived alert for
 * the same subject is dropped: the Owner should read one sentence about a problem, not two.
 */
const TOPIC_ACTION_KEYS: Record<string, string[]> = {
  "tester-report": ["qa"],
  "access-request": ["requests"],
};

function severityFor(days: number, todayAfter: number, noticeAfter: number): AlertSeverity | null {
  if (days >= todayAfter) return "today";
  if (days >= noticeAfter) return "watch";
  return null;
}

export function actionItemAlerts(
  items: readonly OwnerActionItemInput[] | null,
): OwnerAlert[] {
  if (!items) return [];
  return items.map((item) => ({
    id: `action-item:${item.key}`,
    severity: item.tone === "urgent" ? "today" : "watch",
    source: "action-item" as const,
    title: item.title,
    why: item.body,
    who:
      item.membersAffected === true
        ? "People using Sophira are affected right now."
        : item.membersAffected === false
          ? "Nobody is blocked by this yet."
          : null,
    href: item.href ?? null,
    linkLabel: item.linkLabel ?? null,
    waitingFor: null,
    daysWaiting: 0,
  }));
}

export function testerReportAlerts(
  reports: readonly AlertTesterReport[] | null,
  now: string,
): OwnerAlert[] {
  if (!reports) return [];
  const out: OwnerAlert[] = [];
  for (const rep of reports) {
    const days = daysBetween(rep.created_at, now) ?? 0;
    const serious = ["critical", "high"].includes(String(rep.severity ?? "").toLowerCase());
    // A serious report is already in the tester queue's own urgency; here it only becomes an Owner
    // alert once it has waited, so the two surfaces are not the same sentence twice.
    const severity = severityFor(days, REPORT_TODAY_DAYS, REPORT_NOTICE_DAYS);
    if (!severity) continue;
    const title = (rep.title ?? "").trim() || "A tester report with no title";
    out.push({
      id: `tester-report:${rep.id}`,
      severity: serious ? "today" : severity,
      source: "tester-report",
      title,
      why: serious
        ? "A tester reported this as serious and it is still unanswered."
        : "A tester reported this and nobody has answered yet.",
      who: null,
      href: "/owner/qa",
      linkLabel: "Open QA triage",
      waitingFor: waitingWords(days),
      daysWaiting: days,
    });
  }
  return out;
}

export function accessRequestAlerts(
  requests: readonly AlertAccessRequest[] | null,
  now: string,
): OwnerAlert[] {
  if (!requests) return [];
  const out: OwnerAlert[] = [];
  for (const r of requests) {
    const days = daysBetween(r.created_at, now) ?? 0;
    const severity = severityFor(days, REQUEST_TODAY_DAYS, REQUEST_NOTICE_DAYS);
    if (!severity) continue;
    const who = (r.email ?? "").trim();
    out.push({
      id: `access-request:${r.id}`,
      severity,
      source: "access-request",
      title: who ? `${who} has been waiting to be decided` : "An access request is waiting to be decided",
      why: "Someone asked to join and no decision has been recorded. They cannot use Sophira until one is.",
      who: "The person waiting cannot get in.",
      href: "/owner/requests",
      linkLabel: "Decide it",
      waitingFor: waitingWords(days),
      daysWaiting: days,
    });
  }
  return out;
}

export function invitationAlerts(
  invitations: readonly AlertInvitation[] | null,
  now: string,
): OwnerAlert[] {
  if (!invitations) return [];
  const out: OwnerAlert[] = [];
  for (const inv of invitations) {
    const days = daysBetween(inv.created_at, now) ?? 0;
    if (days < INVITATION_NOTICE_DAYS) continue;
    const who = (inv.email ?? "").trim();
    out.push({
      id: `invitation:${inv.id}`,
      severity: days >= INVITATION_NOTICE_DAYS * 2 ? "today" : "watch",
      source: "invitation",
      title: who ? `The invitation to ${who} is still unused` : "An invitation is still unused",
      why:
        days >= INVITATION_NOTICE_DAYS * 2
          ? "It has been sitting for over two months. Sending it again or withdrawing it keeps the invitation count meaningful."
          : "It has been sitting for over a month. It may have gone to the wrong address.",
      who: null,
      href: "/owner/invitations",
      linkLabel: "Chase or withdraw",
      waitingFor: waitingWords(days),
      daysWaiting: days,
    });
  }
  return out;
}

/**
 * Members who never used Sophira, or who stopped. Revoked and not-yet-active accounts are excluded:
 * those are decisions already taken, not neglect.
 */
export function quietMemberAlerts(
  members: readonly AlertMember[] | null,
  now: string,
): OwnerAlert[] {
  if (!members) return [];
  const out: OwnerAlert[] = [];
  for (const m of members) {
    const status = String(m.status ?? "").toLowerCase();
    if (status !== "active" && status !== "accepted") continue;
    const name = (m.display_name ?? "").trim() || "A member";
    const last = daysBetween(m.last_active_at, now);
    if (last === null) {
      const age = daysBetween(m.created_at, now);
      if (age === null || age < NEVER_ACTIVE_DAYS) continue;
      out.push({
        id: `quiet-member:${m.id}`,
        severity: "watch",
        source: "quiet-member",
        title: `${name} has never used Sophira`,
        why: "They accepted access but have never opened anything. That is usually a welcome that never arrived, or an invitation nobody followed up.",
        who: "Their access works; nothing is broken for anyone else.",
        href: "/owner/members",
        linkLabel: "Open the member list",
        waitingFor: waitingWords(age),
        daysWaiting: age,
      });
      continue;
    }
    if (last < DORMANT_DAYS) continue;
    out.push({
      id: `quiet-member:${m.id}`,
      severity: "watch",
      source: "quiet-member",
      title: `${name} has not used Sophira for ${waitingWords(last)}`,
      why: "Their access still works. If they have finished with it, revoking the account keeps the member list and every count on this dashboard honest.",
      who: null,
      href: "/owner/members",
      linkLabel: "Check or revoke",
      waitingFor: waitingWords(last),
      daysWaiting: last,
    });
  }
  return out;
}

function severityRank(a: AlertSeverity): number {
  return a === "today" ? 0 : 1;
}

export function sortAlerts(alerts: readonly OwnerAlert[]): OwnerAlert[] {
  return [...alerts].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;
    if (b.daysWaiting !== a.daysWaiting) return b.daysWaiting - a.daysWaiting;
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.id.localeCompare(b.id);
  });
}

/** Build the one list. Deterministic: same inputs, same order, no clock of its own. */
export function buildOwnerAlerts(input: AlertInputs): OwnerAlerts {
  const unavailable: AlertUnavailable[] = [];
  if (!input.actionItems) unavailable.push({ source: "action-item", label: "System checks" });
  if (!input.testerReports) unavailable.push({ source: "tester-report", label: "Tester reports" });
  if (!input.accessRequests) unavailable.push({ source: "access-request", label: "Access requests" });
  if (!input.invitations) unavailable.push({ source: "invitation", label: "Invitations" });
  if (!input.members) unavailable.push({ source: "quiet-member", label: "Member activity" });

  const existingKeys = new Set((input.actionItems ?? []).map((i) => i.key));
  const alreadyCovered = (source: AlertSource): boolean =>
    (TOPIC_ACTION_KEYS[source] ?? []).some((key) => existingKeys.has(key));

  const derived = [
    ...testerReportAlerts(input.testerReports, input.now),
    ...accessRequestAlerts(input.accessRequests, input.now),
    ...invitationAlerts(input.invitations, input.now),
    ...quietMemberAlerts(input.members, input.now),
  ].filter((alert) => !alreadyCovered(alert.source));

  const seen = new Set<string>();
  const alerts: OwnerAlert[] = [];
  for (const alert of sortAlerts([...actionItemAlerts(input.actionItems), ...derived])) {
    if (seen.has(alert.id)) continue;
    seen.add(alert.id);
    alerts.push(alert);
  }

  const anyUnread = unavailable.length > 0;
  const counts = {
    today: anyUnread ? null : alerts.filter((a) => a.severity === "today").length,
    watch: anyUnread ? null : alerts.filter((a) => a.severity === "watch").length,
    total: anyUnread ? null : alerts.length,
  };
  const quiet = !anyUnread && alerts.length === 0;

  let headline: string;
  if (anyUnread) {
    const names = unavailable.map((u) => u.label.toLowerCase()).join(", ");
    headline = alerts.length
      ? `${alerts.length} alert${alerts.length === 1 ? "" : "s"}, but ${names} could not be checked, so this is not the whole picture.`
      : `No alert could be confirmed, because ${names} could not be checked.`;
  } else if (quiet) {
    headline = "Nothing needs you. Every check answered, and nothing is old enough to raise.";
  } else if ((counts.today ?? 0) > 0) {
    headline = `${counts.today} for today, and ${alerts.length - (counts.today ?? 0)} worth knowing.`;
  } else {
    headline = "Nothing for today. A few things are worth knowing when you have a moment.";
  }

  return { alerts, counts, unavailable, headline, quiet };
}

export function alertPage(
  result: OwnerAlerts,
  size: number = ALERT_PAGE_SIZE,
): { visible: OwnerAlert[]; hidden: number } {
  const limit = Math.max(0, Math.floor(size));
  return { visible: result.alerts.slice(0, limit), hidden: Math.max(0, result.alerts.length - limit) };
}
