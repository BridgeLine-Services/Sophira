/**
 * MEMBER PRESENCE MODEL (2026-11-12).
 *
 * Presence answers "is this person at their screen right now?". It is NOT account
 * standing: a member can have a healthy Active account and be Offline, and a suspended
 * account must never look Online just because an old session row still exists.
 *
 * The two concepts are separate data (profiles.status vs member_presence rows), separate
 * functions, and separate columns in the directory. They are never merged into one field.
 *
 * Everything here is a PURE function of (sessions, manual preference, thresholds, now),
 * so the server, the client and the tests all reach the same verdict from the same input.
 * The server is authoritative: it computes the state it stores and returns.
 */

import type { PresenceThresholds } from "./thresholds";
import { DEFAULT_THRESHOLDS } from "./thresholds";

export const PRESENCE_STATES = [
  "active",
  "online",
  "idle",
  "away",
  "busy",
  "dnd",
  "offline",
  "unknown",
] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

export const MANUAL_AVAILABILITIES = ["available", "away", "busy", "dnd"] as const;
export type ManualAvailability = (typeof MANUAL_AVAILABILITIES)[number];

export interface PresenceSession {
  session_id: string;
  last_heartbeat: string | null;
  last_interaction: string | null;
  expires_at: string | null;
  connection_state?: string | null;
}

export interface PresenceInput {
  /** The member's account status (profiles.status). Suspended/unknown blocks presence. */
  accountStatus?: string | null;
  sessions: PresenceSession[];
  manualAvailability?: string | null;
  thresholds?: PresenceThresholds;
  now?: number;
}

export interface PresenceResult {
  state: PresenceState;
  /** Always rendered next to the colour: presence is never communicated by colour alone. */
  label: string;
  /** Hex used for the dot only. */
  color: string;
  /** One plain sentence explaining WHY, for the owner's benefit. */
  reason: string;
  /** True when at least one session is still valid (a genuine connection). */
  connected: boolean;
  /** Number of valid sessions (devices) right now. */
  sessionCount: number;
  /** Newest interaction across valid sessions, ISO or null. */
  lastInteraction: string | null;
}

const LABELS: Record<PresenceState, string> = {
  active: "Active",
  online: "Online",
  idle: "Idle",
  away: "Away",
  busy: "Busy",
  dnd: "Do Not Disturb",
  offline: "Offline",
  unknown: "Unknown",
};

/** Accessible palette: distinct hues, and every state also carries its written label. */
const COLORS: Record<PresenceState, string> = {
  active: "#15803d", // dark green
  online: "#22c55e", // green
  idle: "#d97706", // amber
  away: "#f97316", // orange
  busy: "#dc2626", // red-orange (danger)
  dnd: "#7c3aed", // purple
  offline: "#6b7280", // gray
  unknown: "#d1d5db", // light gray
};

export function presenceLabel(state: PresenceState): string {
  return LABELS[state] ?? "Unknown";
}

export function presenceColor(state: PresenceState): string {
  return COLORS[state] ?? COLORS.unknown;
}

export function normalizePresence(value: unknown): PresenceState {
  return (PRESENCE_STATES as readonly string[]).includes(String(value))
    ? (String(value) as PresenceState)
    : "unknown";
}

export function normalizeManualAvailability(value: unknown): ManualAvailability | null {
  const v = String(value ?? "");
  return (MANUAL_AVAILABILITIES as readonly string[]).includes(v) ? (v as ManualAvailability) : null;
}

/**
 * Account statuses that may show presence at all. This is a CLOSED allow-list, matching
 * the API guard's active-status rule: anything unknown fails closed and reads Offline
 * rather than Online.
 */
export const PRESENCE_ALLOWED_STATUSES: readonly string[] = ["active", "accepted", "pending"];

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function validSessions(input: PresenceInput, now: number, thresholds: PresenceThresholds): PresenceSession[] {
  return (input.sessions ?? []).filter((s) => {
    const beat = time(s.last_heartbeat);
    if (beat === null) return false;
    if (now - beat > thresholds.connectionTimeoutSeconds * 1000) return false;
    const expires = time(s.expires_at);
    if (expires !== null && expires <= now) return false;
    return true;
  });
}

function newestInteraction(sessions: PresenceSession[]): number | null {
  let newest: number | null = null;
  for (const s of sessions) {
    const t = time(s.last_interaction);
    if (t !== null && (newest === null || t > newest)) newest = t;
  }
  return newest;
}

/**
 * The single authority for "what should the directory show for this member?".
 *
 * Order of precedence:
 *   1. account standing (suspended/unknown → Offline or Unknown, never Online)
 *   2. a live connection at all (no valid session → Offline)
 *   3. the member's own preference (Away / Busy / Do Not Disturb)
 *   4. the freshest meaningful interaction across their devices
 */
