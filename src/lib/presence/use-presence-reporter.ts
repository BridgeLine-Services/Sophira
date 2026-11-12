"use client";

/**
 * THE MEMBER'S OWN HEARTBEAT (2026-11-12).
 *
 * Every signed-in tab reports in on the owner's configured interval, and reports a
 * MEANINGFUL INTERACTION (pointer, key, scroll) at most once per active threshold. It never
 * reports what was typed, read or opened — only that something happened.
 *
 * This is best-effort by design. A tab that dies without warning leaves a row that simply
 * expires, so nothing here needs to be reliable for the directory to be correct.
 */

import { useEffect, useRef } from "react";

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
  /** Disabled when the viewer is not an ordinary signed-in member. */
  enabled?: boolean;
}

export function usePresenceReporter({ intervalMs, activeWindowMs, enabled = true }: PresenceReporterOptions) {
  const lastInteraction = useRef<number>(0);
  const lastSent = useRef<number>(0);

  useEffect(() => {
    if (!enabled) return;
    const sessionId = presenceSessionId();
    if (!sessionId) return; // storage unavailable: report nothing rather than guess

    let disposed = false;

    const send = async (interacted: boolean) => {
      if (disposed) return;
      try {
        await fetch("/api/network/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, interacted }),
          keepalive: true,
        });
        lastSent.current = Date.now();
      } catch {
        // A failed beat is not retried into a fake success; the session just expires.
      }
    };

    const markInteraction = () => {
      const now = Date.now();
      lastInteraction.current = now;
      // Only tell the server when the previous claim would expire, to keep writes cheap.
      if (now - lastSent.current > Math.max(15_000, activeWindowMs / 2)) void send(true);
    };

    void send(true); // arriving on a page is an interaction

    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      const fresh = Date.now() - lastInteraction.current <= activeWindowMs;
      void send(fresh);
    }, Math.max(10_000, intervalMs));

    const events: Array<keyof WindowEventMap> = ["pointerdown", "keydown", "scroll", "focus"];
    for (const name of events) window.addEventListener(name, markInteraction, { passive: true });

    const release = () => {
      try {
        void fetch("/api/network/presence", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
          keepalive: true,
        });
      } catch {
        /* the row expires on its own */
      }
    };
    window.addEventListener("pagehide", release);

    return () => {
      disposed = true;
      clearInterval(timer);
      for (const name of events) window.removeEventListener(name, markInteraction);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [intervalMs, activeWindowMs, enabled]);
}
