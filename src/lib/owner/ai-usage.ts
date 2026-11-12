import type { AiUsageRow } from "@/lib/owner/ai-operations";

/**
 * READING SOPHIRA'S OWN AI RECORD (2026-11-13).
 *
 * One loader, used by the AI Operations page and by the overview's "needs attention" list, so the
 * two can never disagree about how many requests failed. It reads provider_usage through the
 * privileged server client - the table has RLS on with no policies, so nothing in a browser can
 * reach it - and returns rows AND an honest reason whenever it could not.
 *
 * Three refusals, all deliberate:
 *   - a database that has not taken migration 0052 still answers: the second query omits the
 *     duration column, and the caller is told response time is simply not measured yet;
 *   - a failed read returns null rows, never an empty array, because "we could not look" and
 *     "nothing happened" must never look alike;
 *   - a deployment without a privileged client says so, rather than reporting zero activity.
 *
 * Nothing here reads a prompt, an answer or any member's work: a row is a provider, a model, a
 * success flag, a duration and token counts.
 */

export const AI_USAGE_WINDOW_DAYS = 30;
export const AI_USAGE_MAX_ROWS = 5000;

export interface AiUsageRead {
  rows: AiUsageRow[] | null;
  /** Plain-language reason why rows are null. Never shown when rows were read. */
  reason: string | null;
  /** A truthful note about a partial read (for example: durations not recorded yet). */
  note: string | null;
}

export async function loadAiUsage(options: {
  windowDays?: number;
  maxRows?: number;
  /** Injectable for tests; defaults to the real privileged client. */
  createClient?: () => Promise<unknown>;
} = {}): Promise<AiUsageRead> {
  const windowDays = options.windowDays ?? AI_USAGE_WINDOW_DAYS;
  const maxRows = options.maxRows ?? AI_USAGE_MAX_ROWS;

  try {
    const createAdminClient =
      (options.createClient as undefined | (() => Promise<unknown>)) ??
      (async () => {
        const mod = await import("@/lib/supabase/admin");
        return mod.createAdminClient();
      });
    const admin = (await createAdminClient()) as {
      from: (table: string) => {
        select: (columns: string) => {
          gte: (column: string, value: string) => {
            order: (column: string, opts: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: unknown; error: { message?: string } | null }>;
            };
          };
        };
      };
    };

    const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

    const withLatency = await admin
      .from("provider_usage")
      .select("provider, model, ok, latency_ms, tokens_in, tokens_out, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(maxRows);
    if (!withLatency.error) {
      return { rows: (withLatency.data ?? []) as AiUsageRow[], reason: null, note: null };
    }

    const withoutLatency = await admin
      .from("provider_usage")
      .select("provider, model, ok, tokens_in, tokens_out, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(maxRows);
    if (!withoutLatency.error) {
      return {
        rows: (withoutLatency.data ?? []) as AiUsageRow[],
        reason: null,
        note:
          "Response time has not been recorded yet because this database has not taken its newest update. " +
          "Request counts are complete; the times are shown as not available rather than as zero.",
      };
    }

    return {
      rows: null,
      reason:
        "Sophira could not read its own AI activity record just now. Nothing has been changed, and this is not a statement that no AI requests were made.",
      note: null,
    };
  } catch {
    return {
      rows: null,
      reason:
        "This deployment cannot read Sophira's AI activity record, so no count is shown. That is a limitation of where Sophira is running, not evidence that the AI is idle.",
      note: null,
    };
  }
}

/** Failed requests in the rows that were read, or null when nothing could be read. */
export function countAiFailures(rows: readonly AiUsageRow[] | null): number | null {
  if (!rows) return null;
  return rows.filter((row) => row.ok === false).length;
}
