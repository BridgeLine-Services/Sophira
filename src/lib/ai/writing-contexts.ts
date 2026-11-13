/**
 * CONTEXT-SPECIFIC WRITING PERSONALISATION (2026-11-13, directive Part 5).
 *
 * A student writes essays, messages and emails. Before this, one approved writing
 * profile was applied to all of them, which flattened three registers into one voice.
 * These are the three contexts the platform distinguishes, the rules that keep them
 * apart, and the student's own 0-100 closeness setting.
 *
 * PURE MODULE. No database, no AI provider, no network: every rule here is a function
 * of its arguments, so it can be tested exactly and used from a server route, a screen
 * or a test without any of them changing the others.
 */

export const WRITING_CONTEXTS = ["academic", "casual", "professional"] as const;
export type WritingContext = (typeof WRITING_CONTEXTS)[number];

/** Every existing profile and sample was backfilled to this by migration 0058. */
export const DEFAULT_WRITING_CONTEXT: WritingContext = "academic";

/** Migration 0058's column default: the neutral middle, not "maximum". */
export const DEFAULT_CLOSENESS = 70;

export const CLOSENESS_MIN = 0;
export const CLOSENESS_MAX = 100;

/** Plain-language names. A student should never have to read the storage value. */
export const CONTEXT_LABELS: Record<WritingContext, string> = {
  academic: "Academic writing",
  casual: "Casual writing",
  professional: "Professional writing",
};

export const CONTEXT_DESCRIPTIONS: Record<WritingContext, string> = {
  academic:
    "Essays, reports and coursework. Formal, evidence-led, and always led by the assignment and your teacher's requirements.",
  casual:
    "Messages, notes and posts. Relaxed and natural, with contractions allowed.",
  professional:
    "Emails and applications. Clear, courteous and concise, without slang.",
};

/** True only for a value the database constraint would also accept. */
export function isWritingContext(value: unknown): value is WritingContext {
  return typeof value === "string" && (WRITING_CONTEXTS as readonly string[]).includes(value);
}

/**
 * Read a context from untrusted input (a request body or a query parameter).
 * Anything unrecognised falls back to academic, which is what 0058 made every
 * existing row, so an old client keeps its current behaviour instead of erroring.
 */
export function parseWritingContext(value: unknown, fallback: WritingContext = DEFAULT_WRITING_CONTEXT): WritingContext {
  if (isWritingContext(value)) return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (isWritingContext(lower)) return lower;
  }
  return fallback;
}

/**
 * Coerce a closeness value from untrusted input into 0-100. Out-of-range numbers are
 * clamped (a slider cannot exceed its ends), non-numbers fall back to the default, and
 * a numeric string is honoured because form inputs arrive as text.
 */
export function normalizeCloseness(value: unknown, fallback: number = DEFAULT_CLOSENESS): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(CLOSENESS_MAX, Math.max(CLOSENESS_MIN, Math.round(n)));
}

/** How a distance on the dial reads to a student. */
export function closenessLabel(value: unknown): string {
  const n = normalizeCloseness(value);
  if (n === 0) return "Off";
  if (n <= 25) return "Light touch";
  if (n <= 50) return "Somewhat";
  if (n <= 75) return "Fairly close";
  if (n < 100) return "Close";
  return "As close as possible";
}

/**
 * What the dial means in practice, in the student's words. Shown next to the slider so
 * a number never has to be interpreted.
 */
export function closenessExplanation(value: unknown): string {
  const n = normalizeCloseness(value);
  if (n === 0) return "Your preferences are kept but not applied. Sophira writes in its normal voice.";
  if (n <= 25) return "Your preferences nudge word choice only. Structure and tone stay neutral.";
  if (n <= 50) return "Your preferences shape wording and sentence flow where the assignment allows.";
  if (n <= 75) return "Your preferences clearly shape wording, rhythm and structure.";
  if (n < 100) return "Sophira follows your approved habits closely wherever the assignment and teacher allow.";
  return "Sophira follows your approved habits as closely as the assignment and teacher allow.";
}

/**
 * Register rules per context. These are about the KIND of writing, so they hold even at
 * closeness 0 - turning the dial down means "use less of MY voice", never "ignore what
 * kind of document this is".
 */
export function contextRegisterRules(context: WritingContext): string[] {
  switch (context) {
    case "casual":
      return [
        "Short, natural sentences. Contractions are fine.",
        "No citations, no headings, no formal sign-offs unless asked for.",
        "Warm and direct: sounding like a person matters more than sounding polished.",
      ];
    case "professional":
      return [
        "Courteous, concise and specific. Lead with the point.",
        "No slang, no filler, no exclamation marks unless the student used them first.",
        "Keep placeholders like [date] visible rather than inventing a fact.",
      ];
    case "academic":
    default:
      return [
        "Formal register, evidence-led, no contractions.",
        "Every claim either cites a source or is marked as the student's own reasoning.",
        "Structure serves the argument: the assignment's own requirements come first.",
      ];
  }
}

export interface ClosenessDecision {
  /** Closeness after coercion, 0-100. */
  closeness: number;
  /** True when the approved guidance should be included in the prompt at all. */
  applyGuidance: boolean;
  /** One prompt line describing how strongly to apply it. Empty when not applied. */
  directive: string;
}

/**
 * Turn a closeness value into an instruction. This is the ONLY place the dial becomes
 * prompt text, so a change here cannot drift between routes.
 *
 * The directive always ends with the precedence rule: the assignment and the teacher win.
 * A student preference never silently overrides academic instruction.
 */
export function closenessDirective(value: unknown): ClosenessDecision {
  const closeness = normalizeCloseness(value);
  if (closeness === 0) {
    return {
      closeness,
      applyGuidance: false,
      directive:
        "The student set their writing personalisation to OFF. Do not imitate their saved writing habits. Apply only the register rules for this kind of writing.",
    };
  }
  const strength =
    closeness <= 25
      ? "only where a word choice clearly benefits"
      : closeness <= 50
        ? "in wording and sentence flow, but keep the structure neutral"
        : closeness <= 75
          ? "in wording, rhythm and structure"
          : "closely - match their wording, rhythm and structure wherever it does not fight the assignment";
  return {
    closeness,
    applyGuidance: true,
    directive:
      `The student set writing personalisation to ${closeness} of 100: apply their approved writing preferences ${strength}. ` +
      "Where a preference conflicts with the assignment's instructions, this course's teacher requirements, or the register rules for this kind of writing, follow the assignment or teacher and tell the student about the conflict instead of choosing silently.",
  };
}

/**
 * The sample filter for one context. Samples marked 'not_representative' are excluded
 * by every caller for the same reason: a student told us that sample is not them.
 *
 * Returned as plain data so tests (and any caller) can assert the isolation rule
 * rather than reading SQL.
 */
export function sampleFilterFor(context: WritingContext): { profile_context: WritingContext; exclude: "not_representative" } {
  return { profile_context: context, exclude: "not_representative" };
}

/** Do two contexts differ? Used to prove isolation in tests and to label a switch. */
export function sameContext(a: unknown, b: unknown): boolean {
  return parseWritingContext(a) === parseWritingContext(b);
}
