/**
 * Course Engine workspace (spec: course-engine navigation, 2026-10-09).
 *
 * Every course opens into its own academic workspace. The course's subject
 * determines WHICH ENGINE the workspace exposes; the engines do NOT create
 * new AI backends — every tool routes to an existing page/API, and the
 * existing subject router (`src/lib/ai/subjects.ts`) continues to compose
 * subject-appropriate AI context server-side.
 */

export type EngineId =
  | "writing" | "math" | "biology" | "chemistry" | "physics"
  | "humanities" | "programming" | "general";

export interface EngineDefinition {
  id: EngineId;
  label: string;
  description: string;
}

export const ENGINES: Record<EngineId, EngineDefinition> = {
  writing: { id: "writing", label: "Writing Engine", description: "Essays, staged drafting, verification, paced presentation, and typing calibration." },
  math: { id: "math", label: "Math Engine", description: "Scan-to-solve with teacher-required methods, step-by-step solutions, and independent verification." },
  biology: { id: "biology", label: "Biology Engine", description: "Biology assignments, reports, and short responses with biology-appropriate AI context." },
  chemistry: { id: "chemistry", label: "Chemistry Engine", description: "Chemistry problems, labs, and reports with chemistry-appropriate AI context." },
  physics: { id: "physics", label: "Physics Engine", description: "Physics problems, labs, and reports with physics-appropriate AI context." },
  humanities: { id: "humanities", label: "Humanities Engine", description: "History and social-science essays, research, and short responses." },
  programming: { id: "programming", label: "Programming Engine", description: "Computer-science assignments, code walkthroughs, and short responses." },
  general: { id: "general", label: "General Academic Engine", description: "General academic assignments, essays, and short responses." },
};

/**
 * Classify a free-text course subject into the supported engine.
 * Falls back to the General Academic Engine — never invents a specialty.
 */
export function classifyEngine(subject: string | null | undefined): EngineId {
  const s = (subject ?? "").toLowerCase();
  if (!s) return "general";
  if (/(english|literature|composition|rhetoric|writing|lang(ual)?arts|ela\b)/.test(s)) return "writing";
  if (/(math|algebra|geometry|calculus|statistic|trigonometry|precalc|arith)/.test(s)) return "math";
  if (/(biology|anatomy|physiology|botany|zoology|ecology|marine sci|life science)/.test(s)) return "biology";
  if (/(chemistry|chem\b|organic|biochem)/.test(s)) return "chemistry";
  if (/(physics|physical science|astronomy|mechanics\b)/.test(s)) return "physics";
  if (/(history|social|government|civics|economics|psychology|sociology|geography|humanities|anthropology|philosophy|religion|art history|music history)/.test(s)) return "humanities";
  if (/(computer|programming|coding|software|informatics|data science|cs\b|python|java\b|javascript|web dev)/.test(s)) return "programming";
  return "general";
}

export interface EngineTool {
  label: string;
  /** href WITHOUT the course_id query parameter — the workspace appends it. */
  path: string;
  description: string;
}

/**
 * Tools per engine (spec §2A–§2C). Mathematics-specific tools are the primary
 * workflow ONLY in the Math Engine; every other subject keeps Essay + Writing
 * available because assignments in any subject may require written work.
 */
export const ENGINE_TOOLS: Record<EngineId, EngineTool[]> = {
  writing: [
    { label: "Teachers", path: "/teachers", description: "Teacher profiles and course-specific instructions." },
    { label: "Essay", path: "/essay", description: "Assignment analysis, outline approval, staged drafting, verification, paced presentation." },
    { label: "Writing", path: "/writing", description: "Writing profile, samples, and short-writing assistance." },
    { label: "Library", path: "/library", description: "Saved materials for this course." },
    { label: "Memory", path: "/learning", description: "Subject- and course-specific memories." },
    { label: "Changes", path: "/proposals", description: "Proposed and approved academic-profile changes." },
    { label: "Typing Calibration", path: "/writing/typing", description: "Calibrate typing speed; sets pacing for essay presentation." },
  ],
  math: [
    { label: "Teachers", path: "/teachers", description: "Teacher profiles and required methods." },
    { label: "Scan Math", path: "/math", description: "Scan or type a problem; teacher-required methods, steps, independent verification." },
  ],
  biology: [
    { label: "Teachers", path: "/teachers", description: "Teacher profiles and course-specific instructions." },
    { label: "Essay", path: "/essay", description: "Reports and essays with biology-appropriate context." },
    { label: "Writing", path: "/writing", description: "Short responses and reflections." },
    { label: "Library", path: "/library", description: "Saved materials for this course." },
    { label: "Memory", path: "/learning", description: "Subject- and course-specific memories." },
    { label: "Changes", path: "/proposals", description: "Proposed and approved academic-profile changes." },
  ],
  chemistry: [
    { label: "Teachers", path: "/teachers", description: "Teacher profiles and course-specific instructions." },
    { label: "Essay", path: "/essay", description: "Lab reports and essays with chemistry-appropriate context." },
    { label: "Writing", path: "/writing", description: "Short responses and reflections." },
    { label: "Library", path: "/library", description: "Saved materials for this course." },
    { label: "Memory", path: "/learning", description: "Subject- and course-specific memories." },
    { label: "Changes", path: "/proposals", description: "Proposed and approved academic-profile changes." },
  ],
  physics: [
    { label: "Teachers", path: "/teachers", description: "Teacher profiles and course-specific instructions." },
    { label: "Essay", path: "/essay", description: "Lab reports and essays with physics-appropriate context." },
    { label: "Writing", path: "/writing", description: "Short responses and reflections." },
    { label: "Library", path: "/library", description: "Saved materials for this course." },
    { label: "Memory", path: "/learning", description: "Subject- and course-specific memories." },
    { label: "Changes", path: "/proposals", description: "Proposed and approved academic-profile changes." },
  ],
  humanities: [
    { label: "Teachers", path: "/teachers", description: "Teacher profiles and course-specific instructions." },
    { label: "Essay", path: "/essay", description: "Research essays and long-form writing." },
    { label: "Writing", path: "/writing", description: "Discussion posts and short responses." },
    { label: "Library", path: "/library", description: "Saved materials for this course." },
    { label: "Memory", path: "/learning", description: "Subject- and course-specific memories." },
    { label: "Changes", path: "/proposals", description: "Proposed and approved academic-profile changes." },
  ],
  programming: [
    { label: "Teachers", path: "/teachers", description: "Teacher profiles and course-specific instructions." },
    { label: "Essay", path: "/essay", description: "Design documents and essays." },
    { label: "Writing", path: "/writing", description: "Short responses and reflections." },
    { label: "Library", path: "/library", description: "Saved materials for this course." },
    { label: "Memory", path: "/learning", description: "Subject- and course-specific memories." },
    { label: "Changes", path: "/proposals", description: "Proposed and approved academic-profile changes." },
  ],
  general: [
    { label: "Teachers", path: "/teachers", description: "Teacher profiles and course-specific instructions." },
    { label: "Essay", path: "/essay", description: "Full essay workflow." },
    { label: "Writing", path: "/writing", description: "Short responses and reflections." },
    { label: "Library", path: "/library", description: "Saved materials for this course." },
    { label: "Memory", path: "/learning", description: "Subject- and course-specific memories." },
    { label: "Changes", path: "/proposals", description: "Proposed and approved academic-profile changes." },
  ],
};

/** Build the tool URL for a specific course (course context stays attached). */
export function toolUrl(tool: EngineTool, courseId: string): string {
  return `${tool.path}?course_id=${encodeURIComponent(courseId)}`;
}
