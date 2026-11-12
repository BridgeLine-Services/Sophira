/**
 * SECURITY HISTORY, SEARCHABLE AND PAGED (2026-11-11).
 *
 * The history started as "the last 200 role changes, filtered in the browser". That is the wrong
 * shape twice over: an owner searching for something that happened last month gets nothing,
 * and loading every record into a browser to filter it is both slow and more exposure than the
 * question needs.
 *
 * This module asks the database for ONE page of matching records, with the filters applied
 * server-side:
 *   - a date range,
 *   - the kind of event,
 *   - which administrator,
 *   - which member,
 *   - allowed or refused.
 *
 * Two rules carried over from the first version, because they are the reason the page exists:
 *   - a REFUSED action is a record, not a gap;
 *   - a filter that matches nobody says so, rather than implying a quiet history.
 *
 * WHAT IS NOT HERE: Sophira records role changes (and the refusals of role changes). Sign-ins,
 * invitation emails, suspensions and integration changes are NOT written to this table yet, and
 * the page says so instead of pretending the absence means "nothing happened".
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { roleLabel } from "../roles";

export const AUDIT_PAGE_SIZE = 25;

/** The actions this table records today. Kept as a list so the filter cannot offer a false one. */
export const RECORDED_ACTIONS: Array<{ value: string; label: string }> = [
  { value: "set_role", label: "Role change" },
];

export interface AuditFilters {
  search: string;
  action: string | null;
  actorId: string | null;
  targetId: string | null;
  /** "allowed" | "refused" | null for both. */
  outcome: "allowed" | "refused" | null;
  /** YYYY-MM-DD, inclusive. */
  from: string | null;
  to: string | null;
  page: number;
}

export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  actorId: string;
  targetId: string;
  actorName: string;
  targetName: string;
  fromRole: string;
  toRole: string;
  success: boolean;
  reason: string | null;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
  page: number;
  pageCount: number;
  /** False when the table itself is not there (a database that has not taken migration 0048). */
  available: boolean;
  /** Plain reason the read failed, when it did. */
  error: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function cleanDate(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (!DAY.test(text)) return null;
  const ms = new Date(`${text}T00:00:00.000Z`).getTime();
  return Number.isNaN(ms) ? null : text;
}

/**
 * Read the filters from the URL. Anything unrecognised is dropped rather than guessed: a filter
 * that silently means something else is worse than no filter.
 */
export function parseAuditFilters(params: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (key: string): string => {
    const value = params[key];
    if (Array.isArray(value)) return (value[0] ?? "").trim();
    return (value ?? "").trim();
  };
  const action = one("action");
  const actor = one("actor");
  const target = one("target");
  const outcome = one("outcome");
  const rawPage = Number.parseInt(one("page") || "1", 10);

  return {
    search: one("q").slice(0, 80),
    action: RECORDED_ACTIONS.some((a) => a.value === action) ? action : null,
    actorId: UUID.test(actor) ? actor : null,
    targetId: UUID.test(target) ? target : null,
    outcome: outcome === "allowed" ? "allowed" : outcome === "refused" ? "refused" : null,
    from: cleanDate(one("from")),
    to: cleanDate(one("to")),
    page: Number.isFinite(rawPage) && rawPage > 0 ? Math.min(rawPage, 10_000) : 1,
  };
}

/** True when any filter is active - used to word the empty state differently. */
export function hasFilters(filters: AuditFilters): boolean {
  return Boolean(
    filters.search || filters.action || filters.actorId || filters.targetId || filters.outcome || filters.from || filters.to,
  );
}

export function describeAction(action: string): string {
  const found = RECORDED_ACTIONS.find((a) => a.value === action);
  if (found) return found.label;
  return action.replace(/_/g, " ");
}

const GONE = "Someone no longer in your network";

export async function loadAuditPage(
  supabase: SupabaseClient,
  names: Map<string, string>,
  filters: AuditFilters,
): Promise<AuditQueryResult> {
  const from = (filters.page - 1) * AUDIT_PAGE_SIZE;
  const to = from + AUDIT_PAGE_SIZE - 1;

  let query = supabase
    .from("membership_audit")
    .select("id, actor_id, target_id, action, previous_role, new_role, success, failure_reason, created_at", {
      count: "exact",
    });

  if (filters.action) query = query.eq("action", filters.action);
  if (filters.actorId) query = query.eq("actor_id", filters.actorId);
  if (filters.targetId) query = query.eq("target_id", filters.targetId);
  if (filters.outcome) query = query.eq("success", filters.outcome === "allowed");
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00.000Z`);
  // Inclusive end date: everything before the NEXT midnight.
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00.000Z`).getTime() + 86_400_000;
    query = query.lt("created_at", new Date(end).toISOString());
  }
  // A name search is resolved to member ids BEFORE the query (the page does that from the roster
  // it already holds), so no free text is ever composed into a database filter.
  if (filters.search) {
    const ids = [...names.entries()]
      .filter(([, name]) => name.toLowerCase().includes(filters.search.toLowerCase()))
      .map(([id]) => id)
      .filter((id) => UUID.test(id));
    if (ids.length === 0) {
      return { entries: [], total: 0, page: filters.page, pageCount: 0, available: true, error: null };
    }
    query = query.or(`actor_id.in.(${ids.join(",")}),target_id.in.(${ids.join(",")})`);
  }

  const { data, error, count } = await query.order("created_at", { ascending: false }).range(from, to);

  if (error) {
    // A missing table is a database that has not taken its update; anything else is a failed read.
    const message = String(error.message ?? "").toLowerCase();
    const missing = message.includes("does not exist") || message.includes("could not find") || message.includes("schema cache");
    return {
      entries: [],
      total: 0,
      page: 1,
      pageCount: 0,
      available: !missing,
      error: missing ? null : "Sophira could not read the change history just now. Nothing has been changed.",
    };
  }

  const rows = Array.isArray(data) ? data : [];
  const total = typeof count === "number" ? count : rows.length;

  const entries: AuditEntry[] = rows.map((row: Record<string, unknown>) => {
    const actorId = String(row.actor_id ?? "");
    const targetId = String(row.target_id ?? "");
    return {
      id: String(row.id ?? ""),
      at: String(row.created_at ?? ""),
      action: String(row.action ?? ""),
      actorId,
      targetId,
      actorName: names.get(actorId) ?? GONE,
      targetName: names.get(targetId) ?? GONE,
      fromRole: roleLabel(String(row.previous_role ?? "")),
      toRole: roleLabel(String(row.new_role ?? "")),
      success: row.success !== false,
      reason: typeof row.failure_reason === "string" && row.failure_reason ? row.failure_reason : null,
    };
  });

  return {
    entries,
    total,
    page: filters.page,
    pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
    available: true,
    error: null,
  };
}

/** Build the page's own URL with one filter changed - used by the pagination links. */
export function auditHref(filters: AuditFilters, overrides: Partial<AuditFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.search) params.set("q", merged.search);
  if (merged.action) params.set("action", merged.action);
  if (merged.actorId) params.set("actor", merged.actorId);
  if (merged.targetId) params.set("target", merged.targetId);
  if (merged.outcome) params.set("outcome", merged.outcome);
  if (merged.from) params.set("from", merged.from);
  if (merged.to) params.set("to", merged.to);
  if (merged.page > 1) params.set("page", String(merged.page));
  const query = params.toString();
  return query ? `/owner/security?${query}` : "/owner/security";
}