export function computePresence(input: PresenceInput): PresenceResult {
  const now = input.now ?? Date.now();
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const status = String(input.accountStatus ?? "").toLowerCase();

  if (status && !PRESENCE_ALLOWED_STATUSES.includes(status)) {
    return {
      state: "offline",
      label: LABELS.offline,
      color: COLORS.offline,
      reason: "This account cannot be signed in, so it cannot be online.",
      connected: false,
      sessionCount: 0,
      lastInteraction: null,
    };
  }

  const sessions = validSessions(input, now, thresholds);
  if (sessions.length === 0) {
    return {
      state: "offline",
      label: LABELS.offline,
      color: COLORS.offline,
      reason: "No active session. Any earlier session has expired.",
      connected: false,
      sessionCount: 0,
      lastInteraction: null,
    };
  }

  const interaction = newestInteraction(sessions);
  const lastInteraction = interaction === null ? null : new Date(interaction).toISOString();
  const manual = normalizeManualAvailability(input.manualAvailability);

  if (manual === "dnd") {
    return {
      state: "dnd", label: LABELS.dnd, color: COLORS.dnd,
      reason: "Connected, and has set Do Not Disturb.", connected: true,
      sessionCount: sessions.length, lastInteraction,
    };
  }
  if (manual === "busy") {
    return {
      state: "busy", label: LABELS.busy, color: COLORS.busy,
      reason: "Connected, and has set Busy.", connected: true,
      sessionCount: sessions.length, lastInteraction,
    };
  }
  if (manual === "away") {
    return {
      state: "away", label: LABELS.away, color: COLORS.away,
      reason: "Connected, and has set Away.", connected: true,
      sessionCount: sessions.length, lastInteraction,
    };
  }

  if (interaction !== null) {
    const quiet = now - interaction;
    if (quiet <= thresholds.activeThresholdSeconds * 1000) {
      return {
        state: "active", label: LABELS.active, color: COLORS.active,
        reason: "Working in Sophira right now.", connected: true,
        sessionCount: sessions.length, lastInteraction,
      };
    }
    if (quiet <= thresholds.idleThresholdSeconds * 1000) {
      return {
        state: "idle", label: LABELS.idle, color: COLORS.idle,
        reason: "Connected, but no activity for a few minutes.", connected: true,
        sessionCount: sessions.length, lastInteraction,
      };
    }
  }

  return {
    state: "online", label: LABELS.online, color: COLORS.online,
    reason: "Connected, but no recent activity.", connected: true,
    sessionCount: sessions.length, lastInteraction,
  };
}

/** Presence computed from data we could not load is Unknown, never a guess. */
/** Offline because the account itself may not be signed in — not because a tab went quiet. */
export function offlineForAccount(reason = "This account cannot sign in, so it is offline."): PresenceResult {
  return {
    state: "offline", label: LABELS.offline, color: COLORS.offline,
    reason, connected: false, sessionCount: 0, lastInteraction: null,
  };
}

export function unknownPresence(reason = "Presence could not be read right now."): PresenceResult {
  return {
    state: "unknown", label: LABELS.unknown, color: COLORS.unknown,
    reason, connected: false, sessionCount: 0, lastInteraction: null,
  };
}

/* ------------------------------------------------------------------ */
/* ACCOUNT CONDITION — a different question from presence.            */
/* ------------------------------------------------------------------ */

export const ACCOUNT_CONDITIONS = [
  "active",
  "inactive",
  "pending_invitation",
  "suspended",
  "locked",
  "deactivated",
] as const;
export type AccountCondition = (typeof ACCOUNT_CONDITIONS)[number];

const CONDITION_LABELS: Record<AccountCondition, string> = {
  active: "Active",
  inactive: "Inactive",
  pending_invitation: "Pending invitation",
  suspended: "Suspended",
  locked: "Locked",
  deactivated: "Deactivated",
};

export function accountConditionLabel(condition: AccountCondition): string {
  return CONDITION_LABELS[condition];
}

/**
 * Derived from the status Sophira already stores — no new column, no invented state.
 * revoked maps to Suspended because that is exactly what revocation does: the account
 * exists, the person cannot sign in, and the owner can reinstate it.
 */
export function accountCondition(status: string | null | undefined): AccountCondition {
  switch (String(status ?? "").toLowerCase()) {
    case "active":
    case "accepted":
      return "active";
    case "pending":
      return "pending_invitation";
    case "revoked":
      return "suspended";
    default:
      // An unrecognised status is reported honestly rather than dressed up as Active.
      return "inactive";
  }
}

export interface PresenceCounts {
  active: number;
  online: number;
  idle: number;
  away: number;
  busy: number;
  dnd: number;
  offline: number;
  unknown: number;
}

export function countPresence(states: PresenceState[]): PresenceCounts {
  const counts: PresenceCounts = { active: 0, online: 0, idle: 0, away: 0, busy: 0, dnd: 0, offline: 0, unknown: 0 };
  for (const s of states) counts[s] += 1;
  return counts;
}

export interface ConditionCounts {
  active: number;
  pending_invitation: number;
  suspended: number;
  inactive: number;
  locked: number;
  deactivated: number;
}

export function countConditions(statuses: Array<string | null | undefined>): ConditionCounts {
  const counts: ConditionCounts = {
    active: 0, pending_invitation: 0, suspended: 0, inactive: 0, locked: 0, deactivated: 0,
  };
  for (const status of statuses) counts[accountCondition(status)] += 1;
  return counts;
}
