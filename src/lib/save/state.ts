/**
 * UNIVERSAL SAVE-STATE CORE (Phase 4C, 2026-11-09) — PURE, no I/O.
 *
 * The single source of truth for what the member is told about saving.
 * Hard invariants (pinned by tests/autosave.ts):
 *   1. The UI may say "Saved" ONLY after the authoritative server confirms
 *      the write. Local state alone can never produce `saved`.
 *   2. Retries are bounded (backoff 1s → 2s → 4s …, cap 30s, max attempts)
 *      — never an infinite loop, never a silent drop.
 *   3. A conflict is never resolved silently: both versions are preserved
 *      until the member chooses.
 *   4. Nothing here persists to localStorage; the server is the source of
 *      truth (Phase 4B).
 */

export type SavePhase =
  | "idle" // nothing to save
  | "dirty" // member edited; previous save not started (debounce window)
  | "saving" // request in flight
  | "saved" // SERVER confirmed
  | "retrying" // failed, bounded retry scheduled
  | "error" // retries exhausted; member action needed
  | "conflict"; // the server copy changed elsewhere; member must choose

export interface SaveSnapshot {
  phase: SavePhase;
  /** attempts of the CURRENT save cycle (0 = none yet) */
  attempts: number;
  /** epoch ms of the last SERVER-confirmed save, or null */
  lastSavedAt: number | null;
  /** categorical failure code for plain-language mapping, never raw errors */
  failure: SaveFailure | null;
}

export type SaveFailure = "network" | "rejected" | "conflict" | "unknown";

export const MAX_SAVE_ATTEMPTS = 4;
export const BACKOFF_CAP_MS = 30_000;
export const DEFAULT_DEBOUNCE_MS = 1200;

export const initialSaveSnapshot: SaveSnapshot = {
  phase: "idle",
  attempts: 0,
  lastSavedAt: null,
  failure: null,
};

export type SaveEvent =
  | { type: "edit" }
  | { type: "save-start" }
  | { type: "server-confirmed"; at: number }
  | { type: "save-failed"; failure: SaveFailure }
  | { type: "conflict" }
  | { type: "retry-now" }
  | { type: "resolve-with-theirs"; at: number }
  | { type: "resolve-keep-mine" }
  | { type: "reset" };

/** Bounded exponential backoff; deterministic (no jitter) so tests can pin it. */
export function backoffMs(attempt: number): number {
  const n = Math.max(1, Math.floor(attempt));
  return Math.min(BACKOFF_CAP_MS, 1000 * Math.pow(2, n - 1));
}

/** True while a retry is still permitted. */
export function canRetry(snapshot: SaveSnapshot): boolean {
  return snapshot.phase === "retrying" && snapshot.attempts < MAX_SAVE_ATTEMPTS;
}

export function reduceSaveSnapshot(s: SaveSnapshot, e: SaveEvent): SaveSnapshot {
  switch (e.type) {
    case "edit":
      // Editing during "saved" returns to dirty; editing during saving/
      // retrying stays in that phase (the newest payload is saved next).
      if (s.phase === "saved" || s.phase === "idle") return { ...s, phase: "dirty", failure: null };
      if (s.phase === "error") return { ...s, phase: "dirty", attempts: 0, failure: null };
      return s;
    case "save-start":
      return { ...s, phase: "saving", attempts: s.attempts + 1, failure: null };
    case "server-confirmed":
      return { phase: "saved", attempts: 0, lastSavedAt: e.at, failure: null };
    case "save-failed": {
      const attempts = s.attempts;
      if (attempts >= MAX_SAVE_ATTEMPTS) {
        return { ...s, phase: "error", failure: e.failure };
      }
      return { ...s, phase: "retrying", failure: e.failure };
    }
    case "conflict":
      return { ...s, phase: "conflict", failure: "conflict" };
    case "retry-now":
      return s.phase === "error" || s.phase === "retrying" ? { ...s, phase: "dirty", attempts: 0, failure: null } : s;
    case "resolve-with-theirs":
      // Member chose the server copy: nothing is written; local edits dropped.
      return { phase: "saved", attempts: 0, lastSavedAt: e.at, failure: null };
    case "resolve-keep-mine":
      // Member chose their own text: a fresh save cycle against the new base.
      return { ...s, phase: "dirty", attempts: 0, failure: null };
    case "reset":
      return { ...initialSaveSnapshot, lastSavedAt: s.lastSavedAt };
    default:
      return s;
  }
}

/** Plain-English label for each state (never technical wording). */
export function saveLabel(s: SaveSnapshot): string {
  switch (s.phase) {
    case "idle":
      return "";
    case "dirty":
      return "Changes waiting to save…";
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "retrying":
      return "Save failed, retrying…";
    case "error":
      return "Save failed. Your text is still here.";
    case "conflict":
      return "This was changed somewhere else.";
    default:
      return "";
  }
}

/**
 * Debounce planning (pure): given ms since the last keystroke and ms since
 * the first unsaved edit, say how long to wait before saving.
 * 0 = save now. A max-wait guard prevents endless debounce on long typing.
 */
export function nextSaveDelayMs(
  msSinceLastEdit: number,
  msSinceFirstDirty: number,
  opts: { debounceMs?: number; maxWaitMs?: number } = {},
): number {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxWaitMs = opts.maxWaitMs ?? 10_000;
  if (msSinceFirstDirty >= maxWaitMs) return 0;
  return Math.max(0, Math.min(debounceMs - msSinceLastEdit, maxWaitMs - msSinceFirstDirty));
}

/** Revision-aware conflict check: any server version change is a conflict. */
export function isRevisionConflict(baseVersion: string | null, serverVersion: string | null): boolean {
  if (baseVersion === null || serverVersion === null) return false;
  return baseVersion !== serverVersion;
}
