/**
 * NETWORK ANALYTICS, EXTENDED (2026-11-11).
 *
 * The first analytics page answered "how big is my network and is it growing" over fixed
 * windows. This module adds what the owner asked for next: a chosen reporting period, the AI's
 * own recorded activity, invitation delivery, and the aggregate footprint of each feature - while
 * keeping the two rules the first page was built on:
 *
 *   - every figure is a COUNT over stored rows, never an estimate;
 *   - a measurement Sophira does not take is SAID, not drawn as a zero.
 *
 * PRIVACY: nothing here reads an assignment, an essay, a notebook, a lecture, a conversation or
 * a memory's content. The feature footprint counts ROWS, not people, and no figure can be traced
 * back to a member.
 *
 * Pure and deterministic: rows and the clock come from the caller.
 */

import type { AnalyticsInvitation, AnalyticsMember } from "./analytics";
import type { AiUsageRow } from "./ai-operations";

export type PeriodKey = "7" | "30" | "90" | "custom";

export interface Period {
  key: PeriodKey;
  /** Plain label for the page, e.g. "The last 30 days". */
  label: string;
  fromMs: number;
  toMs: number;
  /** Inclusive day count, rounded up. */
  days: number;
  /** True when the owner supplied both dates. */
  custom: boolean;
}

export interface PeriodResolution {
  period: Period | null;
  /** Plain-language reason the period could not be used, or null. */
  error: string | null;
}

