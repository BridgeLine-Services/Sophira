/**
 * THE MEMBER DIRECTORY ROW (2026-11-12).
 *
 * One place that turns a member record into everything the owner's table shows, so the
 * table, the mobile cards, the filters and the summary counts cannot disagree about what
 * a member's name, phone, presence or account condition actually is.
 *
 * Honesty rules enforced here:
 *   - a name is never invented from an email address;
 *   - a missing email reads "Email unavailable", not "no identity";
 *   - a submitted phone number is never presented as verified;
 *   - a missing timestamp reads "Never active", a broken one "Unavailable", and neither
 *     is ever rendered as "Invalid Date";
 *   - presence comes from sessions, never from last_active_at alone.
 */

import { memberIdentity, type MemberIdentity } from "../member-identity";
import { activityPhrase, fmtDate, relativeTime } from "../format";
import { roleLabel, type Role } from "../roles";
import {
  PRESENCE_ALLOWED_STATUSES,
  offlineForAccount,
  accountCondition,
  accountConditionLabel,
  computePresence,
  presenceColor,
  presenceLabel,
  unknownPresence,
  type AccountCondition,
  type PresenceResult,
  type PresenceSession,
  type PresenceState,
} from "../presence/state";
import type { PresenceThresholds } from "../presence/thresholds";
import { DEFAULT_THRESHOLDS } from "../presence/thresholds";

export type PhoneStatus = "verified" | "unverified" | "none";

export interface MemberPhoneView {
  status: PhoneStatus;
  /** Formatted for reading, or null when there is nothing honest to show. */
  display: string | null;
  /** The word shown in the table. */
  label: string;
}

export interface MemberRow {
  userId: string;
  identity: MemberIdentity;
  email: string | null;
  /** Email shown under the name, or an honest statement that it is missing. */
  emailDisplay: string;
  phone: MemberPhoneView;
  role: Role;
  roleLabel: string;
  presence: PresenceResult;
  presenceLabel: string;
  presenceColor: string;
  condition: AccountCondition;
  conditionLabel: string;
  /** "3 Nov 2026" — the raw formatted join date, never "Invalid Date". */
  joinedDate: string;
  /** "Joined 3 Nov 2026", ready to read. */
  joinedDisplay: string;
  /** Formatted revocation date, or null when access was never revoked. */
  revokedDate: string | null;
  /** "Active just now" / "Never active" / "Last active unavailable". */
  lastActivityDisplay: string;
  /** "Active 3 minutes ago" from the presence session, or "Never seen". */
  lastSeenDisplay: string;
  responseCount: number;
  assignmentCount: number;
  subjectUsage: Array<{ subject: string; count: number }>;
  canRequestInvites: boolean;
  isSelf: boolean;
}

export interface MemberRowInput {
  user_id: string;
  display_name?: string | null;
  email?: string | null;
  phone?: string | null;
  phone_verified?: boolean | null;
  role?: string | null;
  status?: string | null;
  created_at?: string | null;
  last_active_at?: string | null;
  access_revoked_at?: string | null;
  can_request_invites?: boolean | null;
  assignment_count?: number | null;
  response_count?: number | null;
  subject_usage?: Array<{ subject: string; count: number }> | null;
  /** Server-computed presence for this member, when the endpoint provided one. */
  presence?: { state?: string | null; session_count?: number | null; last_interaction?: string | null } | null;
  /** Raw sessions, used when the server sent sessions instead of a computed state. */
  sessions?: PresenceSession[] | null;
  manual_availability?: string | null;
}

/**
 * A phone number only reads "verified" when the authentication provider itself confirmed
 * it (auth.users.phone_confirmed_at). A number typed into a form is "unverified" — which is
 * exactly what it is — and no number at all is "none".
 */
export function phoneView(phone: string | null | undefined, verified: boolean | null | undefined): MemberPhoneView {
  const trimmed = (phone ?? "").trim();
  if (!trimmed) {
    return { status: "none", display: null, label: "No phone number" };
  }
  if (verified === true) {
    return { status: "verified", display: trimmed, label: "Verified number" };
  }
  return { status: "unverified", display: trimmed, label: "Unverified number" };
}

