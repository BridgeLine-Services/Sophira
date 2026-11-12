"use client";

/**
 * THE MEMBER'S OWN HEARTBEAT (2026-11-12).
 *
 * Every signed-in tab reports in on the owner's configured interval, and reports a
 * MEANINGFUL INTERACTION (pointer, key, scroll) at most once per active threshold. It never
 * reports what was typed, read or opened - only that something happened.
 *
 * 2026-11-13: reporting moved into the shared application shell, because it used to be
 * started only by the Owner's members screen. That meant the directory was really only ever
 * fed by whoever happened to be sitting on that page, so "Online" described a page rather
 * than a person. It now runs for every signed-in role on every authenticated screen.
 *
 * Because each page renders its own shell, a naive effect would tear down and re-create the
 * loop on every navigation. One process-wide loop is therefore shared by every mounted
 * shell: acquiring it twice is a no-op, and leaving one page keeps it alive across a short
 * hand-over window instead of releasing the session and re-claiming it a moment later.
 *
 * This is best-effort by design. A tab that dies without warning leaves a row that simply
 * expires, so nothing here needs to be reliable for the directory to be correct. A refused
 * beat stops the loop (nothing to gain from repeating it); a failed network call is not
 * treated as success and is retried at the normal cadence.
 */

import { useEffect } from "react";

const SESSION_KEY = "sophira.presence.session";

/** An opaque per-tab identifier. Deliberately not a device fingerprint. */
export function presenceSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[A-Za-z0-9._:-]{8,64}$/.test(existing)) return existing;
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    const id = `tab-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return "";
  }
}

export interface PresenceReporterOptions {
  /** Milliseconds between heartbeats (owner-configured; clamped server-side too). */
  intervalMs: number;
  /** Milliseconds an interaction counts as "recent". */
  activeWindowMs: number;
  /** Off until the viewer is a confirmed signed-in member, and after signing out. */
  enabled?: boolean;
}

/** How long the loop survives with no mounted shell, so navigation does not churn sessions. */
const HANDOVER_MS = 2_000;

interface SharedReporter {
  sessionId: string;
  intervalMs: number;
  activeWindowMs: number;
  holders: number;
  timer: ReturnType<typeof setInterval> | null;
  handover: ReturnType<typeof setTimeout> | null;
  lastInteraction: number;
  lastSent: number;
  /** The server said it cannot record presence, or refuses this account. Stop for good. */
  stopped: boolean;
  teardown: (() => void) | null;
}

let shared: SharedReporter | null = null;

function send(state: SharedReporter, interacted: boolean) {
  if (state.stopped) return;
  void fetch("/api/network/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: state.sessionId, interacted }),
    keepalive: true,
  })
    .then(async (res) => {
      // A refusal is permanent: an older database cannot record presence at all, and a
      // suspended or revoked account will not start being allowed again mid-session.
      if (res.status === 403) {
        stop(state);
        return;
      }
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { ok?: boolean; presence?: string } | null;
        if (body?.presence === "unavailable") {
          stop(state);
          return;
        }
        if (body?.ok === true) state.lastSent = Date.now();
      }
      // Any other outcome is simply not a successful beat: the row expires on its own.
    })
    .catch(() => {
      /* offline or interrupted: never reported as a connection */
    });
}

function begin(state: SharedReporter) {
  state.timer = setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) return; // a hidden tab is not present
    const fresh = Date.now() - state.lastInteraction <= state.activeWindowMs;
    send(state, fresh);
  }, Math.max(10_000, state.intervalMs));
}

function stop(state: SharedReporter) {
  state.stopped = true;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  if (state.handover) clearTimeout(state.handover);
  state.handover = null;
}

function releaseSession(state: SharedReporter) {
  try {
    void fetch("/api/network/presence", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId }),
      keepalive: true,
    });
  } catch {
    /* the row expires on its own */
  }
}

function acquire(options: PresenceReporterOptions): () => void {
  const sessionId = presenceSessionId();
  if (!sessionId) return () => undefined; // storage unavailable: report nothing rather than guess

  let state = shared;
  if (state) {
    if (state.handover) {
      clearTimeout(state.handover);
      state.handover = null;
    }
    state.holders += 1;
    // The owner may have changed the cadence since this loop started.
    if (state.intervalMs !== options.intervalMs && !state.stopped) {
      state.intervalMs = options.intervalMs;
      if (state.timer) clearInterval(state.timer);
      begin(state);
    }
    state.activeWindowMs = options.activeWindowMs;
    return () => hand(state!);
  }

  state = shared = {
    sessionId,
    intervalMs: options.intervalMs,
    activeWindowMs: options.activeWindowMs,
    holders: 1,
    timer: null,
    handover: null,
    lastInteraction: Date.now(),
    lastSent: 0,
    stopped: false,
    teardown: null,
  };
  const current = state;

  send(current, true); // arriving on an authenticated screen is an interaction
  begin(current);

  const markInteraction = () => {
    const now = Date.now();
    current.lastInteraction = now;
    // Only tell the server when the previous claim would expire, to keep writes cheap.
    if (now - current.lastSent > Math.max(15_000, current.activeWindowMs / 2)) send(current, true);
  };

  // Coming back is its own signal: reconnecting, or bringing a tab back to the front,
  // should not wait a whole interval to look present again.
  const markBack = () => {
    if (typeof document !== "undefined" && document.hidden) return;
    current.lastInteraction = Date.now();
    send(current, true);
  };

  // Leaving the tab releases the session immediately; the row would expire anyway, but an
  // explicit release means a closed tab does not linger as "Online".
  const releaseOnHide = () => releaseSession(current);

  const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "scroll", "focus"];
  for (const name of events) window.addEventListener(name, markInteraction, { passive: true });
  window.addEventListener("pagehide", releaseOnHide);
  window.addEventListener("online", markBack);
  document.addEventListener("visibilitychange", markBack);

  current.teardown = () => {
    for (const name of events) window.removeEventListener(name, markInteraction);
    window.removeEventListener("pagehide", releaseOnHide);
    window.removeEventListener("online", markBack);
    document.removeEventListener("visibilitychange", markBack);
  };

  return () => hand(current);
}

/** Give up one shell's claim. The last one out releases the session after a short pause. */
function hand(state: SharedReporter) {
  state.holders = Math.max(0, state.holders - 1);
  if (state.holders > 0) return;
  state.handover = setTimeout(() => {
    if (shared !== state || state.holders > 0) return; // re-acquired by a route change
    stop(state);
    state.teardown?.();
    releaseSession(state);
    shared = null;
  }, HANDOVER_MS);
}

export function usePresenceReporter({ intervalMs, activeWindowMs, enabled = true }: PresenceReporterOptions) {
  useEffect(() => {
    if (!enabled) return;
    return acquire({ intervalMs, activeWindowMs, enabled });
  }, [intervalMs, activeWindowMs, enabled]);
}
