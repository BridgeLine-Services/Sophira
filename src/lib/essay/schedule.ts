/**
 * Deadline-aware essay section scheduling (2026-10-06 hardening round).
 *
 * The existing deadline scheduler (src/lib/scheduler.ts) decides WHEN
 * sections are generated and displayed. This module maps an essay
 * (sections + generation effort + paced display time) onto that scheduler.
 *
 * Honesty rules (all tested):
 *  - Breaks are a SCHEDULING PREFERENCE (10s..6h, clamped): they are
 *    honored when the deadline allows, shrunk when it gets tight, and cut
 *    to the floor when needed. The user's "break" preference never endangers
 *    the deadline.
 *  - NO intentional time-wasting: generation is never delayed merely to
 *    imitate human pacing. Sections are generated back-to-back; the only
 *    waits are the user's requested breaks (bounded) and the LOCAL paced
 *    reveal, which reveals already-generated text.
 *  - If the deadline is impossible, the user is told IMMEDIATELY with the
 *    numbers; the plan never pretends a delayed schedule guarantees
 *    completion.
 */

import { planSchedule, clampBreak, MIN_BREAK_SECONDS, type SchedulePlan } from "../scheduler";

export interface EssayScheduleInput {
  nowMs: number;
  deadlineMs: number;
  sectionCount: number;
  /** minutes of server-side generation effort per section (AI + audits) */
  minutesPerSection: number;
  /** paced display: minutes to reveal one section at the user's WPM (0 for instant) */
  revealMinutesPerSection: number;
  /** the user's requested break between sections (seconds, scheduling preference) */
  preferredBreakSeconds?: number | null;
  urgency?: "relaxed" | "normal" | "urgent" | "extreme";
}

export interface SectionWindow {
  sectionIndex: number;
  generateAtMs: number;
  displayAtMs: number;
  breakAfterSeconds: number;
}

export interface EssaySchedule {
  feasible: boolean;
  warning: string | null;
  plan: SchedulePlan;
  sections: SectionWindow[];
  /** immediate, honest verdict shown BEFORE any work starts */
  verdict: string;
}

export function planEssaySchedule(input: EssayScheduleInput): EssaySchedule {
  const totalWorkMinutes = input.sectionCount * (input.minutesPerSection + input.revealMinutesPerSection);
  // preferred break is a preference: the scheduler clamps it into the
  // deadline-aware plan and shrinks it under pressure — never the reverse.
  const preferred = input.preferredBreakSeconds == null ? null : clampBreak(input.preferredBreakSeconds);
  const plan = planSchedule({
    nowMs: input.nowMs,
    deadlineMs: input.deadlineMs,
    estimatedWorkMinutes: Math.max(1, Math.round(totalWorkMinutes)),
    urgency: input.urgency ?? "normal",
    ...(preferred != null ? { preferredBreakSeconds: preferred } : {}),
  });

  const sections: SectionWindow[] = [];
  // Map work sessions onto sections sequentially: generate then display,
  // NEVER idling between sections — the only waits are the plan's breaks
  // (the user's preference, deadline-bounded) and the local paced reveal
  // of already-generated text.
  const stepMinutes = input.minutesPerSection + input.revealMinutesPerSection;
  let t = input.nowMs;
  let si = 0;
  let remInSession = plan.sessions.length > 0 ? plan.sessions[0].workSeconds / 60 : 0;
  for (let i = 0; i < input.sectionCount; i++) {
    const generateAtMs = t;
    let rem = stepMinutes;
    let breakAfter = 0;
    while (rem > remInSession && si < plan.sessions.length) {
      rem -= remInSession;
      t += remInSession * 60000 + plan.sessions[si].breakSeconds * 1000;
      breakAfter = plan.sessions[si].breakSeconds;
      si++;
      remInSession = si < plan.sessions.length ? plan.sessions[si].workSeconds / 60 : 0;
    }
    remInSession = Math.max(0, remInSession - rem);
    t += rem * 60000;
    sections.push({
      sectionIndex: i,
      generateAtMs,
      displayAtMs: generateAtMs + input.minutesPerSection * 60000,
      breakAfterSeconds: breakAfter,
    });
  }

  const verdict = plan.feasible
    ? `Feasible: all ${input.sectionCount} sections finish before the deadline (estimated completion ${new Date(plan.estimatedCompletionMs).toISOString()}).${preferred != null ? ` Your preferred ${preferred}s break between sections is honored${plan.sessions.some((s) => s.breakSeconds < preferred) ? " (shrunk where the deadline required)" : ""}.` : ""} Sophira never delays generation to imitate human pacing.`
    : `IMPOSSIBLE DEADLINE: the work (~${Math.round(totalWorkMinutes)} minutes for ${input.sectionCount} sections) cannot finish before ${new Date(input.deadlineMs).toISOString()} — the plan estimates completion at ${new Date(plan.estimatedCompletionMs).toISOString()}. This is told to you NOW, before drafting starts: a delayed schedule NEVER guarantees completion. Reduce sections, shorten the target, or extend the deadline.`;

  return {
    feasible: plan.feasible,
    warning: plan.warning,
    plan,
    sections,
    verdict,
  };
}

export { MIN_BREAK_SECONDS };
