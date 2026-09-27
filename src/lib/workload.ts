import type { Mode } from "./types";

/**
 * Workload estimation for deadline scheduling (spec §11).
 *
 * A transparent heuristic, not a promise: when the user hasn't supplied an
 * estimated workload, Sophira estimates from word count / mode / task type /
 * research & rubric requirements. The estimate is always shown to the user
 * with its basis, and the user's own number always wins.
 */

export interface WorkloadEstimateInput {
  mode: Mode;
  task_type?: string | null;
  output_type?: string | null;
  word_count_target?: number | null;
  requires_research?: boolean;
  has_rubric?: boolean;
  source_count?: number | null;
}

export interface WorkloadEstimate {
  minutes: number;
  basis: string[];
}

const PROBLEM_TASK = /(problem|exercise|homework|worksheet|problem set|question)/i;

export function estimateWorkMinutes(input: WorkloadEstimateInput): WorkloadEstimate {
  const basis: string[] = [];
  let minutes = 15; // baseline: reading the prompt, planning, review
  basis.push("base planning + review time");

  const task = `${input.task_type ?? ""} ${input.output_type ?? ""}`;
  const isWriting = input.mode === "writing" || /essay|paper|report|writing|paragraph/i.test(task);

  if (isWriting) {
    // Drafting heuristic: ~12 words/minute of sustained academic drafting
    // (~700 words/hour), independent of typing speed — thinking, not typing,
    // is the bottleneck.
    const words = input.word_count_target && input.word_count_target > 0 ? input.word_count_target : 800;
    const drafting = Math.round(words / 12);
    minutes += drafting;
    basis.push(`${words}-word draft at ~12 words/minute (${drafting} min)`);
    if (input.word_count_target == null) basis.push("no word count given, assumed ~800 words");
    if (input.has_rubric) {
      minutes += 10;
      basis.push("rubric compliance pass (+10 min)");
    }
  } else if (PROBLEM_TASK.test(task) || input.mode === "assignment" || input.mode === "check") {
    minutes += 20;
    basis.push("problem-based work: setup, solving, checking (+20 min)");
    if (input.mode === "check") basis.push("checking your existing work");
  } else {
    minutes += 10;
    basis.push("study/explanation work (+10 min)");
  }

  if (input.requires_research) {
    const research = 20 + 5 * Math.min(input.source_count ?? 4, 10);
    minutes += research;
    basis.push(`research time for ~${Math.min(input.source_count ?? 4, 10)} sources (+${research} min)`);
  }

  // Keep the estimate in a sane, honest range.
  minutes = Math.max(10, Math.min(600, minutes));
  return { minutes, basis };
}

export function parseEstimatedWorkMinutes(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(600, Math.round(n));
}
