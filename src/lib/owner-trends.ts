/**
 * KPI TRENDS (2026-11-03).
 *
 * A trend is only shown when Sophira actually stores the timestamp behind it. There is no
 * usage history or token metering in this system, so none is invented: these lines count
 * records created or revoked inside a fixed window and say so in plain words.
 */
export interface TrendInput {
  members?: Array<{ created_at: string; access_revoked_at: string | null }>;
  invitations?: Array<{ created_at: string }>;
  requests?: Array<{ created_at: string }>;
  now?: number;
  days?: number;
}

export interface TrendLines {
  members: string;
  active: string;
  invitations: string;
  requests: string;
}

function within(iso: string | null | undefined, from: number, to: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= from && t <= to;
}

function countBetween(items: Array<{ at: string | null }>, from: number, to: number): number {
  return items.filter((i) => within(i.at, from, to)).length;
}

function phrase(n: number, singular: string, window: string): string {
  if (n === 0) return `No change ${window}`;
  return `${n} ${singular} ${window}`;
}

export function buildTrends(input: TrendInput): TrendLines {
  const days = Math.min(Math.max(Math.trunc(input.days ?? 30), 1), 3650);
  const to = input.now ?? Date.now();
  const from = to - days * 24 * 60 * 60 * 1000;
  const window = `in the last ${days} days`;

  const members = input.members ?? [];
  const joined = countBetween(members.map((m) => ({ at: m.created_at })), from, to);
  const revoked = countBetween(members.map((m) => ({ at: m.access_revoked_at })), from, to);

  return {
    members: phrase(joined, joined === 1 ? "person joined" : "people joined", window),
    active:
      joined === 0 && revoked === 0
        ? `No change ${window}`
        : `${joined} joined, ${revoked} ${revoked === 1 ? "revoked" : "revoked"} ${window}`,
    invitations: phrase(
      countBetween((input.invitations ?? []).map((i) => ({ at: i.created_at })), from, to),
      "sent",
      window,
    ),
    requests: phrase(
      countBetween((input.requests ?? []).map((r) => ({ at: r.created_at })), from, to),
      "received",
      window,
    ),
  };
}