const DAY = 86_400_000;
export const PERIOD_KEYS: PeriodKey[] = ["7", "30", "90", "custom"];
export const MAX_CUSTOM_DAYS = 366;

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function parseDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const ms = new Date(`${text}T00:00:00.000Z`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Resolve the reporting period from the URL. A custom range needs BOTH dates; a half-entered
 * range is refused with a plain sentence instead of silently falling back to 30 days, because a
 * figure under the wrong heading is worse than no figure.
 */
export function resolvePeriod(input: {
  key?: string | null;
  from?: string | null;
  to?: string | null;
  now?: number;
}): PeriodResolution {
  const now = input.now ?? Date.now();
  const key = (input.key ?? "30").trim();

  if (key === "custom") {
    const from = parseDay(input.from);
    const to = parseDay(input.to);
    if (from === null || to === null) {
      return {
        period: null,
        error:
          "A custom period needs both a start date and an end date. Choose both, or pick one of the ready-made periods.",
      };
    }
    if (to < from) {
      return { period: null, error: "The end date is before the start date. Swap them and try again." };
    }
    const days = Math.floor((startOfUtcDay(to) - startOfUtcDay(from)) / DAY) + 1;
    if (days > MAX_CUSTOM_DAYS) {
      return {
        period: null,
        error: `A custom period can cover at most ${MAX_CUSTOM_DAYS} days. Choose a shorter range.`,
      };
    }
    if (from > startOfUtcDay(now) + DAY) {
      return { period: null, error: "That period starts in the future, so nothing can be counted in it." };
    }
    return {
      period: {
        key: "custom",
        label: `From ${new Date(from).toISOString().slice(0, 10)} to ${new Date(to).toISOString().slice(0, 10)}`,
        fromMs: from,
        toMs: to + DAY,
        days,
        custom: true,
      },
      error: null,
    };
  }

  const days = key === "7" ? 7 : key === "90" ? 90 : 30;
  const resolvedKey: PeriodKey = key === "7" ? "7" : key === "90" ? "90" : "30";
  const toMs = now;
  return {
    period: {
      key: resolvedKey,
      label: days === 7 ? "The last 7 days" : days === 90 ? "The last 90 days" : "The last 30 days",
      fromMs: now - days * DAY,
      toMs,
      days,
      custom: false,
    },
    error: null,
  };
}

export function withinPeriod(value: string | null | undefined, period: Period): boolean {
  if (!value) return false;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return false;
  return ms >= period.fromMs && ms <= period.toMs;
}

export interface PeriodSummary {
  /** People who joined inside the period. */
  newMembers: number;
  /** People with a recorded activity inside the period. Not sign-ins. */
  activeMembers: number;
  /** Invitations issued inside the period. */
  invitationsIssued: number;
  invitationsAccepted: number;
  /** Invitations still waiting, whatever their age - a backlog is not a period figure. */
  invitationsPendingNow: number;
  invitationsRevoked: number;
  /** Null when nothing was issued in the period. */
  acceptancePercent: number | null;
  byRole: Array<{ role: string; count: number }>;
  byCondition: Array<{ condition: string; count: number }>;
}

/** Membership figures, all constrained to the chosen period where the record allows it. */
export function summarizePeriod(
  members: readonly AnalyticsMember[],
  invitations: readonly AnalyticsInvitation[],
  period: Period,
): PeriodSummary {
  let newMembers = 0;
  let activeMembers = 0;
  for (const m of members) {
    if (withinPeriod(m.created_at, period)) newMembers += 1;
    if (withinPeriod(m.last_active_at, period)) activeMembers += 1;
  }

  const inPeriod = invitations.filter((i) => withinPeriod(i.created_at, period));
  const accepted = inPeriod.filter((i) => (i.status ?? "") === "accepted").length;
  const pendingNow = invitations.filter((i) => (i.status ?? "") === "pending").length;
  const revoked = inPeriod.filter((i) => (i.status ?? "") === "revoked").length;

  const roles = new Map<string, number>();
  const conditions = new Map<string, number>();
  for (const m of members) {
    const role = (m.role ?? "").trim() || "unknown";
    roles.set(role, (roles.get(role) ?? 0) + 1);
    const condition = (m.status ?? "").trim() || "unknown";
    conditions.set(condition, (conditions.get(condition) ?? 0) + 1);
  }

  return {
    newMembers,
    activeMembers,
    invitationsIssued: inPeriod.length,
    invitationsAccepted: accepted,
    invitationsPendingNow: pendingNow,
    invitationsRevoked: revoked,
    acceptancePercent: inPeriod.length === 0 ? null : Math.round((accepted / inPeriod.length) * 1000) / 10,
    byRole: [...roles.entries()].map(([role, count]) => ({ role, count })).sort((a, b) => b.count - a.count),
    byCondition: [...conditions.entries()]
      .map(([condition, count]) => ({ condition, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export interface AiDayPoint {
  /** UTC day, YYYY-MM-DD. */
  day: string;
  requests: number;
  succeeded: number;
  failed: number;
  /** Average of the MEASURED durations only; null when nothing was timed that day. */
  averageMs: number | null;
  measured: number;
}

export interface AiPeriodSummary {
  reading: "read" | "unavailable";
  reason: string | null;
  requests: number;
  succeeded: number;
  failed: number;
  successPercent: number | null;
  byProvider: Array<{ provider: string; requests: number; failed: number }>;
  /** One entry per day in the period that had activity; quiet days are not invented. */
  days: AiDayPoint[];
  /** True when at least one row carried a duration, so a time trend is meaningful. */
  timed: boolean;
  tokens: { in: number | null; out: number | null };
}

const EMPTY_AI: Omit<AiPeriodSummary, "reason"> = {
  reading: "read",
  requests: 0,
  succeeded: 0,
  failed: 0,
  successPercent: null,
  byProvider: [],
  days: [],
  timed: false,
  tokens: { in: null, out: null },
};

/** Aggregate the AI usage rows inside the period. Null rows mean "could not read", not zero. */
export function summarizeAiPeriod(rows: readonly AiUsageRow[] | null, period: Period, reason?: string | null): AiPeriodSummary {
  if (!rows) {
    return {
      ...EMPTY_AI,
      reading: "unavailable",
      reason:
        reason ??
        "Sophira could not read its own AI activity record just now, so no figure is shown. That is not a statement that the AI was idle.",
      byProvider: [],
      days: [],
    };
  }

  const inPeriod = rows.filter((r) => withinPeriod(r.created_at, period));
  const byDay = new Map<string, { requests: number; succeeded: number; failed: number; total: number; measured: number }>();
  const providers = new Map<string, { requests: number; failed: number }>();
  let succeeded = 0;
  let failed = 0;
  let measuredAny = false;
  let tokensIn: number | null = null;
  let tokensOut: number | null = null;

  for (const row of inPeriod) {
    const ok = row.ok === true;
    if (ok) succeeded += 1;
    else if (row.ok === false) failed += 1;

    const provider = (row.provider ?? "").trim() || "unknown";
    const p = providers.get(provider) ?? { requests: 0, failed: 0 };
    p.requests += 1;
    if (row.ok === false) p.failed += 1;
    providers.set(provider, p);

    if (typeof row.tokens_in === "number" && Number.isFinite(row.tokens_in) && row.tokens_in >= 0) {
      tokensIn = (tokensIn ?? 0) + row.tokens_in;
    }
    if (typeof row.tokens_out === "number" && Number.isFinite(row.tokens_out) && row.tokens_out >= 0) {
      tokensOut = (tokensOut ?? 0) + row.tokens_out;
    }

    const created = row.created_at ? new Date(row.created_at) : null;
    if (!created || Number.isNaN(created.getTime())) continue;
    const day = created.toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? { requests: 0, succeeded: 0, failed: 0, total: 0, measured: 0 };
    bucket.requests += 1;
    if (ok) bucket.succeeded += 1;
    if (row.ok === false) bucket.failed += 1;
    const ms = row.latency_ms;
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= 3_600_000) {
      bucket.total += ms;
      bucket.measured += 1;
      measuredAny = true;
    }
    byDay.set(day, bucket);
  }

  const days = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, b]) => ({
      day,
      requests: b.requests,
      succeeded: b.succeeded,
      failed: b.failed,
      averageMs: b.measured === 0 ? null : Math.round(b.total / b.measured),
      measured: b.measured,
    }));

  return {
    reading: "read",
    reason: null,
    requests: inPeriod.length,
    succeeded,
    failed,
    successPercent: inPeriod.length === 0 ? null : Math.round((succeeded / inPeriod.length) * 1000) / 10,
    byProvider: [...providers.entries()]
      .map(([provider, v]) => ({ provider, requests: v.requests, failed: v.failed }))
      .sort((a, b) => b.requests - a.requests),
    days,
    timed: measuredAny,
    tokens: { in: tokensIn, out: tokensOut },
  };
}

export interface DeliverySummary {
  /** Invitations whose email was reported sent. */
  sent: number;
  failed: number;
  /** No mail provider is configured, so nothing was sent (and nothing is broken). */
  notConfigured: number;
  /** Invitations from before delivery reporting existed, or issued by copying a link. */
  unrecorded: number;
  /** Null when no invitation carries a delivery result at all. */
  deliveryRatePercent: number | null;
}

/**
 * Invitation DELIVERY, from the recorded status on each invitation. A copied link or an
 * invitation created before delivery reporting existed has no status, and is counted as
 * unrecorded rather than as a failure.
 */
export function summarizeDelivery(invitations: readonly AnalyticsInvitation[]): DeliverySummary {
  let sent = 0;
  let failed = 0;
  let notConfigured = 0;
  let unrecorded = 0;
  for (const inv of invitations) {
    const status = (inv.email_status ?? "").trim();
    if (status === "sent") sent += 1;
    else if (status === "failed") failed += 1;
    else if (status === "not_configured") notConfigured += 1;
    else unrecorded += 1;
  }
  const attempted = sent + failed + notConfigured;
  return {
    sent,
    failed,
    notConfigured,
    unrecorded,
    deliveryRatePercent: attempted === 0 ? null : Math.round((sent / attempted) * 1000) / 10,
  };
}

export interface FeatureFootprint {
  key: string;
  label: string;
  /** Stored rows for this feature, or null when the table could not be read. */
  count: number | null;
  /** What the number means, in the owner's words. */
  detail: string;
}

/** A footprint entry that Sophira genuinely does not measure, said plainly. */
export function notMeasured(key: string, label: string, detail: string): FeatureFootprint {
  return { key, label, count: null, detail };
}

export function formatMs(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}
