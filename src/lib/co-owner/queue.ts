/**
 * THE CO-OWNER'S OPERATIONAL QUEUE (2026-11-15).
 *
 * WHY THIS EXISTS
 * A Co-Owner's day is a list of small decisions: someone is waiting to be let in, an invitation
 * has been sitting unopened for three weeks, a tester filed a serious bug, a member signed up a
 * fortnight ago and has never come back. The Co-Owner dashboard showed five counts - "3 pending
 * invitations" - but a count is not work: it does not say which one is oldest, which one matters
 * today, or where to go to clear it.
 *
 * WHAT THIS IS, HONESTLY
 * The queue is DERIVED. Every item is a row that already exists in a table whose `status` is the
 * single source of truth, and clearing it means changing that row on the screen it belongs to.
 * There is no second copy of the work to fall out of sync, and two Co-Owners looking at it see the
 * same list because they are reading the same rows.
 *
 * What it deliberately does NOT do: it does not keep a "claimed by" flag. No table in this
 * database records who picked an item up, so the queue cannot honestly show one, and inventing it
 * here would create a second source of truth. That is named as remaining work rather than faked.
 *
 * THREE RULES, THE SAME ONES THE REST OF THIS REPOSITORY FOLLOWS
 *   - "could not read" is not "nothing waiting". A source that failed is named in `unavailable`,
 *     and the headline says so.
 *   - the order is the point. Urgency first, then the longest wait, because the thing nobody has
 *     touched for three weeks is the thing actually being neglected.
 *   - plain English only. No status words, no column names, no error codes.
 *
 * PURE: no database, no React, no clock. `now` is passed in, so every rule is testable.
 */

/* ------------------------------------------------------------------ */
/* Thresholds, in one place so the page and the tests cannot disagree. */
/* ------------------------------------------------------------------ */

/** An access request nobody has decided: urgent after a week, worth this week after three days. */
export const ACCESS_REQUEST_TODAY_DAYS = 7;
export const ACCESS_REQUEST_SOON_DAYS = 3;

/** An invitation sent and never accepted: chase it after two weeks, act on it after a month. */
export const INVITATION_TODAY_DAYS = 30;
export const INVITATION_SOON_DAYS = 14;

/** A serious tester report is today's work from the moment it arrives. */
export const SERIOUS_REPORT_TODAY_DAYS = 0;
/** An ordinary report that has sat for four days is this week's work. */
export const REPORT_TODAY_DAYS = 4;
export const REPORT_SOON_DAYS = 3;

/** A member who signed up and has never used Sophira: noticed after a week, chased after two. */
export const NEVER_ACTIVE_SOON_DAYS = 7;
export const NEVER_ACTIVE_TODAY_DAYS = 14;
/** A member who used to use Sophira and went quiet. */
export const DORMANT_NOTICE_DAYS = 30;
export const DORMANT_SOON_DAYS = 60;

/** How many items the dashboard shows before it stops and says how many it held back. */
export const QUEUE_PAGE_SIZE = 8;

export type QueueSource = "access-request" | "invitation" | "tester-report" | "quiet-member";
export type QueueUrgency = "today" | "this-week" | "when-you-can";

export const QUEUE_SOURCE_LABEL: Record<QueueSource, string> = {
  "access-request": "Access request",
  invitation: "Invitation",
  "tester-report": "Tester report",
  "quiet-member": "Quiet member",
};

export const QUEUE_URGENCY_LABEL: Record<QueueUrgency, string> = {
  today: "Today",
  "this-week": "This week",
  "when-you-can": "When you can",
};

const URGENCY_ORDER: Record<QueueUrgency, number> = {
  today: 0,
  "this-week": 1,
  "when-you-can": 2,
};

/* ------------------------------------------------------------------ */
/* Inputs: the shapes the page already reads, plus null for "no answer". */
/* ------------------------------------------------------------------ */

