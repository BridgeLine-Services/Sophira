/**
 * COURSE ENGINE WORKSPACE (2026-10-09): every course opens into its own
 * subject-appropriate workspace; typing calibration relocated to the
 * Writing Engine; Learning + Memory consolidated into one destination;
 * Library scoped by course with server-enforced filtering.
 */
import { readFileSync } from "fs";
import {
  classifyEngine, ENGINES, ENGINE_TOOLS, toolUrl,
} from "../src/lib/courses/engines";

export function runCourseEngineTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Course engine: subjects, workspaces, relocation, consolidation");

  // ---- 1. Every supported subject opens the correct engine -----------------
  assert(classifyEngine("English Literature") === "writing", "engine: English Literature routes to the Writing Engine");
  assert(classifyEngine("Algebra II") === "math", "engine: Algebra routes to the Math Engine");
  assert(classifyEngine("AP Biology") === "biology", "engine: Biology routes to the Biology Engine");
  assert(classifyEngine("Organic Chemistry") === "chemistry", "engine: Chemistry routes to the Chemistry Engine");
  assert(classifyEngine("Physics C: Mechanics") === "physics", "engine: Physics routes to the Physics Engine");
  assert(classifyEngine("US History") === "humanities", "engine: History routes to the Humanities Engine");
  assert(classifyEngine("Computer Science") === "programming", "engine: Computer Science routes to the Programming Engine");
  assert(classifyEngine(null) === "general" && classifyEngine("Woodworking") === "general",
    "engine: unknown or missing subjects fall back to the General Academic Engine — never a invented specialty");

  // ---- 2. Writing Engine exposes exactly the specified tools ----------------
  const writingLabels = ENGINE_TOOLS.writing.map((t) => t.label);
  for (const required of ["Teachers", "Essay", "Writing", "Library", "Memory", "Changes", "Typing Calibration"]) {
    assert(writingLabels.includes(required), `engine: Writing Engine exposes ${required}`);
  }
  const mathLabels = ENGINE_TOOLS.math.map((t) => t.label);
  assert(mathLabels.length === 2 && mathLabels.includes("Teachers") && mathLabels.includes("Scan Math"),
    "engine: Math Engine exposes Teachers + Scan Math only (no second solver, no duplicated math logic)");

  // ---- 3. Non-math engines: academic tools, no math primary workflow --------
  for (const id of ["biology", "chemistry", "physics", "humanities", "programming", "general"] as const) {
    const labels = ENGINE_TOOLS[id].map((t) => t.label);
    for (const required of ["Teachers", "Essay", "Writing", "Library", "Memory", "Changes"]) {
      assert(labels.includes(required), `engine: ${ENGINES[id].label} exposes ${required}`);
    }
    assert(!labels.includes("Scan Math") && !labels.includes("Typing Calibration"),
      `engine: ${ENGINES[id].label} keeps math-specific tools out of its primary workflow`);
  }

  // ---- 4. Tool URLs carry the course context --------------------------------
  assert(toolUrl(ENGINE_TOOLS.writing[0], "abc-123") === "/teachers?course_id=abc-123",
    "engine: tool links attach the course_id so context travels with every tool");

  // ---- 5. Course page renders the engine workspace ---------------------------
  const coursePage = readFileSync("src/app/courses/[id]/page.tsx", "utf8");
  assert(coursePage.includes("classifyEngine") && coursePage.includes("ENGINE_TOOLS") && coursePage.includes("toolUrl"),
    "course: the course detail page classifies the subject and renders the engine's tool grid");
  assert(coursePage.includes("sm:grid-cols-2 lg:grid-cols-3"),
    "course: the workspace tool grid is responsive (phones, tablets, desktop)");
  assert(coursePage.includes("No teacher selected") || coursePage.includes("No subject set"),
    "course: missing teacher/subject shows an honest empty state instead of inventing requirements");
  assert(coursePage.includes("/assignments/new?course_id="),
    "course: assignment creation from the course keeps the course context attached");

  // ---- 6. Typing calibration relocated to the Writing Engine ----------------
  const settingsPage = readFileSync("src/app/settings/page.tsx", "utf8");
  assert(!settingsPage.includes("TypingTest") && !settingsPage.includes("Typing calibration"),
    "typing: Settings no longer renders typing calibration (relocated, not duplicated)");
  assert(settingsPage.includes("/api/account/export") && settingsPage.includes("Delete my account"),
    "typing: Settings retains data export and account deletion");
  const typingPage = readFileSync("src/app/writing/typing/page.tsx", "utf8");
  assert(typingPage.includes("TypingTest"), "typing: /writing/typing hosts the SAME TypingTest component (history and baseline untouched)");
  assert(typingPage.includes("requireUser"), "typing: /writing/typing enforces the same session guard as every protected page");
  assert(!readFileSync("src/app/api/typing/route.ts", "utf8").includes("course_id"),
    "typing: the /api/typing backend is unchanged — no recalibration, no schema change");

  // ---- 7. Learning + Memory consolidated -------------------------------------
  const learningPage = readFileSync("src/app/learning/page.tsx", "utf8");
  assert(learningPage.includes("CorrectionsPanel") && learningPage.includes("MemoryManager"),
    "learning: /learning renders corrections/patterns AND memories as separate sections");
  assert(learningPage.includes("student_memories") && learningPage.includes("learning_patterns"),
    "learning: the unified page reads the EXISTING tables (no parallel data store)");
  assert(readFileSync("src/app/corrections/page.tsx", "utf8").includes('redirect("/learning")'),
    "learning: /corrections remains as a backward-compatible redirect (nothing deleted)");
  assert(readFileSync("src/app/memories/page.tsx", "utf8").includes('redirect("/learning")'),
    "learning: /memories remains as a backward-compatible redirect (nothing deleted)");
  const nav = readFileSync("src/components/app/AppShell.tsx", "utf8");
  assert(nav.includes('"Learning / Memory"') && nav.includes('"/learning"'),
    "learning: the navigation exposes ONE Learning / Memory destination");
  assert(!nav.includes('"/corrections"') && !nav.includes('"/memories"'),
    "learning: the old separate Learning and Memory nav entries are gone");
  assert(learningPage.includes("/writing/typing") && !learningPage.includes("/typing-calibration"),
    "learning: the setup checklist points at the REAL /writing/typing route (broken /typing-calibration link fixed)");

  // ---- 8. Course-scoped Library ----------------------------------------------
  const migration = readFileSync("supabase/migrations/0029_study_materials_course.sql", "utf8");
  assert(migration.includes("add column if not exists course_id"),
    "library: migration 0029 adds the optional course_id (only added because the schema could not scope by course)");
  assert(!migration.includes("create policy") && !migration.includes("drop policy"),
    "library: migration 0029 does NOT touch RLS policies — study_materials_own continues to govern every row");
  assert(!migration.includes("drop table") && !migration.includes("drop column"),
    "library: migration 0029 is additive only (no destructive operations)");
  const libraryPage = readFileSync("src/app/library/page.tsx", "utf8");
  assert(libraryPage.includes('searchParams.get("course_id")'),
    "library: the Library page accepts a course context");
  assert(libraryPage.includes('.eq("course_id", courseId)'),
    "library: course filtering happens in the DATABASE QUERY (RLS client), not only in the browser");
  assert(libraryPage.includes('.is("course_id", null)'),
    "library: intentionally-global materials (no course, no assignment) remain visible in the course view");
  assert(libraryPage.includes("byId.set"),
    "library: merged course/assignment/global results are deduplicated (no duplicate material records)");
  assert(libraryPage.includes("course_id: courseId"),
    "library: notes saved from a course library attach to that course");
  assert(libraryPage.includes("Suspense"),
    "library: useSearchParams is wrapped in a Suspense boundary (build-safe prerendering)");

  // ---- 9. Essay workflow receives course context -----------------------------
  const essayPage = readFileSync("src/app/essay/page.tsx", "utf8");
  assert(essayPage.includes('searchParams.get("course_id")'),
    "essay: the Essay workspace accepts a course context");
  assert(essayPage.includes("course_id: courseId"),
    "essay: the course_id is passed to /api/essay/plan so it persists on the session");
  const planRoute = readFileSync("src/app/api/essay/plan/route.ts", "utf8");
  assert(planRoute.includes("course_id?: string | null") && planRoute.includes("course_id: body.course_id ?? null"),
    "essay: the plan API already persists course_id + teacher_id on the session (assignment context retained)");
  assert(essayPage.includes("Back to the course"),
    "essay: the course workspace provides an easy route back to the course");

  // ---- 9b. Memory view honors the course boundary -----------------------------
  const managerSrc = readFileSync("src/components/app/MemoryManager.tsx", "utf8");
  assert(managerSrc.includes("subjectFilter"),
    "memory: the memory list supports a course-subject filter (subject + global memories only)");
  assert(learningPage.includes("searchParams?.course_id") && learningPage.includes("subjectFilter"),
    "memory: /learning?course_id= narrows the memories section to the course's subject via an RLS-scoped course read");
  assert(ENGINE_TOOLS.general.some((t) => t.path === "/learning"),
    "memory: the engine Memory tool routes to the unified Learning / Memory destination with course context");

  // ---- 10. Owner routes and authorization untouched ---------------------------
  const ownerPage = readFileSync("src/app/owner/page.tsx", "utf8");
  assert(ownerPage.length > 0, "owner: the Owner Dashboard route still exists");
  assert(readFileSync("src/middleware.ts", "utf8").includes("/owner"),
    "owner: the middleware still guards the owner route");

  // ---- 11. Subject isolation: engines never rewrite learning scope ------------
  const enginesSrc = readFileSync("src/lib/courses/engines.ts", "utf8");
  assert(!enginesSrc.includes("learning_patterns") && !enginesSrc.includes("update("),
    "scope: the engine registry is pure navigation — it cannot modify learning data or cross subjects");
  const subjectsSrc = readFileSync("src/lib/ai/subjects.ts", "utf8");
  assert(subjectsSrc.includes("routeSubject"),
    "scope: the existing subject router keeps composing subject-appropriate AI context (no parallel engine)");
}
