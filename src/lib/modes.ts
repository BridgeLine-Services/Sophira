import type { Mode } from "./types";

export interface ModeInfo {
  id: Mode;
  label: string;
  short: string;
  description: string;
}

export const MODES: ModeInfo[] = [
  { id: "learn", label: "Learn", short: "Learn", description: "Step-by-step explanation of a concept, with key terms defined, so you understand how to solve similar problems yourself." },
  { id: "assignment", label: "Assignment", short: "Assignment", description: "Work the supplied assignment, follow the teacher's instructions, show required work, produce an organized response." },
  { id: "check", label: "Check my work", short: "Check", description: "Submit your own attempt. Sophira identifies correct steps, errors, missing reasoning, and possible corrections." },
  { id: "writing", label: "Writing", short: "Writing", description: "Generate or revise writing in your own voice (using your approved Writing Profile) while following the assignment requirements." },
  { id: "study", label: "Study", short: "Study", description: "Create practice questions, flashcards, summaries, concept reviews, and exam prep from your course materials." },
  { id: "explain", label: "Explain simply", short: "Simply", description: "The subject explained in accessible language at your level, without losing accuracy." },
  { id: "custom", label: "Custom", short: "Custom", description: "Describe exactly the kind of help you want." },
];

export const MODE_MAP: Record<Mode, ModeInfo> = Object.fromEntries(
  MODES.map((m) => [m.id, m])
) as Record<Mode, ModeInfo>;
