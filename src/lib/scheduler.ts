// Deadline-aware work/break scheduler (spec §5). Deterministic and
// explainable — never a random sleep. Breaks are hard-bounded to
// [MIN_BREAK_SECONDS, MAX_BREAK_SECONDS] and scale with urgency and time
// pressure; the scheduler never schedules past the deadline when the
// workload fits, and warns explicitly when it cannot.
export const MIN_BREAK_SECONDS = 10;
export const MAX_BREAK_SECONDS = 21600; // 6 hours
export type Urgency = "relaxed" | "normal" | "urgent" | "extreme";
export interface ScheduleInput {
  nowMs: number;
  deadlineMs: number;
  estimatedWorkMinutes: number;
  urgency?: Urgency;
}
export interface ScheduledSession { startMs: number; workSeconds: number; breakSeconds: number }
export interface SchedulePlan {
  feasible: boolean;
  warning: string | null;
  sessions: ScheduledSession[];
  estimatedCompletionMs: number;
  timeRemainingMs: number;
  explanation: string;
}
export function clampBreak(seconds: number): number {
  return Math.max(MIN_BREAK_SECONDS, Math.min(MAX_BREAK_SECONDS, Math.round(seconds)));
}
const WORK_INTERVAL_SECONDS = 50 * 60;
const LONG_WORK_INTERVAL_SECONDS = 90 * 60;
const URGENCY_FACTOR: Record<Urgency, number> = { relaxed: 1, normal: 0.5, urgent: 0.15, extreme: 0 };
export function planSchedule(input: ScheduleInput): SchedulePlan {
  const urgency = input.urgency ?? "normal";
  const timeRemainingMs = input.deadlineMs - input.nowMs;
  const totalWorkSeconds = input.estimatedWorkMinutes * 60;
  if (timeRemainingMs <= 0) {
    return {
      feasible: false, warning: "The deadline has already passed.", sessions: [],
      estimatedCompletionMs: input.nowMs, timeRemainingMs,
      explanation: "The deadline is in the past; no schedule can recover it.",
    };
  }
  if (totalWorkSeconds <= 0) throw new Error("estimatedWorkMinutes must be positive");
  const pressure = timeRemainingMs / 1000 / totalWorkSeconds; // available seconds per second of work
  const workInterval = pressure >= 8 ? LONG_WORK_INTERVAL_SECONDS : WORK_INTERVAL_SECONDS;
  const breakFraction = (URGENCY_FACTOR[urgency] * 0.3 * Math.min(pressure, 16)) / 16;
  const sessions: ScheduledSession[] = [];
  let remaining = totalWorkSeconds;
  let cursor = input.nowMs;
  while (remaining > 0) {
    const work = Math.min(workInterval, remaining);
    const isLast = remaining - work <= 0;
    const breakSeconds = isLast ? 0 : clampBreak(work * breakFraction);
    sessions.push({ startMs: cursor, workSeconds: work, breakSeconds });
    cursor += (work + breakSeconds) * 1000;
    remaining -= work;
  }
  const estimatedCompletionMs = cursor;
  const feasible = estimatedCompletionMs <= input.deadlineMs;
  const warning = feasible
    ? null
    : `The estimated workload (${input.estimatedWorkMinutes} minutes) cannot reasonably be completed before the deadline; the plan finishes at ${new Date(estimatedCompletionMs).toISOString()} but the deadline is ${new Date(input.deadlineMs).toISOString()}. Start earlier, reduce scope, or extend the deadline.`;
  const first = sessions[0];
  const explanation =
    `Deadline ${new Date(input.deadlineMs).toISOString()}; ${(timeRemainingMs / 3600000).toFixed(1)} hours remain ` +
    `for ~${input.estimatedWorkMinutes} minutes of work (time pressure ${pressure.toFixed(1)}x, urgency "${urgency}"). ` +
    `Next interval: ${Math.round(first.workSeconds / 60)} minutes of work, then a ${first.breakSeconds}-second break. ` +
    `Breaks scale with urgency and available time and are hard-bounded to ${MIN_BREAK_SECONDS}-${MAX_BREAK_SECONDS} seconds. ` +
    (feasible ? "Estimated completion is before the deadline." : "WARNING: estimated completion is AFTER the deadline.");
  return { feasible, warning, sessions, estimatedCompletionMs, timeRemainingMs, explanation };
}
