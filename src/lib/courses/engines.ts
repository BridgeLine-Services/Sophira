/**
 * COURSE ENGINES + SUBJECT HIERARCHY (nav spec 2026-10-09): every subject
 * opens its own workspace with the tools the spec lists. The registry is
 * PURE NAVIGATION over the existing pages and AI service — it never
 * modifies data, never duplicates an engine, and every tool routes to a
 * real, implemented page.
 */
export type EngineId =
  | "writing" | "math" | "biology" | "chemistry" | "physics"
  | "humanities" | "programming" | "general" | "foreign_language" | "health";

export interface EngineTool {
  label: string;
  description: string;
  path: string;
}

export interface Engine {
  id: EngineId;
  label: string;
  description: string;
}

export const ENGINES: Record<EngineId, Engine> = {
  writing: {
    id: "writing", label: "English",
    description: "Essays, short-form writing, planning, grammar, and typing calibration.",
  },
  math: {
    id: "math", label: "Math",
    description: "Scan or type to solve, teach-me explanations, test preparation, and practice.",
  },
  biology: {
    id: "biology", label: "Biology",
    description: "Biology concepts, terminology, processes, experiments, and explanations.",
  },
  chemistry: {
    id: "chemistry", label: "Chemistry",
    description: "Chemical concepts, reactions, equations, calculations, and lab work.",
  },
  physics: {
    id: "physics", label: "Physics",
    description: "Physics concepts, formulas, units, calculations, and step-by-step explanations.",
  },
  humanities: {
    id: "humanities", label: "History / Social Science",
    description: "Historical analysis, chronology, source evaluation, and evidence.",
  },
  programming: {
    id: "programming", label: "Computer Science",
    description: "Programming explanations, debugging, code review, and algorithms.",
  },
  foreign_language: {
    id: "foreign_language", label: "Foreign Language",
    description: "Vocabulary, grammar, reading, writing, and translation in the selected language.",
  },
  health: {
    id: "health", label: "Health Education",
    description: "Health education coursework, terminology, research, and evidence-based writing.",
  },
  general: {
    id: "general", label: "Other Subject",
    description: "A flexible workspace for any other subject you name.",
  },
};

/**
 * The navigation subject tree (exact spec order). Science is a parent with
 * Biology, Chemistry, and Physics nested beneath it — never top-level.
 */
export interface SubjectNode {
  key: string;
  label: string;
  slug: string;           // route under /courses/
  engines: EngineId[];    // engines classified into this subject
  children?: SubjectNode[];
}

export const SUBJECT_TREE: SubjectNode[] = [
  { key: "english", label: "English", slug: "english", engines: ["writing"] },
  { key: "math", label: "Math", slug: "math", engines: ["math"] },
  {
    key: "science", label: "Science", slug: "science", engines: ["biology", "chemistry", "physics"],
    children: [
      { key: "biology", label: "Biology", slug: "science/biology", engines: ["biology"] },
      { key: "chemistry", label: "Chemistry", slug: "science/chemistry", engines: ["chemistry"] },
      { key: "physics", label: "Physics", slug: "science/physics", engines: ["physics"] },
    ],
  },
  { key: "humanities", label: "History / Social Science", slug: "history-social-science", engines: ["humanities"] },
  { key: "foreign_language", label: "Foreign Language", slug: "foreign-language", engines: ["foreign_language"] },
  { key: "health", label: "Health Education", slug: "health-education", engines: ["health"] },
  { key: "other", label: "Other Subject", slug: "other-subject", engines: ["general", "programming"] },
];

/** Flat list of every navigable subject node (science children included). */
export const SUBJECT_PAGES: SubjectNode[] = [
  ...SUBJECT_TREE,
  ...(SUBJECT_TREE.find((n) => n.key === "science")?.children ?? []),
];

export function subjectBySlug(slug: string): SubjectNode | null {
  return SUBJECT_PAGES.find((n) => n.slug === slug) ?? null;
}

/** Parent groups for the /courses page (user course records). */
export const COURSE_GROUPS: { key: string; label: string; engines: EngineId[] }[] =
  SUBJECT_TREE.map((n) => ({ key: n.key, label: n.label, engines: n.engines }));

export const SUBJECT_ENGINE_HINTS: { pattern: RegExp; engine: EngineId }[] = [
  { pattern: /english|literature|composition|language arts|ela|writing/i, engine: "writing" },
  { pattern: /math|algebra|geometry|calculus|trigonometry|statistics/i, engine: "math" },
  { pattern: /biolog|life science|anatomy|zoolog|botan|ecolog/i, engine: "biology" },
  { pattern: /chem/i, engine: "chemistry" },
  { pattern: /physic|mechanic/i, engine: "physics" },
  { pattern: /history|social|government|civics|economics|geography|humanit/i, engine: "humanities" },
  { pattern: /\bspanish\b|\bfrench\b|\bgerman\b|\bjapanese\b|\bchinese\b|\blatin\b|\bitalian\b|\bportuguese\b|\bkorean\b|\barabic\b|\brussian\b|foreign language|\blanguage\b/i, engine: "foreign_language" },
  { pattern: /health|nutrition|wellness|first aid|\bPE\b|physical education|medical terminology/i, engine: "health" },
  { pattern: /computer|program|coding|software|informatic/i, engine: "programming" },
];

