/**
 * WHEN THE DATABASE IS OLDER THAN THE CODE (2026-11-12).
 *
 * Sophira ships code and database changes separately. The code deploys on merge; the
 * database is updated when the Owner presses "Update database" in /owner/database. So
 * there is always a window where a page asks for a table, a column or a function that
 * the live database does not have yet.
 *
 * During that window Supabase does not throw: it returns { data: null, error }. A page
 * that writes `data ?? []` then shows a confident empty state ("you have not written
 * anything yet") when the truth is "this could not be read". That is the defect this
 * module exists to prevent - the same honesty rule the dashboard follows, applied to
 * schema lag.
 *
 * This file answers ONE question, in one place, so every page asks it the same way: is
 * this error "the database has not been given that part yet" (a known, fixable,
 * one-click condition) or is it a real failure (permissions, a dropped connection, a bad
 * request) that must not be dressed up as a setup step?
 *
 * It is deliberately conservative: an unrecognised error is NOT treated as schema lag.
 */

/** The shape Supabase/PostgREST returns in `error` (all fields optional). */
export interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/**
 * Postgres and PostgREST codes that mean "that object is not there".
 *   42P01    undefined_table
 *   42703    undefined_column
 *   42883    undefined_function
 *   PGRST205 PostgREST could not find the table in its schema cache
 *   PGRST204 PostgREST could not find the column in its schema cache
 *   PGRST202 PostgREST could not find the function in its schema cache
 */
const MISSING_CODES = new Set(["42P01", "42703", "42883", "PGRST205", "PGRST204", "PGRST202"]);

/**
 * The wording Postgres and PostgREST use for a missing object. Used only when the code is
 * absent (older clients). It never widens the check to permission or connection errors,
 * which have their own wording - see the guard below.
 */
const MISSING_WORDING =
  /(relation|table|column|function)\s+"?[A-Za-z_][A-Za-z0-9_.]*"?\s+does not exist|schema cache/i;

/** True only for "the database has not been given this part yet". */
export function needsDatabaseUpdate(error: PostgrestErrorLike | null | undefined): boolean {
  if (!error) return false;
  const text = [error.message, error.details, error.hint].filter(Boolean).join(" ");
  /*
   * The refusal guard runs FIRST, even when a missing-object code is present: an error that
   * says "permission denied" or "JWT expired" is never turned into "press update", because
   * pressing update cannot fix it and the reader would be sent to the wrong place.
   */
  if (/permission denied|not authorized|row-level security|jwt|invalid api key|timeout|fetch failed/i.test(text)) {
    return false;
  }
  const code = (error.code ?? "").trim().toUpperCase();
  if (code && MISSING_CODES.has(code)) return true;
  if (!text) return false;
  return MISSING_WORDING.test(text);
}

/**
 * The name of the missing object, stripped of its schema, so a message can say "the
 * qa_reports table" instead of "public.qa_reports". Null when the error does not name one.
 */
export function missingObjectName(error: PostgrestErrorLike | null | undefined): string | null {
  if (!needsDatabaseUpdate(error)) return null;
  const text = [error?.message, error?.details, error?.hint].filter(Boolean).join(" ");
  const patterns = [
    /(?:relation|table|column|function)\s+"([^"]+)"/i,
    /could not find the (?:table|column|function)\s+'([^']+)'/i,
    /(?:relation|table|column|function)\s+([A-Za-z_][A-Za-z0-9_.]*)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const raw = match?.[1];
    if (raw) return raw.split(".").pop() ?? raw;
  }
  return null;
}

/**
 * One plain sentence naming what could not be read, for the notice's small print.
 * Never includes a driver code or a stack trace.
 */
export function missingObjectSentence(error: PostgrestErrorLike | null | undefined): string {
  const name = missingObjectName(error);
  if (!name) return "One part of the database is not there yet.";
  return `What is missing: the ${name} ${/s$/i.test(name) ? "records" : "table"}.`;
}
