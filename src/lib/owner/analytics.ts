/**
 * NETWORK ANALYTICS, AGGREGATE AND HONEST (2026-11-13).
 *
 * What the owner asked for: how big is my network, is it growing, who joined, how many
 * invitations turn into members, and is anything failing. What this module refuses to do:
 * report a number it did not compute from stored rows, or present a missing measurement as
 * zero activity.
 *
 * PRIVACY: every figure here is a COUNT over the member directory and the invitation list.
 * Nothing reads an assignment, an essay, a notebook, a lecture, a conversation or a memory, and
 * no row-level detail is returned - only totals. The member directory already withholds academic
 * content (migration 0051); this module adds no new source.
 *
 * Three distinct absences, kept distinct:
 *   - the data could not be read at all        -> "unavailable"
 *   - the period predates Sophira keeping that -> "not-recorded"
 *   - the count really is 0                    -> 0
 *
 * Pure and deterministic: rows and the clock come from the caller.
 */

export type Reading = "read" | "unavailable";

export interface AnalyticsMember {
  user_id: string;
  created_at?: string | null;
  last_active_at?: string | null;
  role?: string | null;
  status?: string | null;
  presence?: { state?: string | null } | null;
}

export interface AnalyticsInvitation {
  status?: string | null;
  created_at?: string | null;
  accepted_at?: string | null;
  /** 'sent' | 'failed' | 'not_configured' | null (copied links and older rows). */
  email_status?: string | null;
}

export interface WeeklyPoint {
  /** ISO date of the Monday starting the week. */
  weekStart: string;
  joins: number;
  invitationsAccepted: number;
}

export interface Availability<T> {
  state: "available" | "unavailable" | "not-recorded";
  value: T | null;
  /** Plain-language reason whenever value is null. */
  detail: string;
}

export interface AnalyticsReport {
  reading: Reading;
  unavailableReason: string | null;
  generatedAt: string;
  totals: {
    members: number;
    /** Members who joined in the last 7 / 30 days, from their join date. */
    joinedLast7: number;
    joinedLast30: number;
    /** Members with a RECORDED activity in the last 7 / 30 days. Not the same as "signed in". */
    recordedActivityLast7: number;
    recordedActivityLast30: number;
    /** Members whose activity has never been recorded. */
    neverActive: number;
  };
  byRole: Array<{ role: string; count: number }>;
  byCondition: Array<{ condition: string; count: number }>;
  presenceNow: Array<{ state: string; count: number }>;
  invitations: {
    issued: number;
    accepted: number;
    pending: number;
    revoked: number;
    /** Null when no invitations have been issued - not 0% and not 100%. */
    acceptancePercent: number | null;
  };
  weekly: WeeklyPoint[];
  /** Things Sophira genuinely does not record, said out loud rather than shown as zero. */
  notRecorded: Array<{ key: string; label: string; detail: string }>;
}

const DAY = 86_400_000;
export const WEEKLY_BUCKETS = 8;

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function withinDays(value: string | null | undefined, days: number, now: number): boolean | null {
  const t = time(value);
  if (t === null) return null;
  const age = now - t;
  // A timestamp in the future is not "recent activity" - it is a clock problem. It is counted
  // as not-in-window rather than quietly inflating the number.
  if (age < -DAY) return false;
  return age <= days * DAY;
}

/** Monday 00:00 UTC of the week containing `ms`. */
function weekStartOf(ms: number): number {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0 = Sunday
  const daysFromMonday = (day + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysFromMonday);
}

function emptyReport(now: number, reason: string): AnalyticsReport {
  return {
    reading: "unavailable",
    unavailableReason: reason,
    generatedAt: new Date(now).toISOString(),
    totals: {
      members: 0, joinedLast7: 0, joinedLast30: 0,
      recordedActivityLast7: 0, recordedActivityLast30: 0, neverActive: 0,
    },
    byRole: [],
    byCondition: [],
    presenceNow: [],
    invitations: { issued: 0, accepted: 0, pending: 0, revoked: 0, acceptancePercent: null },
    weekly: [],
    notRecorded: [],
  };
}