export function classifyEngine(subject: string | null | undefined): EngineId {
  const s = (subject ?? "").trim();
  if (!s) return "general";
  for (const hint of SUBJECT_ENGINE_HINTS) if (hint.pattern.test(s)) return hint.engine;
  return "general";
}

const commonTools: EngineTool[] = [
  { label: "Teachers", description: "Teacher profiles, instructions, rubrics, and feedback.", path: "/teachers" },
  { label: "Essay", description: "Staged essay workflow for longer, structured writing assignments.", path: "/essay" },
  { label: "Writing", description: "Short-form writing: discussion posts, short responses, and brief reflections.", path: "/writing" },
  { label: "Library", description: "This subject's documents, references, and uploaded materials.", path: "/library" },
  { label: "Memory", description: "Subject-specific memories, corrections, and learning patterns.", path: "/learning" },
  { label: "Changes", description: "Chronological record of subject-specific corrections and preference changes.", path: "/proposals" },
];

const typingTool: EngineTool = {
  label: "Typing and Writing Calibration",
  description: "Calibrate the paced text reveal to your typing speed. Kept inside the subject workspace — not in Settings.",
  path: "/writing/typing",
};

export const ENGINE_TOOLS: Record<EngineId, EngineTool[]> = {
  // English: exactly the 9 tools from the spec.
  writing: [
    commonTools[0],
    { label: "Essay Writing Engine", description: "Substantial essays and longer writing assignments — instructions, outlines, drafts, revisions, references, and preserved draft versions.", path: "/essay" },
    { label: "Short Writing Engine", description: "Discussion posts, short assignments, paragraphs, brief responses, and other short-form writing.", path: "/writing" },
    { label: "Planning Engine", description: "Plan an assignment without completing it: steps, outlines, research questions, evidence, and checklists.", path: "/writing/planning" },
    { label: "Grammar and Spelling Engine", description: "Grammar, spelling, punctuation, sentence structure, clarity, and revision with explained, individually acceptable corrections.", path: "/writing/grammar" },
    commonTools[3],
    commonTools[4],
    commonTools[5],
    typingTool,
  ],
  // Math: exactly the 10 tools from the spec.
  math: [
    commonTools[0],
    { label: "Scan to Solve", description: "Photograph a problem, confirm the interpreted expression, then solve with verified steps.", path: "/math" },
    { label: "Type to Solve", description: "Enter equations or word problems and get clear notation with step-by-step solutions.", path: "/math?mode=type" },
    { label: "Teach Me How to Solve", description: "Concept-first teaching: why the method works, each step explained, hints on request.", path: "/math?mode=teach" },
    { label: "Test Preparation", description: "Review concepts, build a study plan, and prepare for exams from your own materials.", path: "/math/test-prep" },
    { label: "Practice Problems", description: "Practice problems generated from material you provide — attempt first, then feedback.", path: "/math/practice" },
    commonTools[3],
    commonTools[4],
    commonTools[5],
    typingTool,
  ],
  // Foreign Language: 8 tools, starting with the language selector.
  foreign_language: [
    { label: "Language Selector", description: "Choose your target language, explanation language, and proficiency level.", path: "/courses/foreign-language/language-selector" },
    commonTools[0],
    commonTools[1],
    commonTools[2],
    commonTools[3],
    commonTools[4],
    commonTools[5],
    typingTool,
  ],
  // Science subjects, History, Health, CS, and Other: 7 tools each.
  biology: [...commonTools, typingTool],
  chemistry: [...commonTools, typingTool],
  physics: [...commonTools, typingTool],
  humanities: [...commonTools, typingTool],
  health: [...commonTools, typingTool],
  programming: [...commonTools, typingTool],
  general: [...commonTools, typingTool],
};

/** Tools that honor a subject scope (?subject=) at the destination page. */
const SUBJECT_SCOPED_PATHS = new Set(["/library", "/learning", "/proposals"]);

/** Attach the course context to a tool link (course workspaces). */
export function toolUrl(tool: EngineTool, courseId: string | null | undefined): string {
  if (!courseId) return tool.path;
  const sep = tool.path.includes("?") ? "&" : "?";
  return `${tool.path}${sep}course_id=${courseId}`;
}

/** Attach the subject scope to a tool link (subject workspaces). */
export function subjectToolUrl(tool: EngineTool, slug: string): string {
  if (!SUBJECT_SCOPED_PATHS.has(tool.path.split("?")[0])) return tool.path;
  const sep = tool.path.includes("?") ? "&" : "?";
  return `${tool.path}${sep}subject=${slug}`;
}