export interface QueueAccessRequest {
  id: string;
  /** Whatever the person gave when they asked to join. Never shown unless present. */
  email?: string | null;
  name?: string | null;
  created_at: string;
}

export interface QueueInvitation {
  id: string;
  email?: string | null;
  created_at: string;
}

export interface QueueTesterReport {
  id: string;
  title: string;
  severity: string;
  kind?: string | null;
  created_at: string;
}

export interface QueueMember {
  id: string;
  display_name?: string | null;
  role?: string | null;
  status?: string | null;
  created_at: string;
  last_active_at?: string | null;
}

export interface QueueInputs {
  /** ISO instant. Passed in, never read from a hidden clock. */
  now: string;
  accessRequests: readonly QueueAccessRequest[] | null;
  invitations: readonly QueueInvitation[] | null;
  testerReports: readonly QueueTesterReport[] | null;
  members: readonly QueueMember[] | null;
}

export interface QueueItem {
  /** Stable, so ordering and tests never depend on prose: `${source}:${recordId}`. */
  id: string;
  source: QueueSource;
  /** The person or the report, in the shortest useful form. */
  who: string;
  title: string;
  /** What this means for the network, in plain English. */
  detail: string;
  /** How long it has waited, written as words ("3 weeks"), never as a raw date. */
  waitingFor: string;
  daysWaiting: number;
  urgency: QueueUrgency;
  href: string;
  action: string;
  /** Sorting tie-break: the record's own id, so equal items keep a stable order. */
  tieBreak: string;
}

export interface QueueUnavailable {
  source: QueueSource;
  label: string;
}

export interface QueueResult {
  items: QueueItem[];
  /** Every count is null when any source could not be read - never 0. */
  counts: {
    today: number | null;
    thisWeek: number | null;
    whenYouCan: number | null;
    total: number | null;
  };
  unavailable: QueueUnavailable[];
  /** One sentence a Co-Owner can act on, or an honest statement that part of it is missing. */
  headline: string;
  /** True only when every source answered and every one of them was empty. */
  nothingWaiting: boolean;
}

/* ------------------------------------------------------------------ */
/* Small, pure helpers.                                                */
/* ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between an ISO instant and `now`. A clock skew becomes 0, never a negative wait. */
export function daysBetween(iso: string | null | undefined, now: string): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  const ref = Date.parse(now);
  if (Number.isNaN(then) || Number.isNaN(ref)) return null;
  return Math.max(0, Math.floor((ref - then) / DAY_MS));
}

/** "3 weeks" rather than "2026-10-25": a Co-Owner thinks in how long, not in which date. */
export function waitingWords(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "today";
  if (days === 1) return "1 day";
  if (days < 7) return `${Math.floor(days)} days`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return weeks === 1 ? "a week" : `${weeks} weeks`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month" : `${months} months`;
}

/** The fewest words that identify who this item is about. Never an email when there is a name. */
export function personLabel(
  parts: { name?: string | null; email?: string | null },
  fallback: string,
): string {
  const name = (parts.name ?? "").trim();
  if (name) return name;
  const email = (parts.email ?? "").trim();
  if (email) return email;
  return fallback;
}

function urgencyFor(days: number, today: number, soon: number): QueueUrgency {
  if (days >= today) return "today";
  if (days >= soon) return "this-week";
  return "when-you-can";
}

/* ------------------------------------------------------------------ */
/* The four sources.                                                   */
/* ------------------------------------------------------------------ */

export function accessRequestItems(
  requests: readonly QueueAccessRequest[] | null,
  now: string,
): QueueItem[] {
  if (!requests) return [];
  return requests.map((r) => {
    const days = daysBetween(r.created_at, now) ?? 0;
    const urgency = urgencyFor(days, ACCESS_REQUEST_TODAY_DAYS, ACCESS_REQUEST_SOON_DAYS);
    const who = personLabel(r, "Someone");
    return {
      id: `access-request:${r.id}`,
      source: "access-request" as const,
      who,
      title: `${who} asked to join`,
      detail:
        urgency === "today"
          ? "They have been waiting more than a week for a decision. Approving them sends the invitation."
          : "Decide whether they may join the network. Approving sends the invitation for you.",
      waitingFor: waitingWords(days),
      daysWaiting: days,
      urgency,
      href: "/owner/requests",
      action: "Decide",
      tieBreak: r.id,
    };
  });
}

