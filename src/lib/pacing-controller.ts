import { planReveal, visibleAt, pacingComplete, type PacingMode, type RevealPlan } from "./pacing";

/**
 * UI-facing pacing state machine (spec §4) built ON TOP of the existing
 * pacing engine (src/lib/pacing.ts) — not a second timing engine.
 *
 * The controller is deliberately pure about time: the caller supplies the
 * clock via tick(nowMs), so pause semantics are trivially testable offline:
 *
 *   - tick() only accumulates time while the controller is running, so
 *     PAUSED time never advances the reveal.
 *   - "instant" mode bypasses pacing entirely (visibleAt already does this).
 *   - The reveal never exceeds the full text and completes deterministically.
 *
 * The controller reveals text that has ALREADY been generated and verified;
 * it never writes character updates to any database — persistence stays
 * exactly as it was (the final response is stored once, server-side).
 */
export class PacingController {
  private readonly plan: RevealPlan;
  private mode: PacingMode;
  private activeMs = 0;
  private running = false;
  private lastTickMs: number | null = null;

  constructor(
    text: string,
    opts: { wpm: number; multiplier?: number },
    mode: PacingMode = "paced"
  ) {
    this.plan = planReveal(text, opts);
    this.mode = mode;
  }

  /** A missing calibration must NEVER be turned into an invented speed. */
  static requiresCalibration(baselineWpm: number | null | undefined): boolean {
    return typeof baselineWpm !== "number" || !Number.isFinite(baselineWpm) || baselineWpm <= 0;
  }

  start(): void {
    if (!this.isComplete()) this.running = true;
  }

  /** Pause: stop accumulating active time. The reveal freezes in place. */
  pause(): void {
    this.running = false;
    this.lastTickMs = null; // stale clock ticks must not jump the reveal
  }

  /** Resume: continue from the accumulated ACTIVE time only. */
  resume(): void {
    if (!this.isComplete()) this.running = true;
  }

  get isRunning(): boolean {
    return this.running;
  }

  setMode(mode: PacingMode): void {
    this.mode = mode;
  }

  /** Advance active typing time. Only called by the UI's own clock. */
  tick(nowMs: number): void {
    if (!this.running) {
      this.lastTickMs = null;
      return;
    }
    if (this.lastTickMs !== null) {
      // Clock skew / tab sleep can produce a huge delta; the reveal can
      // never jump past completion anyway (visibleAt clamps to text).
      this.activeMs += Math.max(0, nowMs - this.lastTickMs);
    }
    this.lastTickMs = nowMs;
  }

  /** How much of the finished text is visible right now. */
  visible(): string {
    return visibleAt(this.plan, this.activeMs, this.mode);
  }

  /** 0..1 share of the text revealed (1 in instant mode). */
  progress(): number {
    const total = this.plan.text.length || 1;
    return this.visible().length / total;
  }

  isComplete(): boolean {
    return pacingComplete(this.plan, this.activeMs, this.mode);
  }

  /** Accumulated ACTIVE reveal time so far (for save/restore of progress). */
  elapsedActiveMs(): number {
    return this.activeMs;
  }

  /** Total planned active time for the paced reveal (instant → 0). */
  get totalMs(): number {
    return this.mode === "instant" ? 0 : this.plan.totalMs;
  }
}
