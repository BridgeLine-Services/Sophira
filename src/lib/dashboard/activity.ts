import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityDayRow } from "./overview";

/**
 * THE STAFF-GATED PER-DAY READ, IN ONE PLACE (2026-11-12).
 *
 * Owner and Co-Owner both draw sign-ups against study activity, and both must behave the same
 * way when the database cannot answer. Keeping the read here means the two pages cannot drift,
 * and it keeps the awkward part - deciding what an error MEANS - testable without a browser.
 *
 * `needsDatabaseUpdate` is the honest distinction: a function that is not in the database yet
 * (PostgREST PGRST202, "could not find the function ... in the schema cache") is not the same
 * fact as a read that failed. The first is a setup step the owner can complete from the
 * dashboard; the second is a fault. Telling someone "we couldn't read this" when the real
 * answer is "press Update database" makes them hunt for a bug that does not exist.
 */
export interface ActivitySeriesRead {
  rows: ActivityDayRow[];
  unreadable: boolean;
  /** The function is not installed yet, so the database has never been asked the question. */
  needsDatabaseUpdate: boolean;
}

const MISSING_FUNCTION_CODES = new Set(["PGRST202", "42883"]);

function looksMissingFunction(code: string, message: string): boolean {
  if (MISSING_FUNCTION_CODES.has(code)) return true;
  const text = message.toLowerCase();
  return (
    text.includes("could not find the function") ||
    (text.includes("function public.network_activity_daily") && text.includes("does not exist")) ||
    text.includes("schema cache")
  );
}

/**
 * Reads public.network_activity_daily(days).
 *
 * Rows are validated field by field rather than cast: a member id or a missing column must never
 * reach a chart, and a non-numeric count becomes zero instead of NaN leaking into an SVG
 * coordinate. Rows outside the window are the caller's problem (dailySeries drops them).
 */
export async function readActivityDaily(
  supabase: SupabaseClient,
  days = 14,
): Promise<ActivitySeriesRead> {
  const { data, error } = await supabase.rpc("network_activity_daily", { p_days: days });
  if (error) {
    const code = String((error as { code?: unknown }).code ?? "");
    const message = String(error.message ?? "");
    return { rows: [], unreadable: true, needsDatabaseUpdate: looksMissingFunction(code, message) };
  }
  const rows = (Array.isArray(data) ? data : [])
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .filter((row) => typeof row.day === "string" && row.day.length >= 10)
    .map((row) => ({
      day: String(row.day).slice(0, 10),
      signups: countOf(row.signups),
      study_sessions: countOf(row.study_sessions),
      answers: countOf(row.answers),
    }));
  return { rows, unreadable: false, needsDatabaseUpdate: false };
}

function countOf(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}
