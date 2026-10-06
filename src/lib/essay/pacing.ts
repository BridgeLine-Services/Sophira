/**
 * Paced essay presentation (2026-10-06 hardening round).
 *
 * Output modes for revealing ALREADY-GENERATED, ALREADY-VERIFIED section
 * text — built on the existing pacing engine (src/lib/pacing.ts,
 * PacingController). The reveal is a presentation feature; it never claims
 * a human typed the text.
 *
 * Hard rules (all tested):
 *  - CALIBRATED mode reveals text at the user's selected WPM from the
 *    existing typing calibration: manual preferred pace if set, otherwise
 *    the adaptive recommendation when the user enabled auto-adjust,
 *    otherwise the baseline. Missing calibration → NO invented speed:
 *    the caller must fall back to instant and say why.
 *  - The reveal is driven by a LOCAL timer only. No network request per
 *    character, no database row per character (structurally: this module
 *    and the controller never touch fetch/storage; persistence happens
 *    once per section, when the section is stored).
 *  - Pause/resume works through the controller's active-time accounting.
 *  - Closing and reopening the page restores progress: reveal state
 *    (activeMs + mode + completion) serializes to a small object the UI
 *    stores in localStorage — restored via `restoreRevealState`.
 */

import { PacingController } from "../pacing-controller";

export type OutputMode = "instant" | "calibrated" | "slow" | "custom";

export const OUTPUT_MODE_LABELS: Record<OutputMode, string> = {
  instant: "Instant — show the finished section immediately",
  calibrated: "Calibrated — reveal at your calibrated typing pace",
  slow: "Slow — half your calibrated pace, for note-taking",
  custom: "Custom — reveal at a WPM you pick",
};

/** The existing typing calibration, as stored (baseline + adaptive profile). */
export interface CalibratedProfile {
  baselineWpm: number | null;
  recentWpm: number | null;
  accuracy: number | null;
  confidence: "LOW" | "MEDIUM" | "HIGH" | null;
  autoAdjustEnabled: boolean;
  manualWpm: number | null;
  recommendedWpm: number | null;
}

/** The user's selected WPM — their choice always wins over any default. */
export function selectedWpm(profile: CalibratedProfile): number | null {
  const baseline = validWpm(profile.baselineWpm);
  if (profile.manualWpm != null && validWpm(profile.manualWpm)) return profile.manualWpm;
  if (profile.autoAdjustEnabled && validWpm(profile.recommendedWpm)) return profile.recommendedWpm;
  return baseline; // null when uncalibrated — never invented
}

function validWpm(w: number | null | undefined): number | null {
  return typeof w === "number" && Number.isFinite(w) && w > 0 && w <= 220 ? w : null;
}

export const SLOW_FACTOR = 0.5;
export const MIN_REVEAL_WPM = 5;

/**
 * The WPM a mode reveals at, or null when the mode is impossible (no
 * calibration for calibrated/slow) — the caller falls back to instant and
 * tells the user honestly.
 */
export function effectiveRevealWpm(mode: OutputMode, profile: CalibratedProfile, customWpm?: number | null): number | null {
  switch (mode) {
    case "instant": return null; // no pacing
    case "calibrated": return selectedWpm(profile);
    case "slow": {
      const w = selectedWpm(profile);
      return w == null ? null : Math.max(MIN_REVEAL_WPM, w * SLOW_FACTOR);
    }
    case "custom": return validWpm(customWpm ?? null);
  }
}

/* ------------------------------------------------------------------ */
/* Reveal state — serialize/restore for close/reopen                    */
/* ------------------------------------------------------------------ */

export interface SectionRevealState {
  sectionId: string;
  mode: OutputMode;
  /** accumulated ACTIVE reveal time (pause excluded) — the restore anchor */
  activeMs: number;
  complete: boolean;
}

export function serializeReveal(controller: PacingController, sectionId: string, mode: OutputMode): SectionRevealState {
  return {
    sectionId,
    mode,
    activeMs: controller.elapsedActiveMs(),
    complete: controller.isComplete(),
  };
}

/** Restore: a saved reveal state maps back onto a fresh controller.
 *  A completed reveal stays complete; a partial reveal continues from the
 *  saved ACTIVE time (paused time was never counted, so nothing jumps). */
export function restoreReveal(text: string, saved: SectionRevealState | null, mode: OutputMode, wpm: number | null): { controller: PacingController; restored: boolean } {
  const controller = new PacingController(text, { wpm: wpm ?? 60 }, mode === "instant" ? "instant" : "paced");
  let restored = false;
  if (saved) {
    if (saved.complete || mode === "instant") {
      // complete stays complete — never re-reveal from scratch
      controller.start();
      controller.tick(0);
      controller.tick(1e12);
      restored = true;
    } else if (saved.activeMs > 0) {
      controller.start();
      controller.tick(0);
      controller.tick(Math.min(saved.activeMs, 1e12));
      controller.pause();
      restored = true;
    }
  }
  return { controller, restored };
}

export function revealStorageKey(sessionId: string, sectionId: string): string {
  return `sophira:essay-reveal:${sessionId}:${sectionId}`;
}
