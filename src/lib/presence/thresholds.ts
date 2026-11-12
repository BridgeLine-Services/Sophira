/**
 * PRESENCE THRESHOLDS (2026-11-12).
 *
 * The owner can tune how quickly someone stops looking "active", but every value has a
 * floor and a ceiling. A heartbeat interval of one second would hammer the database; a
 * connection timeout of a week would leave a closed laptop looking online forever.
 * These bounds are enforced here (before the write) and again by a CHECK constraint in
 * the database (migration 0049), so no path can store a value that breaks the model.
 */

export interface PresenceThresholds {
  /** How often a signed-in tab reports in. */
  heartbeatIntervalSeconds: number;
  /** Silence longer than this means the session is no longer connected. */
  connectionTimeoutSeconds: number;
  /** Interaction more recent than this reads as Active. */
  activeThresholdSeconds: number;
  /** Interaction more recent than this reads as Idle (beyond it: Online). */
  idleThresholdSeconds: number;
  /** A session is ignored after this long regardless of heartbeats. */
  sessionExpirationSeconds: number;
  /** How often the members page re-reads presence when live updates are unavailable. */
  presenceUpdateIntervalSeconds: number;
}

export const DEFAULT_THRESHOLDS: PresenceThresholds = {
  heartbeatIntervalSeconds: 30,
  connectionTimeoutSeconds: 90,
  activeThresholdSeconds: 120,
  idleThresholdSeconds: 600,
  sessionExpirationSeconds: 3600,
  presenceUpdateIntervalSeconds: 30,
};

export const THRESHOLD_BOUNDS: Record<keyof PresenceThresholds, { min: number; max: number }> = {
  heartbeatIntervalSeconds: { min: 10, max: 300 },
  connectionTimeoutSeconds: { min: 30, max: 900 },
  activeThresholdSeconds: { min: 30, max: 900 },
  idleThresholdSeconds: { min: 60, max: 3600 },
  sessionExpirationSeconds: { min: 300, max: 86400 },
  presenceUpdateIntervalSeconds: { min: 10, max: 300 },
};

export const THRESHOLD_LABELS: Record<keyof PresenceThresholds, string> = {
  heartbeatIntervalSeconds: "Report interval",
  connectionTimeoutSeconds: "Connection timeout",
  activeThresholdSeconds: "Active threshold",
  idleThresholdSeconds: "Idle threshold",
  sessionExpirationSeconds: "Session expiry",
  presenceUpdateIntervalSeconds: "Refresh interval",
};

export function clampThreshold(key: keyof PresenceThresholds, value: unknown): number {
  const bounds = THRESHOLD_BOUNDS[key];
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_THRESHOLDS[key];
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

export function clampThresholds(
  input: Partial<Record<keyof PresenceThresholds, unknown>> | null | undefined,
): PresenceThresholds {
  const out = { ...DEFAULT_THRESHOLDS };
  if (!input) return out;
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as Array<keyof PresenceThresholds>) {
    if (input[key] !== undefined && input[key] !== null) out[key] = clampThreshold(key, input[key]);
  }
  return repairThresholdOrder(out);
}

/**
 * Keep the model ordered: a connection timeout shorter than the heartbeat interval would
 * make every member flicker offline between beats, and an idle threshold shorter than the
 * active threshold would make "Idle" unreachable.
 */
export function repairThresholdOrder(input: PresenceThresholds): PresenceThresholds {
  const t = { ...input };
  if (t.connectionTimeoutSeconds <= t.heartbeatIntervalSeconds) {
    t.connectionTimeoutSeconds = clampThreshold("connectionTimeoutSeconds", t.heartbeatIntervalSeconds * 3);
  }
  if (t.idleThresholdSeconds <= t.activeThresholdSeconds) {
    t.idleThresholdSeconds = clampThreshold("idleThresholdSeconds", t.activeThresholdSeconds * 2);
  }
  if (t.sessionExpirationSeconds < t.connectionTimeoutSeconds) {
    t.sessionExpirationSeconds = clampThreshold("sessionExpirationSeconds", t.connectionTimeoutSeconds * 2);
  }
  return t;
}

/** Validate a proposed settings payload for the owner UI. Returns plain-English problems. */
export function validateThresholds(input: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(THRESHOLD_BOUNDS) as Array<keyof PresenceThresholds>) {
    if (input[key] === undefined) continue;
    const n = Number(input[key]);
    const { min, max } = THRESHOLD_BOUNDS[key];
    if (!Number.isFinite(n)) {
      problems.push(`${THRESHOLD_LABELS[key]} must be a number of seconds.`);
    } else if (n < min || n > max) {
      problems.push(`${THRESHOLD_LABELS[key]} must be between ${min} and ${max} seconds.`);
    }
  }
  if (problems.length === 0) {
    const requested = { ...DEFAULT_THRESHOLDS, ...(input as Partial<PresenceThresholds>) };
    const repaired = repairThresholdOrder({
      heartbeatIntervalSeconds: Number(requested.heartbeatIntervalSeconds),
      connectionTimeoutSeconds: Number(requested.connectionTimeoutSeconds),
      activeThresholdSeconds: Number(requested.activeThresholdSeconds),
      idleThresholdSeconds: Number(requested.idleThresholdSeconds),
      sessionExpirationSeconds: Number(requested.sessionExpirationSeconds),
      presenceUpdateIntervalSeconds: Number(requested.presenceUpdateIntervalSeconds),
    });
    if (repaired.connectionTimeoutSeconds !== Number(requested.connectionTimeoutSeconds)) {
      problems.push("The connection timeout must be longer than the report interval, or members will flicker offline.");
    }
    if (repaired.idleThresholdSeconds !== Number(requested.idleThresholdSeconds)) {
      problems.push("The idle threshold must be longer than the active threshold.");
    }
    if (repaired.sessionExpirationSeconds !== Number(requested.sessionExpirationSeconds)) {
      problems.push("Session expiry must be at least as long as the connection timeout.");
    }
  }
  return problems;
}
