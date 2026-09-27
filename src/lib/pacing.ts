// Paced-output engine (spec §4). Generation and verification happen FIRST;
// this layer only controls how approved text is revealed in the UI. It is a
// presentation feature and must never be presented as the AI literally typing.
export type PacingMode = "paced" | "instant";
export interface PacingOptions { wpm: number; multiplier?: number }
export interface RevealPlan { text: string; charIntervalMs: number; totalMs: number }
export function planReveal(text: string, opts: PacingOptions): RevealPlan {
  const multiplier = opts.multiplier ?? 1;
  if (opts.wpm <= 0 || multiplier <= 0) throw new Error("pacing speed must be positive");
  const charsPerMinute = opts.wpm * 5 * multiplier;
  const charIntervalMs = 60000 / charsPerMinute;
  return { text, charIntervalMs, totalMs: text.length * charIntervalMs };
}
// activeElapsedMs is ACTIVE typing time only — paused time is excluded by the
// caller, which gives pause/resume semantics for free.
export function visibleAt(plan: RevealPlan, activeElapsedMs: number, mode: PacingMode = "paced"): string {
  if (mode === "instant") return plan.text;
  const chars = Math.min(plan.text.length, Math.max(0, Math.floor(activeElapsedMs / plan.charIntervalMs)));
  return plan.text.slice(0, chars);
}
export function pacingComplete(plan: RevealPlan, activeElapsedMs: number, mode: PacingMode = "paced"): boolean {
  return visibleAt(plan, activeElapsedMs, mode) === plan.text;
}