export function invitationItems(
  invitations: readonly QueueInvitation[] | null,
  now: string,
): QueueItem[] {
  if (!invitations) return [];
  return invitations.map((inv) => {
    const days = daysBetween(inv.created_at, now) ?? 0;
    const urgency = urgencyFor(days, INVITATION_TODAY_DAYS, INVITATION_SOON_DAYS);
    const who = personLabel(inv, "An invitation");
    return {
      id: `invitation:${inv.id}`,
      source: "invitation" as const,
      who,
      title: `The invitation to ${who} has not been accepted`,
      detail:
        urgency === "today"
          ? "Sent more than a month ago. Either send it again or withdraw it, so the number means something."
          : "Still waiting to be accepted. Chase it once, then decide whether to withdraw it.",
      waitingFor: waitingWords(days),
      daysWaiting: days,
      urgency,
      href: "/owner/invitations",
      action: "Chase or withdraw",
      tieBreak: inv.id,
    };
  });
}

export function testerReportItems(
  reports: readonly QueueTesterReport[] | null,
  now: string,
): QueueItem[] {
  if (!reports) return [];
  return reports.map((rep) => {
    const days = daysBetween(rep.created_at, now) ?? 0;
    const severity = String(rep.severity ?? "").toLowerCase();
    const serious = severity === "critical" || severity === "high";
    const urgency: QueueUrgency = serious
      ? "today"
      : urgencyFor(days, REPORT_TODAY_DAYS, REPORT_SOON_DAYS);
    const title = (rep.title ?? "").trim() || "A tester report with no title";
    return {
      id: `tester-report:${rep.id}`,
      source: "tester-report" as const,
      who: title,
      title,
      detail: serious
        ? "Reported as serious, so it stays today's work until somebody looks at it."
        : "A tester reported this and nobody has answered yet.",
      waitingFor: waitingWords(days),
      daysWaiting: days,
      urgency,
      href: "/owner/qa",
      action: "Look at it",
      tieBreak: rep.id,
    };
  });
}

/**
 * Members who signed up and never came back, or who used to use Sophira and stopped.
 * Revoked accounts are excluded: they are not work, they are a decision already taken.
 */
export function quietMemberItems(
  members: readonly QueueMember[] | null,
  now: string,
): QueueItem[] {
  if (!members) return [];
  const items: QueueItem[] = [];
  for (const m of members) {
    const status = String(m.status ?? "").toLowerCase();
    if (status !== "active" && status !== "accepted") continue;
    const who = personLabel({ name: m.display_name }, "A member");
    const age = daysBetween(m.created_at, now);
    const last = daysBetween(m.last_active_at, now);
    if (last === null) {
      // Never recorded as active. Only worth raising once they have had time to try.
      if (age === null || age < NEVER_ACTIVE_SOON_DAYS) continue;
      items.push({
        id: `quiet-member:${m.id}`,
        source: "quiet-member",
        who,
        title: `${who} has never used Sophira`,
        detail:
          "They have access but have not opened anything yet. A short welcome usually finds out why.",
        waitingFor: waitingWords(age),
        daysWaiting: age,
        urgency: urgencyFor(age, NEVER_ACTIVE_TODAY_DAYS, NEVER_ACTIVE_SOON_DAYS),
        href: "/owner/members",
        action: "Reach out",
        tieBreak: m.id,
      });
      continue;
    }
    if (last < DORMANT_NOTICE_DAYS) continue;
    items.push({
      id: `quiet-member:${m.id}`,
      source: "quiet-member",
      who,
      title: `${who} has not used Sophira for ${waitingWords(last)}`,
      detail:
        "Their access still works. If they have finished, revoking the account keeps the member list honest.",
      waitingFor: waitingWords(last),
      daysWaiting: last,
      urgency: urgencyFor(last, DORMANT_SOON_DAYS, DORMANT_NOTICE_DAYS),
      href: "/owner/members",
      action: "Check or revoke",
      tieBreak: m.id,
    });
  }
  return items;
}