export function buildMemberRow(
  input: MemberRowInput,
  opts: { thresholds?: PresenceThresholds; now?: number; viewerId?: string | null } = {},
): MemberRow {
  const thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const now = opts.now ?? Date.now();
  const identity = memberIdentity({
    display_name: input.display_name,
    email: input.email,
    user_id: input.user_id,
  });

  const presence = input.presence?.state
    ? toPresenceResult(input.presence, input.sessions ?? [], input.manual_availability, thresholds, input.status, now)
    : input.sessions
      ? computePresence({
          accountStatus: input.status,
          sessions: input.sessions,
          manualAvailability: input.manual_availability,
          thresholds,
          now,
        })
      : unknownPresence("Presence has not been reported for this member yet.");

  // A suspended, locked or deactivated account cannot sign in, so it cannot be present —
  // even if a stale session row still exists. Presence and account condition stay separate
  // facts, but they can never contradict each other.
  const accountsCanSignIn = PRESENCE_ALLOWED_STATUSES.includes(String(input.status ?? "active"));
  const presenceFinal = accountsCanSignIn
    ? presence
    : offlineForAccount("This account is not active, so it is offline even if a session row exists.");

  const condition = accountCondition(input.status);
  const lastInteraction = presenceFinal.lastInteraction;

  return {
    userId: input.user_id,
    identity,
    email: (input.email ?? "").trim() || null,
    emailDisplay: (input.email ?? "").trim() || "Email unavailable",
    phone: phoneView(input.phone, input.phone_verified),
    role: (input.role as Role) ?? "user",
    roleLabel: roleLabel(input.role),
    presence: presenceFinal,
    presenceLabel: presenceLabel(presenceFinal.state),
    presenceColor: presenceColor(presenceFinal.state),
    condition,
    conditionLabel: accountConditionLabel(condition),
    joinedDate: input.created_at ? fmtDate(input.created_at, "date unavailable") : "date unavailable",
    joinedDisplay: input.created_at
      ? `Joined ${fmtDate(input.created_at, "date unavailable")}`
      : "Join date unavailable",
    revokedDate: input.access_revoked_at ? fmtDate(input.access_revoked_at, "date unavailable") : null,
    lastActivityDisplay: activityPhrase(input.last_active_at, { now }),
    lastSeenDisplay: lastInteraction
      ? `Active ${relativeTime(lastInteraction, { now, neverLabel: "Never seen" })}`
      : "Never seen",
    responseCount: Number(input.response_count ?? 0),
    assignmentCount: Number(input.assignment_count ?? 0),
    subjectUsage: Array.isArray(input.subject_usage) ? input.subject_usage : [],
    canRequestInvites: Boolean(input.can_request_invites),
    isSelf: Boolean(opts.viewerId && opts.viewerId === input.user_id),
  };
}

function toPresenceResult(
  presence: { state?: string | null; session_count?: number | null; last_interaction?: string | null },
  sessions: PresenceSession[],
  manual: string | null | undefined,
  thresholds: PresenceThresholds,
  status: string | null | undefined,
  now: number,
): PresenceResult {
  const computed = computePresence({
    accountStatus: status,
    sessions,
    manualAvailability: manual,
    thresholds,
    now,
  });
  // The stored state is the server's verdict; the local computation only supplies the
  // human reason and the session detail. A state the server did not recognise is Unknown.
  const state = (presence.state ?? "") as PresenceState;
  if (!state) return computed;
  const known = computed.state === state;
  return {
    ...computed,
    state,
    label: presenceLabel(state),
    color: presenceColor(state),
    connected: (presence.session_count ?? computed.sessionCount) > 0,
    sessionCount: presence.session_count ?? computed.sessionCount,
    lastInteraction: presence.last_interaction ?? computed.lastInteraction,
    reason: known ? computed.reason : "Reported by the server.",
  };
}

/* ------------------------------------------------------------------ */
/* FILTERS                                                            */
/* ------------------------------------------------------------------ */

export const PRESENCE_FILTERS: Array<{ id: "all" | PresenceState; label: string }> = [
  { id: "all", label: "All members" },
  { id: "active", label: "Active" },
  { id: "online", label: "Online" },
  { id: "idle", label: "Idle" },
  { id: "away", label: "Away" },
  { id: "busy", label: "Busy" },
  { id: "dnd", label: "Do Not Disturb" },
  { id: "offline", label: "Offline" },
  { id: "unknown", label: "Unknown" },
];

export const CONDITION_FILTERS: Array<{ id: "all" | AccountCondition; label: string }> = [
  { id: "all", label: "Any account condition" },
  { id: "active", label: "Active accounts" },
  { id: "pending_invitation", label: "Pending invitations" },
  { id: "suspended", label: "Suspended accounts" },
  { id: "inactive", label: "Inactive accounts" },
  { id: "locked", label: "Locked accounts" },
  { id: "deactivated", label: "Deactivated accounts" },
];

export interface MemberFilter {
  presence?: "all" | PresenceState;
  condition?: "all" | AccountCondition;
  role?: "all" | Role;
  query?: string;
}

/** Filters compose: presence AND condition AND role AND the free-text search. */
export function filterMembers(rows: MemberRow[], filter: MemberFilter): MemberRow[] {
  const q = (filter.query ?? "").trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.presence && filter.presence !== "all" && row.presence.state !== filter.presence) return false;
    if (filter.condition && filter.condition !== "all" && row.condition !== filter.condition) return false;
    if (filter.role && filter.role !== "all" && row.role !== filter.role) return false;
    if (q) {
      const haystack = [row.identity.title, row.email ?? "", row.phone.display ?? "", row.roleLabel]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/** Live summary counts. Always derived from the rows actually loaded, never estimated. */
export function summarize(rows: MemberRow[]) {
  const presence = { active: 0, online: 0, idle: 0, away: 0, busy: 0, dnd: 0, offline: 0, unknown: 0 } as Record<PresenceState, number>;
  const conditions = {
    active: 0, pending_invitation: 0, suspended: 0, inactive: 0, locked: 0, deactivated: 0,
  } as Record<AccountCondition, number>;
  for (const row of rows) {
    presence[row.presence.state] += 1;
    conditions[row.condition] += 1;
  }
  return { total: rows.length, presence, conditions };
}
