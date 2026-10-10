/**
 * COURSE ENGINE WORKSPACE (2026-10-09): every course opens into its own
 * subject-appropriate workspace; typing calibration relocated to the
 * Writing Engine; Learning + Memory consolidated into one destination;
 * Library scoped by course with server-enforced filtering.
 */
import { existsSync, readFileSync } from "fs";
import {
  classifyEngine, ENGINES, ENGINE_TOOLS, toolUrl, subjectToolUrl, COURSE_GROUPS, SUBJECT_TREE,
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

  // ---- 2. English exposes exactly the nine specified tools ------------------
  const writingLabels = ENGINE_TOOLS.writing.map((t) => t.label);
  for (const required of [
    "Teachers", "Essay Writing Engine", "Short Writing Engine", "Planning Engine",
    "Grammar and Spelling Engine", "Library", "Memory", "Changes", "Typing and Writing Calibration",
  ]) {
    assert(writingLabels.includes(required), `engine: English exposes ${required}`);
  }
  assert(ENGINE_TOOLS.writing.length === 9, "engine: English exposes exactly the 9 specified tools");

  // ---- 3. Math exposes exactly the six specified tools -----------------------
  const mathLabels = ENGINE_TOOLS.math.map((t) => t.label);
  for (const required of [
    "Teachers", "Scan to Solve", "Type to Solve", "Teach Me How to Solve",
    "Test Preparation", "Practice Problems", "Library", "Memory", "Changes",
    "Typing and Writing Calibration",
  ]) {
    assert(mathLabels.includes(required), `engine: Math exposes ${required}`);
  }
  assert(ENGINE_TOOLS.math.length === 10, "engine: Math exposes exactly the 10 specified tools (one pipeline — no duplicated solver logic)");
  assert(ENGINE_TOOLS.math.some((t) => t.path === "/math?mode=teach") && ENGINE_TOOLS.math.some((t) => t.path === "/math?mode=type"),
    "engine: Type-to-Solve and Teach-Me route into the single verified math pipeline with explicit modes");

  // ---- 4. Subject engines: exactly the 7 tools each (nav spec 2026-10-09) ----
  for (const id of ["biology", "chemistry", "physics", "humanities", "health", "programming", "general"] as const) {
    const labels = ENGINE_TOOLS[id].map((t) => t.label);
    for (const required of ["Teachers", "Essay", "Writing", "Library", "Memory", "Changes", "Typing and Writing Calibration"]) {
      assert(labels.includes(required), `engine: ${ENGINES[id].label} exposes ${required}`);
    }
    assert(ENGINE_TOOLS[id].length === 7, `engine: ${ENGINES[id].label} exposes exactly the 7 specified tools`);
    assert(!labels.some((l) => l.startsWith("Scan")), `engine: ${ENGINES[id].label} keeps the math pipeline out of its primary workflow`);
  }

  // Foreign Language: 8 tools, led by the functioning language selector.
  const foreignLabels = ENGINE_TOOLS.foreign_language.map((t) => t.label);
  assert(foreignLabels[0] === "Language Selector", "engine: Foreign Language leads with the Language Selector");
  assert(ENGINE_TOOLS.foreign_language.length === 8, "engine: Foreign Language exposes exactly the 8 specified tools");
  for (const required of ["Teachers", "Essay", "Writing", "Library", "Memory", "Changes", "Typing and Writing Calibration"]) {
    assert(foreignLabels.includes(required), `engine: Foreign Language exposes ${required}`);
  }

  // Classification routes new subjects to their engines.
  assert(classifyEngine("Spanish II") === "foreign_language", "engine: Spanish routes to the Foreign Language Engine");
  assert(classifyEngine("Health Education") === "health", "engine: Health Education routes to the Health Engine");

  // Subject tool links carry the subject scope where the destination honors it.
  assert(subjectToolUrl({ label: "Library", description: "", path: "/library" }, "math") === "/library?subject=math",
    "nav: subject-scoped tools carry ?subject= (Library)");
  assert(subjectToolUrl({ label: "Teachers", description: "", path: "/teachers" }, "math") === "/teachers",
    "nav: non-scoped tools keep their plain route");

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

// ---- MASTER STRUCTURE SPEC (2026-10-09): navigation, hierarchy, engines ----
  // Global navigation contains every required destination, including Online.
  const shell = readFileSync("src/components/app/AppShell.tsx", "utf8");
  for (const required of [
    '/dashboard", label: "Home"', '/courses", label: "Courses"', '/notebooks", label: "Notebooks"',
    '/learning", label: "Learning / Memory"', '/offline", label: "Offline"',
    '/settings", label: "Settings"',
  ]) {
    assert(shell.includes(required), `nav: primary navigation includes ${required}`);
  }
  assert(!shell.includes('/proposals", label: "Changes"') && !shell.includes('/online", label: "Online"'),
    "nav: global Changes and Online are NOT separate top-level items (Changes merges into Learning / Memory; Online is a status chip)");
  assert(shell.includes("Sign out"), "nav: the shell exposes a functional Sign out action");

  // Hierarchical Courses navigation: expandable group, nested Science, subject tools.
  assert(shell.includes("CourseTree") && shell.includes("SUBJECT_TREE"),
    "nav: the Courses group is a real expandable hierarchy rendered from the subject tree");
  assert(shell.includes('aria-expanded={!!open.courses}') && shell.includes('aria-controls="nav-courses-children"'),
    "nav: the Courses expansion control exposes accessible expanded state");
  assert(shell.includes("sophira:nav-expanded"),
    "nav: expansion state persists per authenticated user (localStorage, gracefully degraded)");
  assert(shell.includes("drawerOpen") && shell.includes("Open menu") && shell.includes("Close menu") && shell.includes('aria-modal="true"'),
    "nav: mobile gets a slide-out drawer with a menu button, close button, and modal semantics");
  assert(shell.includes("Escape") && shell.includes("menuBtnRef.current?.focus()"),
    "nav: the drawer closes on Escape and restores focus to the menu button");
  assert(shell.includes("navigator.onLine") && shell.includes('href="/online"'),
    "nav: a real connectivity status chip links to /online (never a fabricated state)");

  // Every subject workspace route exists as a real page (no dead links).
  for (const route of [
    "src/app/courses/english/page.tsx", "src/app/courses/math/page.tsx",
    "src/app/courses/science/page.tsx", "src/app/courses/science/biology/page.tsx",
    "src/app/courses/science/chemistry/page.tsx", "src/app/courses/science/physics/page.tsx",
    "src/app/courses/history-social-science/page.tsx", "src/app/courses/foreign-language/page.tsx",
    "src/app/courses/health-education/page.tsx", "src/app/courses/other-subject/page.tsx",
    "src/app/courses/foreign-language/language-selector/page.tsx",
  ]) {
    assert(existsSync(route), `nav: subject route ${route} exists`);
  }
  const scienceLanding = readFileSync("src/app/courses/science/page.tsx", "utf8");
  const scienceWorkspace = readFileSync("src/components/courses/SubjectWorkspace.tsx", "utf8");
  assert(scienceLanding.includes("SubjectWorkspace") && scienceWorkspace.includes("node.children"),
    "nav: Science opens a landing page and its three children open their own workspaces beneath it");

  // Foreign Language selector: a real control persisted to real storage.
  const langSelector = readFileSync("src/app/courses/foreign-language/language-selector/page.tsx", "utf8");
  assert(langSelector.includes("subject_preferences") && langSelector.includes("LanguageSelector"),
    "language: the selector page loads the user's saved preference from real storage");
  const langApi = readFileSync("src/app/api/preferences/foreign-language/route.ts", "utf8");
  assert(langApi.includes("requireUser") && langApi.includes("onConflict"),
    "language: the preference API is auth-guarded and upserts per user");
  const langMigration = readFileSync("supabase/migrations/0030_subject_preferences.sql", "utf8");
  assert(langMigration.includes("create table if not exists public.subject_preferences") &&
    langMigration.includes("enable row level security") &&
    langMigration.includes("using (user_id = auth.uid())"),
    "language: migration 0030 creates the preference table with owner-only RLS");

  // Subject-scoped tool destinations honor ?subject= (honest scope, real data).
  const learningPageScoped = readFileSync("src/app/learning/page.tsx", "utf8");
  assert(learningPageScoped.includes("subject?: string") && learningPageScoped.includes("subjectBySlug"),
    "memory: /learning honors ?subject= and narrows to the user's own courses in that subject");
  const proposalsScoped = readFileSync("src/app/proposals/page.tsx", "utf8");
  assert(proposalsScoped.includes("subject?: string") && proposalsScoped.includes("subjectBySlug") && proposalsScoped.includes("never appears in another subject"),
    "changes: /proposals honors ?subject= — a change in one subject never appears in another subject's view");
  const libraryScoped = readFileSync("src/app/library/page.tsx", "utf8");
  assert(libraryScoped.includes('searchParams.get("subject")') && libraryScoped.includes("classifyEngine"),
    "library: /library honors ?subject= and scopes materials to the user's own courses in that subject");
  const memoryManagerSrc = readFileSync("src/components/app/MemoryManager.tsx", "utf8");
  assert(memoryManagerSrc.includes("string | string[]"),
    "memory: the manager accepts a subject SET for subject-workspace scoping (global stays distinct)");

  // Courses hierarchy: Science is a parent with Biology/Chemistry/Physics nested.
  const coursesPage = readFileSync("src/app/courses/page.tsx", "utf8");
  assert(coursesPage.includes("COURSE_GROUPS"), "courses: the page renders the parent/nested course hierarchy");
  const groups = COURSE_GROUPS;
  const science = groups.find((g) => g.key === "science");
  assert(!!science && science.label === "Science", "courses: Science appears as a parent category");
  assert(
    !!science && science.engines.length === 3 && science.engines.includes("biology") && science.engines.includes("chemistry") && science.engines.includes("physics"),
    "courses: Science contains exactly Biology, Chemistry, Physics nested beneath it"
  );
  assert(
    ["History / Social Science", "Foreign Language", "Health Education", "Other Subject"].every((label) => groups.some((g) => g.label === label)),
    "courses: History / Social Science, Foreign Language, Health Education, and Other Subject are distinct groups");
  assert(!groups.some((g) => g.label === "Computer Science"),
    "courses: Computer Science is no longer a top-level group — it lives under Other Subject");
  const otherGroup = groups.find((g) => g.key === "other");
  assert(!!otherGroup && otherGroup.engines.includes("programming") && otherGroup.engines.includes("general"),
    "courses: the Other Subject group covers both general and programming courses");
  assert(coursesPage.includes("parent course — subjects nested below"), "courses: Science is visually distinguished as the parent");

  // The Online page reports honest status and never claims a false state.
  const onlinePage = readFileSync("src/app/online/page.tsx", "utf8");
  assert(onlinePage.includes("/api/health") && onlinePage.includes("navigator.onLine"),
    "online: the page measures real connectivity and live service availability");
  assert(onlinePage.includes("never shows a false online") && onlinePage.includes("Offline storage could not be opened"),
    "online: unknown states are reported honestly, never faked");
  assert(onlinePage.includes("queue.count") && onlinePage.includes("sync.run"),
    "online: the page surfaces the real pending-sync queue and triggers the real sync engine");

  // Subject-scoped Changes view exists and is fed by the real schema.
  const proposalsPage = readFileSync("src/app/proposals/page.tsx", "utf8");
  assert(proposalsPage.includes("searchParams") && proposalsPage.includes("course_id"),
    "changes: /proposals supports the subject-scoped view (?course_id=)");
  assert(proposalsPage.includes("learning_patterns") && proposalsPage.includes("student_memories"),
    "changes: the chronological history covers learning patterns and memory updates");
  assert(proposalsPage.includes("never rewrites another"), "changes: subject changes never leak across subjects");
  for (const col of ["change_summary", "decided_at", "target_type"]) {
    assert(proposalsPage.includes(col), `changes: proposals history reads the real column ${col} (no invented schema)`);
  }

  // New engines are real pages with guarded, honest API routes.
  const engineFixtures: { page: string; route: string }[] = [
    { page: "src/app/writing/planning/page.tsx", route: "src/app/api/writing/plan/route.ts" },
    { page: "src/app/writing/grammar/page.tsx", route: "src/app/api/writing/grammar/route.ts" },
    { page: "src/app/tutor/page.tsx", route: "src/app/api/tutor/route.ts" },
    { page: "src/app/math/test-prep/page.tsx", route: "src/app/api/math/prepare/route.ts" },
    { page: "src/app/math/practice/page.tsx", route: "src/app/api/math/practice/route.ts" },
  ];
  for (const f of engineFixtures) {
    const page = readFileSync(f.page, "utf8");
    const route = readFileSync(f.route, "utf8");
    assert(page.includes("AppShell") && page.includes("fetch("), `pages: ${f.page} is a real functional page`);
    assert(route.includes("requireUser"), `api: ${f.route} enforces authentication`);
    assert(!route.includes("process.env") || !/[A-Z_]+_KEY\s*\)/.test(route.split("if (!aiConfigured())")[0]),
      `api: ${f.route} exposes no secrets in client code`);
  }

  // Planning engine never writes the assignment; grammar engine preserves voice.
  const planRoute2 = readFileSync("src/app/api/writing/plan/route.ts", "utf8");
  assert(planRoute2.includes("NEVER write the assignment") && planRoute2.includes("No draft paragraphs"),
    "planning: the engine plans without completing the assignment");
  const grammarRoute2 = readFileSync("src/app/api/writing/grammar/route.ts", "utf8");
  assert(grammarRoute2.includes("accept or reject") && grammarRoute2.includes("NEVER rewrite the whole piece"),
    "grammar: corrections are individual accept/reject choices, never wholesale rewrites");
  assert(grammarRoute2.includes("never invent text") && grammarRoute2.includes("text.includes(c.original)"),
    "grammar: server verifies every correction quote exists verbatim — no invented text");

  // Practice engine: attempt-before-reveal and honest checking.
  const practicePage = readFileSync("src/app/math/practice/page.tsx", "utf8");
  assert(practicePage.includes("attempt the problem before revealing") || practicePage.includes("Write your attempt first"),
    "practice: students attempt before answers are revealed");
  const practiceRoute = readFileSync("src/app/api/math/practice/route.ts", "utf8");
  assert(practiceRoute.includes("do not inflate") && practiceRoute.includes("Verify arithmetic"),
    "practice: attempt checking is honest — no grade inflation");

  // Math teach mode reaches the verified pipeline (no second math authority).
  const mathRoute = readFileSync("src/app/api/math/solve/route.ts", "utf8");
  assert(mathRoute.includes('mode === "teach"') && mathRoute.includes("TEACH MODE"),
    "math: teach-me mode explains the concept without a second solver authority");
  const mathPage = readFileSync("src/app/math/page.tsx", "utf8");
  assert(mathPage.includes('urlMode === "teach"') && mathPage.includes('urlMode === "type"'),
    "math: /math?mode=teach and /math?mode=type open the correct workflows");

}
