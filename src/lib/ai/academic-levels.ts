/**
 * SHARED ACADEMIC-LEVEL ADAPTATION (2026-10-12).
 *
 * The academic level is a REAL behavioral configuration, not a label
 * pasted into the prompt: every level carries explicit expectations for
 * vocabulary, explanation structure, assumed prerequisites, scaffolding,
 * rigor, and research/citation standards. All engines share this one
 * module — no per-subject duplicates. An unspecified level keeps the
 * documented safe default (infer from the question), never a guess.
 */

export type AcademicLevelId =
  | "preschool" | "elementary" | "middle" | "high-school"
  | "undergraduate" | "graduate" | "doctoral" | "custom";

export interface AcademicLevelSpec {
  id: AcademicLevelId;
  label: string;
  /** Behavioral expectations the AI applies, in plain instructions. */
  guidance: string;
}

export const ACADEMIC_LEVELS: AcademicLevelSpec[] = [
  { id: "preschool", label: "Preschool",
    guidance: "Use very short sentences and everyday words. Explain through play, stories, and concrete objects; no jargon; tiny visual numbers; celebrate each small step." },
  { id: "elementary", label: "Elementary school",
    guidance: "Use simple, friendly language and short steps. Choose concrete examples from daily life; introduce a new term only with a plain definition beside it; guide practice with immediate encouragement." },
  { id: "middle", label: "Middle school",
    guidance: "Build from concrete to abstract. Define new terms when they first appear, show each step plainly, keep a moderate length, and check understanding with one or two quick questions." },
  { id: "high-school", label: "High school",
    guidance: "Introduce formal concepts and standard notation step by step. Explain why a method works, expect independence on routine steps, and provide moderate scaffolding on harder ones." },
  { id: "undergraduate", label: "Undergraduate",
    guidance: "Use discipline-standard terminology and notation and assume prerequisite coursework. Emphasize reasoning, stated assumptions, and limitations; refer to standard sources where relevant." },
  { id: "graduate", label: "Graduate study",
    guidance: "Engage competing interpretations and current literature with methodological rigor. Qualify claims precisely and expect substantial independence in problem solving." },
  { id: "doctoral", label: "Doctoral study",
    guidance: "Prioritize critical analysis, methodology, theory, and positioning of contributions. Discuss uncertainty and limitations rigorously; follow scholarly citation conventions." },
  { id: "custom", label: "Custom level",
    guidance: "Follow the user's stated level description; if the expected depth is ambiguous, ask rather than guess." },
];

/** Ordered lookup — the first matching pattern wins. */
const PATTERNS: Array<{ re: RegExp; id: AcademicLevelId }> = [
  { re: /pre[- ]?school|pre[- ]?k\b|nursery|kindergarten/i, id: "preschool" },
  { re: /elementary|primary|k[- ]?[1-5]\b|grade[s]?\s*([1-5]|one|two|three|four|five)\b|(1st|2nd|3rd|4th|5th)\s+grade/i, id: "elementary" },
  { re: /middle\b|junior high|ks3|grade[s]?\s*([6-8]|six|seven|eight)\b|(6th|7th|8th)\s+grade/i, id: "middle" },
  { re: /high[- ]?school|secondary|gcse|a[- ]?level|grade[s]?\s*(9|1[0-2]|nine|ten|eleven|twelve)\b|(9th|10th|11th|12th)\s+grade/i, id: "high-school" },
  { re: /undergrad|college|university|bachelor|b\.?sc|b\.?a\b|freshman|sophomore|junior|senior\b/i, id: "undergraduate" },
  { re: /graduate|master|msc|m\.?s\b|mba|post[- ]?grad/i, id: "graduate" },
  { re: /doctoral|ph\.?d|dphil|post[- ]?master/i, id: "doctoral" },
];

/** Resolve an arbitrary academic-level string to a canonical spec (PURE). */
export function resolveAcademicLevel(raw: string | null | undefined): AcademicLevelSpec | null {
  const value = (raw ?? "").trim();
  if (value === "") return null;
  for (const { re, id } of PATTERNS) {
    if (re.test(value)) return ACADEMIC_LEVELS.find((l) => l.id === id) ?? null;
  }
  return ACADEMIC_LEVELS.find((l) => l.id === "custom") ?? null;
}

/**
 * The one prompt bit every shared AI context builder uses for academic
 * level. A resolved level contributes its BEHAVIORAL guidance; an
 * unspecified level keeps the documented safe default.
 */
export function academicLevelBit(raw: string | null | undefined): string {
  const spec = resolveAcademicLevel(raw);
  if (!spec) return "Academic level: not specified — infer from the question, and adapt to how the user writes.";
  const customNote = spec.id === "custom" && (raw ?? "").trim() !== "" && (raw ?? "").trim().toLowerCase() !== "custom"
    ? ` (user's own wording: "${(raw ?? "").trim().slice(0, 60)}")` : "";
  return `Academic level: ${spec.label}${customNote}. ${spec.guidance}`;
}