export function buildAnalyticsReport(input: {
  members: readonly AnalyticsMember[] | null;
  invitations: readonly AnalyticsInvitation[] | null;
  now?: number;
  unavailableReason?: string | null;
}): AnalyticsReport {
  const now = input.now ?? Date.now();
  if (!input.members) {
    return emptyReport(
      now,
      input.unavailableReason ??
        "Sophira could not read the member directory just now, so no figure on this page would be a measurement. Nothing has been changed.",
    );
  }

  const members = input.members;
  let joinedLast7 = 0;
  let joinedLast30 = 0;
  let recordedActivityLast7 = 0;
  let recordedActivityLast30 = 0;
  let neverActive = 0;

  const roles = new Map<string, number>();
  const conditions = new Map<string, number>();
  const presence = new Map<string, number>();

  for (const m of members) {
    if (withinDays(m.created_at, 7, now) === true) joinedLast7 += 1;
    if (withinDays(m.created_at, 30, now) === true) joinedLast30 += 1;

    const active7 = withinDays(m.last_active_at, 7, now);
    if (active7 === true) recordedActivityLast7 += 1;
    if (withinDays(m.last_active_at, 30, now) === true) recordedActivityLast30 += 1;
    if (active7 === null) neverActive += 1;

    const role = (m.role ?? "").trim() || "unknown";
    roles.set(role, (roles.get(role) ?? 0) + 1);
    const condition = (m.status ?? "").trim() || "unknown";
    conditions.set(condition, (conditions.get(condition) ?? 0) + 1);
    const state = (m.presence?.state ?? "").trim() || "unknown";
    presence.set(state, (presence.get(state) ?? 0) + 1);
  }

  const invitations = input.invitations ?? [];
  const accepted = invitations.filter((i) => (i.status ?? "") === "accepted").length;
  const pending = invitations.filter((i) => (i.status ?? "") === "pending").length;
  const revoked = invitations.filter((i) => (i.status ?? "") === "revoked").length;
  const issued = invitations.length;

  // Eight consecutive weeks ending with the current one, oldest first. A week with no joins is
  // a real 0 - the bucket exists precisely because the record covers that week.
  const thisWeek = weekStartOf(now);
  const weekly: WeeklyPoint[] = [];
  for (let i = WEEKLY_BUCKETS - 1; i >= 0; i -= 1) {
    const start = thisWeek - i * 7 * DAY;
    weekly.push({ weekStart: new Date(start).toISOString().slice(0, 10), joins: 0, invitationsAccepted: 0 });
  }
  const bucketIndex = (ms: number | null): number | null => {
    if (ms === null) return null;
    const start = weekStartOf(ms);
    const index = weekly.findIndex((w) => new Date(`${w.weekStart}T00:00:00.000Z`).getTime() === start);
    return index === -1 ? null : index;
  };
  for (const m of members) {
    const idx = bucketIndex(time(m.created_at));
    if (idx !== null) weekly[idx].joins += 1;
  }
  for (const inv of invitations) {
    if ((inv.status ?? "") !== "accepted") continue;
    const idx = bucketIndex(time(inv.accepted_at) ?? time(inv.created_at));
    if (idx !== null) weekly[idx].invitationsAccepted += 1;
  }

  const acceptancePercent = issued === 0 ? null : Math.round((accepted / issued) * 1000) / 10;

  return {
    reading: "read",
    unavailableReason: null,
    generatedAt: new Date(now).toISOString(),
    totals: {
      members: members.length,
      joinedLast7,
      joinedLast30,
      recordedActivityLast7,
      recordedActivityLast30,
      neverActive,
    },
    byRole: [...roles.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count),
    byCondition: [...conditions.entries()].map(([condition, count]) => ({ condition, count })).sort((a, b) => b.count - a.count),
    presenceNow: [...presence.entries()].map(([state, count]) => ({ state, count })).sort((a, b) => b.count - a.count),
    invitations: { issued, accepted, pending, revoked, acceptancePercent },
    weekly,
    notRecorded: [
      {
        key: "sign-ins",
        label: "Sign-in history",
        detail:
          "Sophira records the last time a member was active, not a list of sign-ins. A sign-in trend would be invented, so none is shown.",
      },
      {
        key: "offline-sync",
        label: "Offline synchronisation failures",
        detail:
          "Offline changes are held on the member's own device and retried there. No failure is reported to the server, so Sophira has no count to show.",
      },
      {
        key: "feature-use",
        label: "Feature adoption",
        detail:
          "Sophira does not record which features each member opens. Per-member usage would be activity tracking of a person's study, so it is deliberately not collected.",
      },
    ],
  };
}

/** One decimal, or an honest word. Used by the page and the tests. */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  return value.toLocaleString("en-US");
}

/** Plain-word labels for stored values, so the owner never reads a database word. */
export function plainLabel(value: string): string {
  const map: Record<string, string> = {
    owner: "Owner",
    co_owner: "Co-Owner",
    tester: "Tester",
    user: "User",
    active: "Active",
    pending: "Awaiting invitation",
    accepted: "Accepted",
    revoked: "Access revoked",
    suspended: "Suspended",
    locked: "Locked",
    deactivated: "Deactivated",
    unknown: "Not recorded",
    online: "Online",
    idle: "Idle",
    away: "Away",
    busy: "Busy",
    dnd: "Do Not Disturb",
    offline: "Offline",
  };
  return map[value] ?? value.replace(/_/g, " ");
}
