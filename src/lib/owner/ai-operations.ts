/**
 * AI OPERATIONS (2026-11-13).
 *
 * The owner could already see WHICH AI provider is configured (the provider diagnostics card)
 * and how many requests succeeded (provider_usage, migration 0021). Two questions had no
 * answer anywhere: "how slow is it?" and "is that number from a measurement or from nothing?"
 *
 * This module turns the rows Sophira already stores into an operations report, and it is
 * deliberately strict about three things:
 *
 *   1. NOT MEASURED IS NOT ZERO. A request with no recorded duration is counted as unmeasured
 *      and kept OUT of the average and the percentiles, so an un-instrumented week cannot make
 *      the AI look instantly fast.
 *   2. NO INVENTED MONEY. Cost is reported as "not available" unless a real invoice-derived
 *      figure is supplied. Token counts are shown as counts, never converted into a price with
 *      a guessed rate card.
 *   3. NO CONTENT. A row is provider, model, success, duration and token counts. Nothing here
 *      can read a prompt, an answer, or who asked.
 *
 * Pure and deterministic: every function takes its rows and its clock, so the numbers in the
 * Owner's page can be reproduced exactly in a test.
 */

export interface AiUsageRow {
  provider?: string | null;
  model?: string | null;
  ok?: boolean | null;
  /** Milliseconds for THIS attempt. Absent or null means "not measured". */
  latency_ms?: number | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  created_at?: string | null;
}

export interface LatencySummary {
  /** Attempts that carried a usable duration. */
  measured: number;
  /** Attempts with no duration - excluded from every statistic below. */
  unmeasured: number;
  averageMs: number | null;
  medianMs: number | null;
  p95Ms: number | null;
  slowestMs: number | null;
}

export interface ProviderSummary {
  provider: string;
  model: string;
  requests: number;
  succeeded: number;
  failed: number;
  /** Null when there were no requests at all - not 0%, and not 100%. */
  successPercent: number | null;
  latency: LatencySummary;
  tokensIn: number | null;
  tokensOut: number | null;
}

export type Reading = "read" | "unavailable";

export interface AiOperationsReport {
  windowDays: number;
  reading: Reading;
  /** Plain-language explanation when the reading is unavailable. Never an error code. */
  unavailableReason: string | null;
  totals: {
    requests: number;
    succeeded: number;
    failed: number;
    successPercent: number | null;
  };
  latency: LatencySummary;
  byProvider: ProviderSummary[];
  /** Token counts actually stored. Null when no row carried them. */
  tokens: { in: number | null; out: number | null };
  cost: { available: false; detail: string };
  quota: { available: false; detail: string };
}

const EMPTY_LATENCY: LatencySummary = {
  measured: 0, unmeasured: 0, averageMs: null, medianMs: null, p95Ms: null, slowestMs: null,
};

const MS_LIMIT = 60 * 60 * 1000; // an hour; anything beyond it is not a response time

/** A duration we are willing to average: a real, non-negative, humanly plausible number. */
function usableDuration(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > MS_LIMIT) return null;
  return Math.round(value);
}

/** Nearest-rank percentile over the MEASURED values only. */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

export function summarizeLatency(rows: readonly AiUsageRow[]): LatencySummary {
  const values: number[] = [];
  let unmeasured = 0;
  for (const row of rows) {
    const ms = usableDuration(row?.latency_ms);
    if (ms === null) unmeasured += 1;
    else values.push(ms);
  }
  if (values.length === 0) return { ...EMPTY_LATENCY, unmeasured };
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, v) => sum + v, 0);
  return {
    measured: sorted.length,
    unmeasured,
    averageMs: Math.round(total / sorted.length),
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    slowestMs: sorted[sorted.length - 1],
  };
}

function sumOrNull(values: Array<number | null | undefined>): number | null {
  let total = 0;
  let seen = false;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      total += v;
      seen = true;
    }
  }
  return seen ? total : null;
}

function percent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export function summarizeProvider(provider: string, model: string, rows: readonly AiUsageRow[]): ProviderSummary {
  const succeeded = rows.filter((r) => r?.ok === true).length;
  const failed = rows.length - succeeded;
  return {
    provider,
    model,
    requests: rows.length,
    succeeded,
    failed,
    successPercent: percent(succeeded, rows.length),
    latency: summarizeLatency(rows),
    tokensIn: sumOrNull(rows.map((r) => r?.tokens_in)),
    tokensOut: sumOrNull(rows.map((r) => r?.tokens_out)),
  };
}

