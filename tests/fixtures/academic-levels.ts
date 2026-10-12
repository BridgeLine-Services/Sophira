/**
 * ACADEMIC-LEVEL EVALUATION FIXTURES (2026-10-12).
 *
 * Representative tasks per subject engine, each with per-level behavioral
 * expectations. These are evaluation fixtures: every expectation is
 * anchored in the SHARED academic-level guidance (a meaningful token
 * must appear in that level's guidance text), and expectations must
 * genuinely DIVERGE across levels — they cannot be copy-paste.
 */

export const LEVEL_IDS = ["preschool", "elementary", "middle", "high-school", "undergraduate", "graduate", "doctoral", "custom"] as const;
export type LevelId = (typeof LEVEL_IDS)[number];

export interface AcademicTaskFixture {
  /** Engine id from the subject registry. */
  engine: string;
  /** A representative, honest task a learner might bring to this engine. */
  task: string;
  /** Behavioral markers the AI must apply for this task at each level.
   *  Each marker must share a meaningful token with that level's guidance. */
  expectations: Partial<Record<LevelId, string[]>>;
}

export const ACADEMIC_TASKS: AcademicTaskFixture[] = [
  {
    engine: "writing",
    task: "Draft a persuasive essay with a clear thesis and supporting evidence",
    expectations: {
      preschool: ["very short sentences and everyday words: one simple reason, told like a story"],
      elementary: ["simple, friendly language and short steps: a beginning, a middle reason, and an ending"],
      middle: ["define new terms when they first appear and show each step plainly: claim, reason, example"],
      "high-school": ["formal concepts and standard notation step by step: thesis statement, evidence, analysis"],
      undergraduate: ["discipline-standard terminology and assume prerequisite coursework: argument structure, evidence, and stated limitations"],
      graduate: ["methodological rigor and competing interpretations: situate the argument in current literature"],
      doctoral: ["critical analysis, methodology, and positioning of contributions; scholarly citation conventions"],
      custom: ["ask rather than guess: follow the user's stated level description"],
    },
  },
  {
    engine: "math",
    task: "Solve a linear equation and explain why each step works",
    expectations: {
      preschool: ["everyday words: count objects; tiny visual numbers"],
      elementary: ["concrete examples from daily life; guide practice with immediate encouragement"],
      middle: ["build from concrete to abstract; show each step plainly"],
      "high-school": ["standard notation step by step; explain why a method works; moderate scaffolding"],
      undergraduate: ["assume prerequisite coursework; emphasize reasoning and stated assumptions"],
      graduate: ["qualify claims precisely; substantial independence in problem solving"],
      doctoral: ["discuss uncertainty and limitations rigorously"],
      custom: ["follow the user's stated level description"],
    },
  },
  {
    engine: "chemistry",
    task: "Balance a reaction and compute a stoichiometric yield",
    expectations: {
      elementary: ["concrete examples from daily life; a new term only with a plain definition beside it"],
      middle: ["define new terms when they first appear, show each step plainly"],
      "high-school": ["formal concepts and standard notation step by step"],
      undergraduate: ["discipline-standard terminology and assume prerequisite coursework"],
      graduate: ["methodological rigor; qualify claims precisely"],
      doctoral: ["critical analysis and rigorous treatment of uncertainty and limitations"],
      custom: ["follow the user's stated level description"],
    },
  },
  {
    engine: "physics",
    task: "Model a projectile problem with unit conversion",
    expectations: {
      middle: ["build from concrete to abstract; show each step plainly"],
      "high-school": ["standard notation step by step; explain why a method works"],
      undergraduate: ["emphasize reasoning, stated assumptions, and limitations"],
      graduate: ["methodological rigor; substantial independence"],
      doctoral: ["discuss uncertainty and limitations rigorously; critical analysis"],
      custom: ["follow the user's stated level description"],
    },
  },
  {
    engine: "humanities",
    task: "Evaluate a primary source and build a historical argument",
    expectations: {
      elementary: ["simple, friendly language; concrete examples from daily life"],
      middle: ["define new terms when they first appear"],
      "high-school": ["formal concepts step by step; explain why a method works"],
      undergraduate: ["discipline-standard terminology; refer to standard sources where relevant"],
      graduate: ["competing interpretations and current literature"],
      doctoral: ["critical analysis, methodology, theory; scholarly citation conventions"],
      custom: ["follow the user's stated level description"],
    },
  },
  {
    engine: "foreign_language",
    task: "Correct a learner's paragraph and explain why each construction is right or wrong",
    expectations: {
      elementary: ["simple, friendly language and short steps; immediate encouragement"],
      middle: ["define new terms when they first appear; check understanding with quick questions"],
      "high-school": ["formal concepts step by step; expect independence on routine steps"],
      undergraduate: ["discipline-standard terminology; assume prerequisite coursework"],
      graduate: ["competing interpretations; substantial independence"],
      doctoral: ["critical analysis; qualified discussion of uncertainty"],
      custom: ["follow the user's stated level description"],
    },
  },
  {
    engine: "health",
    task: "Explain how a body system works, for academic study",
    expectations: {
      preschool: ["very short sentences and everyday words; concrete objects"],
      elementary: ["simple, friendly language; plain definitions beside new terms"],
      middle: ["show each step plainly; one or two quick understanding checks"],
      "high-school": ["formal concepts and standard notation step by step"],
      undergraduate: ["discipline-standard terminology; stated assumptions and limitations"],
      graduate: ["methodological rigor; current literature"],
      doctoral: ["critical analysis, methodology; scholarly conventions"],
      custom: ["follow the user's stated level description"],
    },
  },
];
