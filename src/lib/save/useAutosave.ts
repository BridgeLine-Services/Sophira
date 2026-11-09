"use client";

/**
 * AUTOSAVE HOOK (Phase 4C, 2026-11-09).
 *
 * Debounced, server-confirmed, bounded-retry saving for member-editable
 * data. The SERVER is the source of truth: the hook only reports "Saved"
 * after `save()` resolves with the server's version. It never writes the
 * only copy to localStorage, never retries forever, and never resolves a
 * conflict silently (the member chooses).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_DEBOUNCE_MS,
  backoffMs,
  initialSaveSnapshot,
  isRevisionConflict,
  nextSaveDelayMs,
  reduceSaveSnapshot,
  type SaveFailure,
  type SaveSnapshot,
} from "./state";

export interface SaveResult {
  /** server version token (e.g. profiles.updated_at) — null if the API has none */
  version: string | null;
}

export interface UseAutosaveOptions<T> {
  /** Performs the authoritative write. MUST reject on failure. */
  save: (payload: T, baseVersion: string | null) => Promise<SaveResult>;
  debounceMs?: number;
  maxWaitMs?: number;
  /** Set when the member explicitly chooses their own version after a conflict. */
  onConflictNeedsChoice?: (choose: (mode: "mine" | "theirs") => void) => void;
}

export function useAutosave<T>(opts: UseAutosaveOptions<T>) {
  const [snapshot, setSnapshot] = useState<SaveSnapshot>(initialSaveSnapshot);
  const payloadRef = useRef<T | null>(null);
  const baseRef = useRef<string | null>(null);
  const firstDirtyRef = useRef<number | null>(null);
  const lastEditRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflightRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const attemptSave = useCallback(async () => {
    if (inflightRef.current || payloadRef.current === null) return;
    inflightRef.current = true;
    clearTimer();
    setSnapshot((s) => reduceSaveSnapshot(s, { type: "save-start" }));
    const payload = payloadRef.current;
    try {
      const { version } = await optsRef.current.save(payload, baseRef.current);
      if (isRevisionConflict(baseRef.current, version)) {
        // The server already holds a NEWER accepted write: we must not
        // overwrite it. Hold both versions and let the member decide.
        setSnapshot((s) => reduceSaveSnapshot(s, { type: "conflict" }));
      } else {
        baseRef.current = version;
        setSnapshot((s) => reduceSaveSnapshot(s, { type: "server-confirmed", at: Date.now() }));
      }
      firstDirtyRef.current = null;
    } catch (err) {
      const failure: SaveFailure =
        (err as { name?: string })?.name === "AbortError" || (err as { code?: string })?.code === "network"
          ? "network"
          : "unknown";
      setSnapshot((s) => {
        const failed = reduceSaveSnapshot(s, { type: "save-failed", failure });
        if (failed.phase === "retrying") {
          const delay = backoffMs(failed.attempts);
          timerRef.current = setTimeout(() => void attemptSave(), delay);
        }
        return failed;
      });
    } finally {
      inflightRef.current = false;
    }
  }, [clearTimer]);

  /** Call on every member edit with the FULL new payload. */
  const markEdited = useCallback(
    (payload: T) => {
      payloadRef.current = payload;
      const now = Date.now();
      lastEditRef.current = now;
      if (firstDirtyRef.current === null) firstDirtyRef.current = now;
      setSnapshot((s) => reduceSaveSnapshot(s, { type: "edit" }));
      const delay = nextSaveDelayMs(0, now - (firstDirtyRef.current ?? now), {
        debounceMs: optsRef.current.debounceMs ?? DEFAULT_DEBOUNCE_MS,
        maxWaitMs: optsRef.current.maxWaitMs,
      });
      clearTimer();
      timerRef.current = setTimeout(() => void attemptSave(), delay);
    },
    [attemptSave, clearTimer],
  );

  /** Immediate save (blur, navigation, explicit button). */
  const flush = useCallback(() => {
    if (payloadRef.current !== null) void attemptSave();
  }, [attemptSave]);

  const retry = useCallback(() => {
    setSnapshot((s) => reduceSaveSnapshot(s, { type: "retry-now" }));
    void attemptSave();
  }, [attemptSave]);

  const resolveConflict = useCallback(
    (mode: "mine" | "theirs") => {
      if (mode === "theirs") {
        payloadRef.current = null;
        setSnapshot((s) => reduceSaveSnapshot(s, { type: "resolve-with-theirs", at: Date.now() }));
        return;
      }
      baseRef.current = null; // explicit overwrite is the member's decision
      setSnapshot((s) => reduceSaveSnapshot(s, { type: "resolve-keep-mine" }));
      void attemptSave();
    },
    [attemptSave],
  );

  // Save-on-navigation safeguards (best effort; the server write itself is
  // what counts, and the hook never claims success without confirmation).
  useEffect(() => {
    const onHide = () => {
      if (payloadRef.current !== null) void attemptSave();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      clearTimer();
    };
  }, [attemptSave, clearTimer]);

  return { snapshot, markEdited, flush, retry, resolveConflict };
}
