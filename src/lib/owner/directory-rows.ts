/**
 * DIRECTORY ROWS, NORMALISED (2026-11-13).
 *
 * The database function that feeds the Members page declares its columns with an `o_` prefix
 * (o_user_id, o_status, o_presence_state, ...) because they are OUTPUT columns of a table-returning
 * function. Every screen, however, speaks in plain names (user_id, status, presence). The two
 * shapes were being reconciled by a TypeScript cast, which asserts a shape rather than checking
 * it: if the prefix ever reaches the browser, a cast cannot notice, and a member row silently
 * loses its name, its role and its presence state while the page still renders.
 *
 * This turns that assumption into code. It accepts either shape, maps the known fields, and
 * refuses to invent the ones that are absent. Nothing is dropped silently: an unrecognised row
 * still yields a member (a member must never disappear from the directory because a column was
 * spelled unexpectedly), with the missing pieces reported as missing.
 *
 * Pure: no database, no clock, no side effects.
 */

import type { NetworkMemberStats } from "../types";

type Row = Record<string, unknown>;

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function bool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

/** A timestamp worth showing, or null. A malformed value is missing, never "Invalid Date". */
function stamp(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : raw;
}

function pick(row: Row, ...keys: string[]): unknown {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  return undefined;
}

export interface DirectoryRowResult {
  members: NetworkMemberStats[];
  /** Fields the database sent that Sophira does not understand. Kept for diagnostics only. */
  unknownKeys: string[];
  /** Rows that carried no identifier and therefore could not become a member. */
  dropped: number;
}

/**
 * Map one row from either shape. Returns null only when there is no identifier at all: an
 * account without an id cannot be managed or matched, and inventing one would be worse.
 */
export function normalizeDirectoryRow(row: Row): NetworkMemberStats | null {
  if (!row || typeof row !== "object") return null;
  const userId = text(pick(row, "user_id", "o_user_id"));
  if (!userId) return null;

  const presenceObject = (pick(row, "presence") ?? null) as Row | null;
  const presenceState = text(pick(row, "presence_state", "o_presence_state")) ?? text(presenceObject?.state);
  const presenceSessions =
    typeof pick(row, "presence_sessions", "o_presence_sessions") === "number"
      ? (pick(row, "presence_sessions", "o_presence_sessions") as number)
      : typeof presenceObject?.session_count === "number"
        ? (presenceObject.session_count as number)
        : null;
  const presenceLast =
    stamp(pick(row, "presence_last_interaction", "o_presence_last_interaction")) ??
    stamp(presenceObject?.last_interaction);

  return {
    user_id: userId,
    display_name: text(pick(row, "display_name", "o_display_name")) ?? "",
    email: text(pick(row, "email", "o_email")),
    phone: text(pick(row, "phone", "o_phone")),
    phone_verified: bool(pick(row, "phone_verified", "o_phone_verified")),
    // A role Sophira does not recognise is left as the database sent it; roleLabel() already
    // words an unknown role honestly rather than promoting it.
    role: (text(pick(row, "role", "o_role")) ?? "user") as NetworkMemberStats["role"],
    status: (text(pick(row, "status", "o_status")) ?? "active") as NetworkMemberStats["status"],
    access_revoked_at: stamp(pick(row, "access_revoked_at", "o_access_revoked_at")),
    onboarded: bool(pick(row, "onboarded", "o_onboarded")) ?? false,
    can_request_invites: bool(pick(row, "can_request_invites", "o_can_request_invites")) ?? false,
    created_at: stamp(pick(row, "created_at", "o_created_at")) ?? "",
    last_active_at: stamp(pick(row, "last_active_at", "o_last_active_at")),
    presence: presenceState
      ? { state: presenceState, session_count: presenceSessions, last_interaction: presenceLast }
      : null,
    manual_availability: text(pick(row, "manual_availability", "o_manual_availability")),
  } as NetworkMemberStats;
}

const KNOWN_KEYS = new Set([
  "user_id", "display_name", "email", "phone", "phone_verified", "role", "status",
  "access_revoked_at", "onboarded", "can_request_invites", "created_at", "last_active_at",
  "presence", "manual_availability",
  "o_user_id", "o_display_name", "o_email", "o_phone", "o_phone_verified", "o_role", "o_status",
  "o_access_revoked_at", "o_onboarded", "o_can_request_invites", "o_created_at", "o_last_active_at",
  "o_presence_state", "o_presence_sessions", "o_presence_last_interaction", "o_manual_availability",
]);

export function normalizeDirectoryRows(rows: readonly Row[] | null | undefined): DirectoryRowResult {
  if (!Array.isArray(rows)) return { members: [], unknownKeys: [], dropped: 0 };
  const members: NetworkMemberStats[] = [];
  const unknown = new Set<string>();
  let dropped = 0;
  for (const row of rows) {
    const member = normalizeDirectoryRow(row as Row);
    if (!member) {
      dropped += 1;
      continue;
    }
    members.push(member);
    for (const key of Object.keys(row as Row)) {
      if (!KNOWN_KEYS.has(key)) unknown.add(key);
    }
  }
  return { members, unknownKeys: [...unknown].sort(), dropped };
}