/* ------------------------------------------------------------------ */
/* The queue itself.                                                   */
/* ------------------------------------------------------------------ */

export function sortQueue(items: readonly QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => {
    const byUrgency = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
    if (byUrgency !== 0) return byUrgency;
    if (b.daysWaiting !== a.daysWaiting) return b.daysWaiting - a.daysWaiting;
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return a.tieBreak.localeCompare(b.tieBreak);
  });
}

/**
 * Build the queue. The order of `unavailable` is fixed (the order a Co-Owner would look at the
 * sources), so the page cannot render a list that reshuffles between loads for no reason.
 */
export function buildCoOwnerQueue(input: QueueInputs): QueueResult {
  const unavailable: QueueUnavailable[] = [];
  if (!input.accessRequests) unavailable.push({ source: "access-request", label: "Access requests" });
  if (!input.invitations) unavailable.push({ source: "invitation", label: "Invitations" });
  if (!input.testerReports) unavailable.push({ source: "tester-report", label: "Tester reports" });
  if (!input.members) unavailable.push({ source: "quiet-member", label: "Member activity" });

  const items = sortQueue([
    ...accessRequestItems(input.accessRequests, input.now),
    ...invitationItems(input.invitations, input.now),
    ...testerReportItems(input.testerReports, input.now),
    ...quietMemberItems(input.members, input.now),
  ]);

  const anyUnread = unavailable.length > 0;
  const count = (u: QueueUrgency) => (anyUnread ? null : items.filter((i) => i.urgency === u).length);
  const counts = {
    today: count("today"),
    thisWeek: count("this-week"),
    whenYouCan: count("when-you-can"),
    total: anyUnread ? null : items.length,
  };

  const nothingWaiting = !anyUnread && items.length === 0;
  let headline: string;
  if (anyUnread) {
    const names = unavailable.map((u) => u.label.toLowerCase()).join(", ");
    headline = items.length
      ? `${items.length} thing${items.length === 1 ? "" : "s"} waiting, but ${names} could not be read, so this list is incomplete.`
      : `Nothing could be confirmed as waiting, because ${names} could not be read.`;
  } else if (nothingWaiting) {
    headline = "Nothing is waiting for you. Every request, invitation and report has been dealt with.";
  } else if ((counts.today ?? 0) > 0) {
    headline = `${counts.today} to deal with today, and ${items.length - (counts.today ?? 0)} after that.`;
  } else {
    headline = `${items.length} thing${items.length === 1 ? "" : "s"} waiting, none of them urgent.`;
  }

  return { items, counts, unavailable, headline, nothingWaiting };
}

/** The first page of the queue, plus how many were held back. */
export function queuePage(result: QueueResult, size: number = QUEUE_PAGE_SIZE): {
  visible: QueueItem[];
  hidden: number;
} {
  const limit = Math.max(0, Math.floor(size));
  return { visible: result.items.slice(0, limit), hidden: Math.max(0, result.items.length - limit) };
}

/** Group items under the three plain-English headings, dropping empty groups. */
export function queueGroups(
  items: readonly QueueItem[],
): Array<{ urgency: QueueUrgency; label: string; items: QueueItem[] }> {
  return (["today", "this-week", "when-you-can"] as QueueUrgency[])
    .map((urgency) => ({
      urgency,
      label: QUEUE_URGENCY_LABEL[urgency],
      items: items.filter((i) => i.urgency === urgency),
    }))
    .filter((g) => g.items.length > 0);
}
