/**
 * COURSE ENGINES (spec 2026-10-09, master structure): each course opens a
 * subject-appropriate workspace. The registry is PURE NAVIGATION over the
 * existing pages and AI service — it never modifies data and never
 * duplicates an engine; every tool below routes to a real, implemented page.
 */
export type EngineId =
  | "writing" | "math" | "biology" | "chemistry" | "physics"
  | "humanities" | "programming" | "general";

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
  general: {
    id: "general", label: "General Academic",
    description: "A flexible workspace for any other subject you name.",
  },
};

/** Parent group for the Courses hierarchy (Science nests Biology/Chemistry/Physics). */
export const COURSE_GROUPS: { key: string; label: string; engines: EngineId[] }[] = [
  { key: "english", label: "English", engines: ["writing"] },
  { key: "math", label: "Math", engines: ["math"] },
  { key: "science", label: "Science", engines: ["biology", "chemistry", "physics"] },
  { key: "humanities", label: "History / Social Science", engines: ["humanities"] },
  { key: "cs", label: "Computer Science", engines: ["programming"] },
  { key: "other", label: "Other Subject", engines: ["general"] },
];

export const SUBJECT_ENGINE_HINTS: { pattern: RegExp; engine: EngineId }[] = [
  { pattern: /english|literature|composition|language arts|writing|ela/i, engine: "writing" },
  { pattern: /math|algebra|geometry|calculus|trigonometry|statistics/i, engine: "math" },
  { pattern: /biolog|life science|anatomy|zoolog|botan|ecolog/i, engine: "biology" },
  { pattern: /chem/i, engine: "chemistry" },
  { pattern: /physic|mechanic/i, engine: "physics" },
  { pattern: /history|social|government|civics|economics|geography|humanit/i, engine: "humanities" },
  { pattern: /computer|program|coding|software|informatic/i, engine: "programming" },
];

export function classifyEngine(subject: string | null | undefined): EngineId {
  const s = (subject ?? "").trim();
  if (!s) return "general";
  for (const hint of SUBJECT_ENGINE_HINTS) if (hint.pattern.test(s)) return hint.engine;
  return "general";
}

const tutorTool = (label: string): EngineTool => ({
  label,
  description: "Ask questions about this subject — concepts, explanations, and worked understanding from your own materials.",
  path: "/tutor",
});

const commonTools: EngineTool[] = [
  { label: "Teachers", description: "Teacher profiles, instructions, rubrics, and feedback for this course.", path: "/teachers" },
  { label: "Essay", description: "Staged essay workflow for longer, structured writing assignments.", path: "/essay" },
  { label: "Writing", description: "Short-form writing: discussion posts, short responses, and brief reflections.", path: "/writing" },
  { label: "Library", description: "This course's documents, references, and uploaded materials.", path: "/library" },
  { label: "Memory", description: "Subject-specific memories and corrections for this course.", path: "/learning" },
  { label: "Changes", description: "Chronological record of subject-specific corrections and preference changes.", path: "/proposals" },
];

const typingTool: EngineTool = {
  label: "Typing Calibration",
  description: "Calibrate the paced text reveal to your typing speed. Kept inside the subject workspace — not in Settings.",
  path: "/writing/typing",
};

export const ENGINE_TOOLS: Record<EngineId, EngineTool[]> = {
  // English: exactly the 9 tools from the spec.
  writing: [
    commonTools[0], // Teachers
    { label: "Essay Typing Engine", description: "Substantial essays and longer writing assignments — instructions, outlines, drafts, revisions, references, and preserved draft versions.", path: "/essay" },
    { label: "Writing Engine", description: "Short-form writing: discussion posts, short responses, and brief reflections.", path: "/writing" },
    { label: "Planning Engine", description: "Plan an assignment without completing it: steps, outlines, research questions, evidence, and checklists.", path: "/writing/planning" },
    { label: "Grammar & Spelling Engine", description: "Grammar, spelling, punctuation, and clarity help with explained, individually acceptable corrections.", path: "/writing/grammar" },
    commonTools[3], // Library
    commonTools[4], // Memory
    commonTools[5], // Changes
    typingTool,
  ],
  // Math: exactly the 6 tools from the spec.
  math: [
    commonTools[0], // Teachers
    { label: "Scan Math to Solve", description: "Photograph a problem, confirm the interpreted expression, then solve with verified steps.", path: "/math" },
    { label: "Type to Solve", description: "Enter equations or word problems and get clear notation with step-by-step solutions.", path: "/math?mode=type" },
    { label: "Teach Me How to Solve", description: "Concept-first teaching: why the method works, each step explained, hints on request.", path: "/math?mode=teach" },
    { label: "Test Preparation", description: "Review concepts, build a study plan, and prepare for exams from your own materials.", path: "/math/test-prep" },
    { label: "Practice Problems", description: "Practice problems generated from material you provide — attempt first, then feedback.", path: "/math/practice" },
  ],
  // Science subjects + Humanities + CS + Other: 8 tools each, per the spec.
  biology: [...commonTools, tutorTool("Biology Engine"), typingTool],
  chemistry: [...commonTools, tutorTool("Chemistry Engine"), typingTool],
  physics: [...commonTools, tutorTool("Physics Engine"), typingTool],
  humanities: [...commonTools, tutorTool("Humanities Engine"), typingTool],
  programming: [...commonTools, tutorTool("Programming Engine"), typingTool],
  general: [...commonTools, tutorTool("General Academic Engine"), typingTool],
};

/** Attach the course context to a tool link. */
export function toolUrl(tool: EngineTool, courseId: string | null | undefined): string {
  if (!courseId) return tool.path;
  const sep = tool.path.includes("?") ? "&" : "?";
  return `${tool.path}${sep}course_id=${courseId}`;
}