export interface AiOperationsInput {
  rows: readonly AiUsageRow[] | null;
  /** Why the rows could not be read, already in plain language. */
  unavailableReason?: string | null;
  windowDays?: number;
}

/**
 * The full report. `rows: null` means the usage table could not be read - which is reported as
 * unavailable, NOT as "no AI requests were made".
 */
export function buildAiOperationsReport(input: AiOperationsInput): AiOperationsReport {
  const windowDays = input.windowDays ?? 30;
  const base = {
    windowDays,
    cost: {
      available: false as const,
      detail:
        "Sophira does not store a provider invoice, so it cannot state what this month cost. " +
        "It will not guess from token counts: a guessed rate would look like a real charge. " +
        "Your provider's own billing page is the only truthful source for money.",
    },
    quota: {
      available: false as const,
      detail:
        "Neither Google nor OpenAI publishes remaining free-tier quota through its API, so " +
        "Sophira cannot show a number here. When a free tier runs out, the request is refused " +
        "and the failure is counted above.",
    },
  } satisfies Pick<AiOperationsReport, "windowDays" | "cost" | "quota">;

  if (!input.rows) {
    return {
      ...base,
      reading: "unavailable",
      unavailableReason:
        input.unavailableReason ??
        "Sophira could not read its own AI activity record just now. That does not mean no AI requests were made - it means this page cannot see them.",
      totals: { requests: 0, succeeded: 0, failed: 0, successPercent: null },
      latency: { ...EMPTY_LATENCY },
      byProvider: [],
      tokens: { in: null, out: null },
    };
  }

  const rows = input.rows;
  const succeeded = rows.filter((r) => r?.ok === true).length;
  const groups = new Map<string, AiUsageRow[]>();
  for (const row of rows) {
    const provider = (row?.provider ?? "").trim() || "unknown";
    const model = (row?.model ?? "").trim() || "model not recorded";
    const key = `${provider}\u0000${model}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const byProvider = [...groups.entries()]
    .map(([key, group]) => {
      const [provider, model] = key.split("\u0000");
      return summarizeProvider(provider, model, group);
    })
    .sort((a, b) => b.requests - a.requests || a.provider.localeCompare(b.provider));

  return {
    ...base,
    reading: "read",
    unavailableReason: null,
    totals: {
      requests: rows.length,
      succeeded,
      failed: rows.length - succeeded,
      successPercent: percent(succeeded, rows.length),
    },
    latency: summarizeLatency(rows),
    byProvider,
    tokens: {
      in: sumOrNull(rows.map((r) => r?.tokens_in)),
      out: sumOrNull(rows.map((r) => r?.tokens_out)),
    },
  };
}

/* ------------------------------------------------------------------ */
/* DISPLAY HELPERS - one place that decides how a missing number reads  */
/* ------------------------------------------------------------------ */

export const NOT_AVAILABLE = "Not available";

/** A duration, or an honest statement that it was not measured. */
export function formatDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return NOT_AVAILABLE;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)} seconds`;
  if (seconds < 120) return `${Math.round(seconds)} seconds`;
  return `${(seconds / 60).toFixed(1)} minutes`;
}

export function formatPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return NOT_AVAILABLE;
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return NOT_AVAILABLE;
  return value.toLocaleString("en-US");
}

/**
 * The sentence under the AI section: what the numbers actually cover.
 *
 * A quiet, all-green week and a week with no instrumentation at all must never read the same,
 * so an empty record says so out loud instead of showing a tidy row of zeros.
 */
export function describeAiActivity(report: AiOperationsReport): string {
  if (report.reading === "unavailable") {
    return "AI activity could not be read. Nothing below is a measurement.";
  }
  if (report.totals.requests === 0) {
    return `No AI requests have been recorded in the last ${report.windowDays} days. That is a real zero: the record was read and it is empty.`;
  }
  const latencyNote =
    report.latency.measured === 0
      ? "No response time has been measured yet, so none is shown."
      : `Response time comes from ${formatCount(report.latency.measured)} measured ${
          report.latency.measured === 1 ? "request" : "requests"
        }.`;
  return `${formatCount(report.totals.requests)} AI ${
    report.totals.requests === 1 ? "request" : "requests"
  } recorded, ${formatCount(report.totals.succeeded)} successful. ${latencyNote}`;
}
