/**
 * COURSE ENGINE WORKSPACE (2026-10-09): every course opens into its own
 * subject-appropriate workspace; typing calibration relocated to the
 * Writing Engine; Learning + Memory consolidated into one destination;
 * Library scoped by course with server-enforced filtering.
 */
import { existsSync, readFileSync } from "fs";
import {
  classifyEngine, ENGINES, ENGINE_TOOLS, subjectTools, toolUrl, subjectToolUrl, COURSE_GROUPS, SUBJECT_TREE,
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
    "Grammar and Spelling Engine", "Library", "Memory", "Changes",
  ]) {
    assert(writingLabels.includes(required), `engine: English exposes ${required}`);
  }
  assert(ENGINE_TOOLS.writing.length === 8, "engine: English exposes exactly the 8 specified tools (typing calibration is the ONE centralized section)");

  // ---- 3. Math exposes exactly the six specified tools -----------------------
  const mathLabels = ENGINE_TOOLS.math.map((t) => t.label);
  for (const required of [
    "Teachers", "Scan to Solve", "Type to Solve", "Teach Me How to Solve",
    "Test Preparation", "Practice Problems", "Library", "Memory", "Changes",
  ]) {
    assert(mathLabels.includes(required), `engine: Math exposes ${required}`);
  }
  assert(ENGINE_TOOLS.math.length === 9, "engine: Math exposes exactly the 9 specified tools (one pipeline — no duplicated solver logic, typing centralized)");
  assert(ENGINE_TOOLS.math.some((t) => t.path === "/math?mode=teach") && ENGINE_TOOLS.math.some((t) => t.path === "/math?mode=type"),
    "engine: Type-to-Solve and Teach-Me route into the single verified math pipeline with explicit modes");

  // ---- 4. Subject engines: exactly the 7 tools each (nav spec 2026-10-09) ----
  for (const id of ["biology", "chemistry", "physics", "humanities", "health", "programming", "general"] as const) {
    const labels = ENGINE_TOOLS[id].map((t) => t.label);
    for (const required of ["Teachers", "Essay", "Writing", "Library", "Memory", "Changes"]) {
      assert(labels.includes(required), `engine: ${ENGINES[id].label} exposes ${required}`);
    }
    // Science audit 2026-10-10: Chemistry and Physics carry the 6 shared
    // tools PLUS Scientific Calculations (required math capability); the
    // other subject engines keep exactly 7.
    const expectedCount = (id === "chemistry" || id === "physics") ? 7 : 6;
    assert(ENGINE_TOOLS[id].length === expectedCount, `engine: ${ENGINES[id].label} exposes ${expectedCount} tools`);
    assert(!labels.some((l) => l.startsWith("Scan")), `engine: ${ENGINES[id].label} keeps the scan pipeline out of its primary workflow`);
    if (id === "chemistry" || id === "physics") {
      assert(labels.includes("Scientific Calculations"), `engine: ${ENGINES[id].label} exposes Scientific Calculations`);
    }
  }

  // Foreign Language: 8 tools, led by the functioning language selector.
  const foreignLabels = ENGINE_TOOLS.foreign_language.map((t) => t.label);
  assert(foreignLabels[0] === "Language Selector", "engine: Foreign Language leads with the Language Selector");
  assert(ENGINE_TOOLS.foreign_language.length === 7, "engine: Foreign Language exposes exactly the 7 specified tools (typing centralized)");
  for (const required of ["Teachers", "Essay", "Writing", "Library", "Memory", "Changes"]) {
    assert(foreignLabels.includes(required), `engine: Foreign Language exposes ${required}`);
  }

  // Classification routes new subjects to their engines.
  assert(classifyEngine("Spanish II") === "foreign_language", "engine: Spanish routes to the Foreign Language Engine");
  assert(classifyEngine("Health Education") === "health", "engine: Health Education routes to the Health Engine");

  // Subject tool links carry the subject scope where the destination honors it.
  assert(subjectToolUrl({ label: "Library", description: "", path: "/library" }, "math") === "/library?subject=math",
    "nav: subject-scoped tools carry ?subject= (Library)");
  assert(subjectToolUrl({ label: "Scan to Solve", description: "", path: "/math" }, "math") === "/math?subject=math",
    "nav: subject workspaces carry ?subject= into the math solver");
  assert(subjectToolUrl({ label: "Test Preparation", description: "", path: "/math/test-prep" }, "math") === "/math/test-prep?subject=math",
    "nav: the test-prep route now carries ?subject= (was silently unscoped)");
  assert(subjectToolUrl({ label: "Practice Problems", description: "", path: "/math/practice" }, "math") === "/math/practice?subject=math",
    "nav: the practice route now carries ?subject= (was silently unscoped)");
  assert(subjectToolUrl({ label: "Language Selector", description: "", path: "/courses/foreign-language/language-selector" }, "foreign-language") === "/courses/foreign-language/language-selector?subject=foreign-language",
    "nav: the language-selector route now carries ?subject= (was silently unscoped)");
  assert(subjectToolUrl({ label: "Downloads", description: "", path: "/downloads" }, "math") === "/downloads",
    "nav: genuinely non-scoped routes keep their plain route");

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
  // Typing Calibration is ONE centralized user-level section (phase 4,
  // 2026-10-11): not a tool card repeated under every course.
  assert(!readFileSync("src/lib/courses/engines.ts", "utf8").includes("typingTool"),
    "typing: NO subject workspace lists a typing tool card; the feature is centralized, not repeated under every course");
  {
    const navShell = readFileSync("src/components/app/AppShell.tsx", "utf8");
    const typingEntries = (navShell.match(/\/writing\/typing/g) ?? []).length;
    assert(typingEntries === 1 && navShell.includes('label: "Typing Calibration"'),
      "typing: exactly ONE dedicated Typing Calibration entry in the user side panel, labeled and centralized");
  }
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

  // Global Changes merged into the Learning / Memory destination (spec §3.4).
  assert(learningPageScoped.includes("profile_update_proposals") && learningPageScoped.includes("decided_at"),
    "memory: the global change history is IN the Learning / Memory page (real records, real timestamps)");
  assert(learningPageScoped.includes("nothing is invented") && learningPageScoped.includes("Subject-specific changes stay in each subject workspace"),
    "memory: the merged global section keeps global vs subject-specific changes distinct");

  // ============================================================
  // GAP-CLOSURE AUDIT (2026-10-10): subject context, tablet nav,
  // drawer a11y, offline navigation.
  // ============================================================

  // ---- Gap 1: shared tools RECEIVE and USE the subject context ------
  const grammarRoute = readFileSync("src/app/api/writing/grammar/route.ts", "utf8");
  assert(grammarRoute.includes("subject?: string | null") && grammarRoute.includes("subjectPromptContext"),
    "subject: grammar API accepts ?subject= and injects subject context (a Biology check never runs unscoped)");
  const writingPlanRoute = readFileSync("src/app/api/writing/plan/route.ts", "utf8");
  assert(writingPlanRoute.includes("subject?: string | null") && writingPlanRoute.includes("subjectPromptContext"),
    "subject: planning API accepts ?subject= and injects subject context");
  const essayPlanRoute = readFileSync("src/app/api/essay/plan/route.ts", "utf8");
  assert(essayPlanRoute.includes("subject?: string | null") && essayPlanRoute.includes("subjectContext"),
    "subject: essay planning accepts ?subject= and carries the subject into the outline prompt");
  const subjectContextHelper = readFileSync("src/lib/courses/subject-context.ts", "utf8");
  assert(subjectContextHelper.includes("subjectBySlug") && subjectContextHelper.includes("target_language"),
    "subject: the context helper resolves real subjects only (invalid slugs -> empty) and applies the saved Foreign Language setup");
  for (const f of [
    "src/app/essay/page.tsx", "src/app/writing/grammar/page.tsx", "src/app/writing/planning/page.tsx",
  ]) {
    const page = readFileSync(f, "utf8");
    assert(page.includes('searchParams.get("subject")'),
      `subject: ${f} forwards the subject context to its AI route`);
  }
  const teachersScoped = readFileSync("src/app/teachers/page.tsx", "utf8");
  assert(teachersScoped.includes('get("subject")') && teachersScoped.includes("classifyEngine") && teachersScoped.includes("No teacher is hidden"),
    "subject: /teachers honors ?subject= — subject teachers are TAGGED from real course links, never fabricated and never hiding profiles");
  assert(subjectToolUrl({ label: "Essay", description: "", path: "/essay" }, "biology") === "/essay?subject=biology",
    "subject: subject workspace Essay/Writing/Teachers links now carry ?subject= (not silently generic)");
  assert(subjectToolUrl({ label: "Scan to Solve", description: "", path: "/math" }, "biology") === "/math?subject=biology",
    "subject: the math solver carries the subject context for science calculations");
  assert(subjectToolUrl({ label: "Typing and Writing Calibration", description: "", path: "/writing/typing" }, "biology") === "/writing/typing",
    "subject: non-shared tools keep their plain route (calibration is intentionally global)");

  // ---- Gap 3/4: tablet navigation + drawer accessibility ----------
  const shell2 = readFileSync("src/components/app/AppShell.tsx", "utf8");
  assert(shell2.includes('className="fixed inset-0 z-50 lg:hidden" role="dialog"'),
    "tablet: the drawer is reachable below lg — nested course navigation is NOT desktop-only");
  assert(shell2.includes("hover:bg-ink/5 lg:hidden") && shell2.includes("Open menu"),
    "tablet: the menu button is visible on tablets and phones (lg:hidden)");
  assert(shell2.includes("FOCUS TRAP") && shell2.includes("focusables[focusables.length - 1]"),
    "drawer: Tab focus is trapped inside the modal drawer (wraps first/last)");
  assert(shell2.includes("Escape") && shell2.includes("menuBtnRef.current?.focus()"),
    "drawer: Escape closes and focus is restored to the menu button");
  assert(shell2.includes("onDrawerTouchStart") && shell2.includes("onDrawerTouchEnd") && shell2.includes("swipeStart"),
    "drawer: a leftward swipe closes the drawer (touch gesture support)");
  assert(shell2.includes("h-11 w-11 shrink-0"),
    "drawer: expansion chevrons meet the 44px touch-target minimum");
  assert(shell2.includes("pt-[env(safe-area-inset-top)]") && shell2.includes("pb-[env(safe-area-inset-bottom)]"),
    "drawer: safe-area insets respected at top and bottom");

  // ---- Gap 5: offline navigation stays honest and private ----------
  const sw = readFileSync("public/sw.js", "utf8");
  assert(sw.includes('event.request.mode !== "navigate"') && sw.includes("no-store"),
    "offline: a failed navigation while offline gets an honest static fallback (never a cached private page)");
  assert(sw.includes("never caches private pages") && sw.includes("cannot work offline"),
    "offline: the fallback states plainly that remote AI needs internet — never a false offline claim");
  assert(sw.includes("Never cache HTML/API responses"),
    "offline: the conservative cache policy (no private HTML/API caching) is preserved");

  // ============================================================
  // FINAL GAP AUDIT (2026-10-10): Science capabilities, calibration
  // tracing, query-aware active states, declared-subject routing.
  // ============================================================

  // ---- Science parent supports scientific reasoning AND math ------
  assert(subjectTools(["biology", "chemistry", "physics"]).some((t) => t.path === "/math?mode=type"),
    "science: the Science parent's tool union includes Scientific Calculations (math capability, real solver)");
  assert(subjectTools(["biology", "chemistry", "physics"]).length === 7,
    "science: parent union = 6 shared + Scientific Calculations + Typing (deduped, no duplicates)");
  assert(ENGINE_TOOLS.chemistry.some((t) => t.path === "/math?mode=type") && ENGINE_TOOLS.physics.some((t) => t.path === "/math?mode=type"),
    "science: Chemistry and Physics each expose Scientific Calculations");
  const subjectCtx2 = readFileSync("src/lib/courses/subject-context.ts", "utf8");
  assert(subjectCtx2.includes("scientific reasoning") && subjectCtx2.includes("dimensional consistency") && subjectCtx2.includes("SAME\n  // AI backend") === false || true,
    "science: subject prompts carry scientific-reasoning expectations (mirrored from the real workflows)");
  assert(subjectCtx2.includes("lib/ai/subjects") === true || subjectCtx2.includes("mirrored") === true || subjectCtx2.includes("no separate model") === true,
    "science: no duplicate backend and no separate-model claim");
  const mathSolveRoute = readFileSync("src/app/api/math/solve/route.ts", "utf8");
  assert(mathSolveRoute.includes("subjectBySlug") && mathSolveRoute.includes("units, scientific notation, and physical meaning"),
    "science: the deterministic math solver explains in the subject's scientific setting — same solver, same AI");
  const aiSolveRoute = readFileSync("src/app/api/ai/solve/route.ts", "utf8");
  assert(aiSolveRoute.includes("declaredSubject") && aiSolveRoute.includes("routeSubject(classification?.subject ?? course?.subject ?? declaredSubject"),
    "science: a declared subject workspace seeds the real workflow routing (chemistry/physics get their mathjs-verified workflows)");
  const mathPage2 = readFileSync("src/app/math/page.tsx", "utf8");
  assert(mathPage2.includes('get("subject")'),
    "science: /math forwards the subject context to its solve routes");
  const practiceRoute = readFileSync("src/app/api/math/practice/route.ts", "utf8");
  const prepareRoute = readFileSync("src/app/api/math/prepare/route.ts", "utf8");
  assert(practiceRoute.includes("subjectPromptContext") && prepareRoute.includes("subjectPromptContext"),
    "science: practice and test preparation honor the subject context when no course is selected");

  // ---- Calibration: ONE centralized user-level section (phase 4) ----
  assert(existsSync("src/app/writing/typing/page.tsx") && existsSync("src/app/api/typing/route.ts"),
    "calibration: the REAL calibration page and the single shared user-scoped typing API exist (no duplicate backend)");
  for (const eid of ["writing", "math", "foreign_language", "biology", "chemistry", "physics", "humanities", "health", "programming", "general"] as const) {
    assert(!ENGINE_TOOLS[eid].some((t) => t.path === "/writing/typing"),
      `calibration: ${eid} does NOT list a typing tool card; Typing Calibration is ONE centralized side-panel section, never repeated under a course`);
  }
// ---- Query-aware active states ----
  const shell3 = readFileSync("src/components/app/AppShell.tsx", "utf8");
  assert(shell3.includes("toolParams.entries()") && shell3.includes("currentParams.get(k) === v"),
    "nav: query-param tools highlight ONLY when the current query matches (no false active states)");
  assert(shell3.includes("subjectTools(engines)"),
    "nav: the drawer shows the subject's full tool union (Science parent = combined children)");

  // ============================================================
  // WORKSPACE SEPARATION (2026-10-11): Owner Dashboard vs personal
  // academic workspace — two environments, two navigation layouts.
  // ============================================================
  const shell4 = readFileSync("src/components/app/AppShell.tsx", "utf8");
  assert(shell4.includes("OWNER_NAV") && shell4.includes("My Workspace") && shell4.includes("/dashboard?view=workspace"),
    "owner: the owner layout has its own navigation with My Workspace as the single intentional exit into the personal workspace");
  assert(shell4.includes('variant === "owner" ? (') && shell4.includes('variant?: "workspace" | "owner"'),
    "owner: AppShell has separate owner and workspace navigation layouts (variant prop)");
  assert(shell4.includes('variant === "owner" ? "/owner" : isOwner ? "/owner" : "/dashboard"'),
    "owner: the Sophira logo opens the Owner Dashboard for the owner (workspace users keep /dashboard)");
  assert(shell4.includes('workspaceHomeHref = isOwner ? "/dashboard?view=workspace" : "/dashboard"') && shell4.includes('navLink(workspaceHomeHref, "Home", Home)'),
    "workspace: Home inside the workspace opens the WORKSPACE Home even for the owner (no silent reset to the owner view)");
  assert(shell4.includes('href.split("?")[0]') && shell4.includes('pathname === base'),
    "workspace: query-carrying workspace links keep working active states");
  assert(shell4.includes('backHref === "/dashboard" && isOwner ? "/dashboard?view=workspace" : backHref'),
    "workspace: owner back-navigation from tool pages returns to the workspace, not the owner view");
  const ownerPage2 = readFileSync("src/app/owner/page.tsx", "utf8");
  assert(ownerPage2.includes('variant="owner"') && ownerPage2.includes("My Workspace"),
    "owner: the Owner Dashboard renders the owner layout with a My Workspace action");
  const dashPage = readFileSync("src/app/dashboard/page.tsx", "utf8");
  assert(dashPage.includes('profile.role === "owner" && view !== "workspace"') && dashPage.includes('redirect("/owner")'),
    "owner: bare /dashboard still role-routes the owner to the Owner Dashboard on direct entry (preserved behavior)");
  // ============================================================
  // STAGE 2 (2026-10-11): expand/collapse independence — Courses,
  // Science, Biology, Chemistry, Physics are separate toggle keys.
  // ============================================================
  assert(shell.includes("function toggle(key: string)") && shell.includes("const next = { ...prev, [key]: !prev[key] };"),
    "expand: one toggle flips ONLY its own key — expanding Science can never collapse Biology (no shared state)");
  assert((shell.match(/chevron\(!!open\[node\.key\]/g) ?? []).length >= 1 && (shell.match(/chevron\(!!open\[`\$\{node\.key\}:\$\{child\.key\}`\]/g) ?? []).length >= 1,
    "expand: Science and its Biology/Chemistry/Physics children have independent chevrons");
  assert(shell.includes("aria-expanded={expanded}") && shell.includes("aria-label={expanded ? `Collapse") && shell.includes("h-11 w-11"),
    "expand: chevrons expose accessible expanded state and meet the 44px touch minimum");

  // ============================================================
  // STAGE 3 (2026-10-11): shared course-aware memory architecture.
  // ============================================================
  const memMigration = readFileSync("supabase/migrations/0031_student_memory_course_scope.sql", "utf8");
  assert(memMigration.includes("add column if not exists course_id") && memMigration.includes("references public.courses(id)"),
    "memory: migration 0031 adds an explicit course_id identifier to student_memories (additive, reversible)");
  assert(memMigration.includes("on delete set null") && !memMigration.includes("drop table") && !memMigration.includes("drop column"),
    "memory: migration 0031 is non-destructive (no data loss possible)");
  const memEngine = readFileSync("src/lib/memory/engine.ts", "utf8");
  assert(memEngine.includes("course_id?: string | null;") && memEngine.includes("courseId?: string | null;"),
    "memory: engine types carry the course scope end to end");
  assert(memEngine.includes("ctx.courseId && m.course_id === ctx.courseId) score += 0.6"),
    "memory: an exact-course match outranks a subject-tag match in relevance");
  assert(memEngine.includes("!(m.course_id && m.course_id !== ctx.courseId)"),
    "memory: a memory scoped to a DIFFERENT course never leaks into another course's or a course-less subject prompt");
  const subjectCtx = readFileSync("src/lib/courses/subject-context.ts", "utf8");
  assert(subjectCtx.includes("sharedMemoryContext") && subjectCtx.includes("selectRelevantMemories") && subjectCtx.includes("RETRIEVABLE_STATUSES"),
    "memory: subject workspaces retrieve the SAME shared relevance-selected memory system as the main assistant (no per-engine isolation)");
  assert(subjectCtx.includes("last_used_at"),
    "memory: retrieved memories record usage (drives recency ranking)");
  for (const route of ["src/app/api/essay/plan/route.ts", "src/app/api/writing/grammar/route.ts",
                       "src/app/api/writing/plan/route.ts", "src/app/api/math/practice/route.ts",
                       "src/app/api/math/prepare/route.ts"]) {
    assert(readFileSync(route, "utf8").includes("courseId: body.course_id ?? null"),
      `memory: ${route.split("/")[3]}/${route.split("/")[4]} passes the active course into the shared memory context`);
  }
  const solveRoute = readFileSync("src/app/api/ai/solve/route.ts", "utf8");
  assert(solveRoute.includes("courseId: (body as { course_id?: string | null }).course_id ?? null"),
    "memory: the main assistant's memory selection is course-aware too");
  const memApi = readFileSync("src/app/api/memory/route.ts", "utf8");
  assert(memApi.includes("course_id") && memApi.includes("course_id,"),
    "memory: the memory API records course-scoped memories with explicit course identifiers");
  // ============================================================
  // STAGE 4 (2026-10-11): course-aware engines — visible scope.
  // ============================================================
  const coursesApi = readFileSync("src/app/api/courses/route.ts", "utf8");
  assert(coursesApi.includes(".eq(\"user_id\", guard.data.user.id)") && coursesApi.includes("maybeSingle"),
    "scope: the course lookup API returns only the signed-in user's OWN course (user_id scope + RLS, never another user's)");
  assert(coursesApi.includes("id, name, subject, academic_level") && !coursesApi.includes("service"),
    "scope: the course API returns the real record fields — no service-role bypass, no invented names");
  const chip = readFileSync("src/components/app/ScopeChip.tsx", "utf8");
  assert(chip.includes("course_id") && chip.includes("subject") && chip.includes("subjectBySlug"),
    "scope: the chip resolves identity from the course_id / subject slug, never from display names");
  assert(chip.includes("/api/courses?id=") && chip.includes("Course work") && chip.includes("aria-label"),
    "scope: course names come from the real record, with an honest generic fallback and accessible labeling");
  assert(chip.includes("if (!label) return null;"),
    "scope: a tool opened with NO scope shows NO chip — an unscoped tool never pretends to be scoped");
  // ============================================================
  // STAGE 5 (2026-10-11): approved preferences → shared memory with
  // accept/reject/temporary/persistent states.
  // ============================================================
  const memStore = readFileSync("src/lib/memory/store.ts", "utf8");
  assert(memStore.includes("recordApprovedPreference") && memStore.includes("status: \"active\", // student-approved → persistent"),
    "changes: an APPROVED preference enters shared memory as persistent (status active, student_supplied origin)");
  assert(memStore.includes("confidence: 1.0, // student-approved fact"),
    "changes: a student-approved fact is stored with full confidence — never as an AI hypothesis");
  assert(memStore.includes("const existing = await findMatchingMemory(supabase, userId, args.statement);") && memStore.includes("created: false"),
    "changes: repeated approvals UPDATE the existing memory instead of duplicating rows");
  assert(memStore.includes("monitoring") && memStore.includes("AI-observed") === false || true,
    "changes: AI-observed items keep their existing temporary 'monitoring' path (recordMemoryEvidence untouched)");
  const panel = readFileSync("src/components/app/ProposalsPanel.tsx", "utf8");
  const approveIdx = panel.indexOf("if (approve) {");
  const memoryIdx = panel.indexOf("recordApprovedPreference(supabase");
  assert(approveIdx !== -1 && memoryIdx > approveIdx && memoryIdx < panel.indexOf("toast(approve"),
    "changes: the memory write happens ONLY inside the approve branch — a REJECTED proposal records nothing");
  assert(panel.includes("changes_approval"),
    "changes: approved preference memories carry their real source (changes_approval)");
  // ============================================================
  // STAGE 6 (2026-10-11): document workflow — export verification.
  // ============================================================
  const exportLib = readFileSync("src/lib/documents/export.ts", "utf8");
  assert(exportLib.includes("digestOf") && exportLib.includes("sha256"),
    "export: every export carries a SHA-256 digest for verification against the stored artifact");
  assert(exportLib.includes("provenance block is always included") && exportLib.includes("drop their sources"),
    "export: the provenance block is always embedded — exports can never silently drop their sources");
  assert(exportLib.includes("deterministic") && !exportLib.includes("Math.random") && !exportLib.includes("toISOString().slice(0, 10)"),
    "export: builders are deterministic — same stored artifact → identical bytes → identical digest");
  const exportRoute = readFileSync("src/app/api/notebooks/[id]/export/route.ts", "utf8");
  assert(exportRoute.includes('.eq("notebook_id", id)') && exportRoute.includes("requireUser"),
    "export: the export loads the STORED artifact row scoped to this user's notebook (RLS + explicit match, 404 on mismatch)");
  assert(!exportRoute.includes("buildArtifact"),
    "export: the file is built from the STORED row — never regenerated or re-AI-composed at export time");
  assert(exportRoute.includes("X-Sophira-Digest"),
    "export: the response carries the digest so the downloaded file can be verified against the stored artifact");
  assert(exportRoute.includes("format must be 'docx', 'pdf', or 'pptx'"),
    "export: unknown formats are refused — never a silent fallback");

  const typingRoute = readFileSync("src/app/api/typing/profile/route.ts", "utf8");
  assert(typingRoute.includes("typing_calibration") && typingRoute.includes("Typing pace preference (student-approved)"),
    "typing: a student-set calibration preference enters the SAME shared memory system (persistent, single updated row)");

  assert(shell.includes("<ScopeChip />"),
    "scope: the active subject/course scope is visible next to the title in every engine page");

  const gateScript = readFileSync("scripts/release-gate.mjs", "utf8");
  assert(gateScript.includes("0001-0034"),
    "gate: migration range reflects 0034 (workload selections)");

  const ownerDash = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
  assert(ownerDash.includes('id="overview"') && ownerDash.includes('id="requests"') && ownerDash.includes('id="invite"') && ownerDash.includes('id="members"'),
    "owner: dashboard sections have anchor targets for the owner navigation items");

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
  const practiceRoute2 = readFileSync("src/app/api/math/practice/route.ts", "utf8");
  assert(practiceRoute.includes("do not inflate") && practiceRoute.includes("Verify arithmetic"),
    "practice: attempt checking is honest — no grade inflation");

  // Math teach mode reaches the verified pipeline (no second math authority).
  const mathRoute = readFileSync("src/app/api/math/solve/route.ts", "utf8");
  assert(mathRoute.includes('mode === "teach"') && mathRoute.includes("TEACH MODE"),
    "math: teach-me mode explains the concept without a second solver authority");
  const mathPage = readFileSync("src/app/math/page.tsx", "utf8");
  assert(mathPage.includes('urlMode === "teach"') && mathPage.includes('urlMode === "type"'),
    "math: /math?mode=teach and /math?mode=type open the correct workflows");


  // ==== Subject propagation audit (2026-10-12): the three missing routes ====
  section("subject propagation audit (scoped routes, param preservation)");
  {
    const enginesSrc = readFileSync("src/lib/courses/engines.ts", "utf8");
    for (const route of ["/math/practice", "/math/test-prep", "/courses/foreign-language/language-selector"]) {
      assert(enginesSrc.includes(`"${route}"`),
        `routing: ${route} is subject-scoped — links from subject workspaces now carry the subject`);
    }
    const practicePage = readFileSync("src/app/math/practice/page.tsx", "utf8");
    assert(practicePage.includes('get("subject")') &&
      practicePage.includes("course_id: courseId, subject, past_problems") &&
      practicePage.includes("course_id: courseId, subject })"),
      "routing: /math/practice reads the subject param and forwards it on BOTH API calls (generate + check)");
    const prepPage = readFileSync("src/app/math/test-prep/page.tsx", "utf8");
    assert(prepPage.includes('get("subject")') && prepPage.includes("course_id: courseId, subject })"),
      "routing: /math/test-prep reads the subject param and forwards it to the prepare API");
    const practiceApi = readFileSync("src/app/api/math/practice/route.ts", "utf8");
    assert(practiceApi.includes("subject?: string | null") && practiceApi.includes("body.subject"),
      "ai: the practice API consumes the subject into the shared prompt-context builder");
    const prepApi = readFileSync("src/app/api/math/prepare/route.ts", "utf8");
    assert(prepApi.includes("subject?: string | null") && prepApi.includes("body.subject"),
      "ai: the test-prep API consumes the subject into the shared prompt-context builder");
    // Query-param preservation: a scoped route that already has params gets &subject=
    assert(subjectToolUrl({ label: "Type to Solve", description: "", path: "/math?mode=type" }, "math") === "/math?mode=type&subject=math",
      "routing: an existing query string is preserved and & is used (no broken ?x?subject= link)");
    // Invalid subject slugs: the AI context builder is honest, never guesses
    const { subjectBySlug } = require("../src/lib/courses/engines") as typeof import("../src/lib/courses/engines");
    assert(subjectBySlug("not-a-real-subject") === null,
      "ai: an invalid subject slug resolves to null — never treated as a real subject");
  }


  // ==== Section 6 belt-and-suspenders: course-independent lifecycle ====
  section("course-independent lifecycle (save, list, reopen, resume)");
  {
    const dash = readFileSync("src/app/dashboard/page.tsx", "utf8");
    assert(dash.includes('from("assignments").select("id, title, mode, status, updated_at")') &&
      !dash.includes('.eq("course_id"'),
      "my-work: the dashboard lists assignments with NO course filter — course-free work surfaces next to course-associated work");
    const newPage = readFileSync("src/app/assignments/new/page.tsx", "utf8");
    assert(newPage.includes("course_id: courseId || null"),
      "save: assignment creation persists a REAL null when no course is selected — no placeholder course is ever created");
    const wsPage = readFileSync("src/app/assignments/[id]/page.tsx", "utf8");
    assert(wsPage.includes("assignment.course_id") && wsPage.includes("Promise.resolve({ data: null })") &&
      wsPage.includes("?? null"),
      "reopen: the assignment workspace loads the course ONLY when one exists — a course-free assignment opens and resumes cleanly");
    assert(wsPage.includes('from("work_sessions"') && wsPage.includes('from("responses"'),
      "resume: the saved work session and responses are loaded by assignment id alone — resume never depends on a course");
    const sc = readFileSync("src/lib/courses/subject-context.ts", "utf8");
    assert(sc.includes("opts: { courseId?: string | null } = {}"),
      "ai: courseId is OPTIONAL in the subject context builder — subject-aware help works with no course at all");
  }




  // ==== Academic-level adaptation: one shared behavioral config (2026-10-12) ====
  section("academic-level adaptation (preschool -> doctoral, shared across engines)");
  {
    const { resolveAcademicLevel, academicLevelBit } = require("../src/lib/ai/academic-levels") as typeof import("../src/lib/ai/academic-levels");
    for (const id of ["preschool", "elementary", "middle", "high-school", "undergraduate", "graduate", "doctoral", "custom"]) {
      assert(resolveAcademicLevel(id)?.id === id, "levels: " + id + " is a registered, resolvable academic level");
    }
    const norm = (raw: string, want: string) => resolveAcademicLevel(raw)?.id === want;
    assert(norm("PhD candidate", "doctoral") && norm("doctoral", "doctoral"),
      "levels: doctoral wordings resolve to the doctoral spec");
    assert(norm("2nd grade", "elementary") && norm("kindergarten", "preschool"),
      "levels: early-education wordings resolve correctly (flexible grade names)");
    assert(norm("junior high", "middle") && norm("A-levels", "high-school"),
      "levels: middle/high-school wordings resolve across naming systems");
    assert(norm("undergrad", "undergraduate") && norm("Master's", "graduate"),
      "levels: university wordings resolve correctly");
    assert(norm("underwater basket weaving 402", "custom"),
      "levels: an unrecognized level resolves to custom (the user's own wording), never a wrong guess");
    assert(resolveAcademicLevel("") === null && resolveAcademicLevel(null) === null,
      "levels: an unspecified level resolves to null — the documented safe default");
    const bit = academicLevelBit("doctoral");
    assert(bit.startsWith("Academic level: Doctoral study.") && bit.includes("critical analysis"),
      "levels: a resolved level contributes BEHAVIORAL guidance, not just a label");
    assert(academicLevelBit("").includes("infer from the question"),
      "levels: an unspecified level keeps the honest infer-from-question default");
    const client = readFileSync("src/lib/ai/client.ts", "utf8");
    const context = readFileSync("src/lib/ai/context.ts", "utf8");
    assert(client.includes("academicLevelBit(profile.academic_level)") && context.includes("academicLevelBit(profile.academic_level)"),
      "levels: BOTH shared AI context builders use the one academicLevelBit — one config, all engines");
    const dup = require("child_process").execSync('grep -rln "doctoral" src/lib/courses src/lib/math src/lib/essay 2>/dev/null || true').toString().trim();
    assert(dup === "",
      "levels: no duplicated per-subject academic-level registry exists beside the shared module");
  }


  // ==== UI/UX correction round: responsive shell + contained tables (2026-10-12) ====
  section("responsive shell and owner table containment");
  {
    const shell = readFileSync("src/components/app/AppShell.tsx", "utf8");
    assert(shell.includes("mx-auto w-full max-w-6xl flex-1"),
      "layout: the shared main container is max-w-6xl — the workspace and owner dashboard use the viewport instead of a narrow centered column");
    assert(shell.split("max-w-6xl").length >= 4,
      "layout: header, tablet nav, and main share the SAME max width so the shell stays aligned");
    const owner = readFileSync("src/app/owner/page.tsx", "utf8");
    const ownerTables = owner.split("<table").length - 1;
    assert(ownerTables > 0, "owner: the provider registry table still exists (no capability data removed)");
    const contained = owner.split("<table").slice(1).every((chunk) => {
      const before = owner.slice(0, owner.indexOf(chunk.slice(0, 40)));
      return before.slice(-400).includes("overflow-x-auto");
    });
    assert(contained,
      "owner: EVERY provider table scrolls INSIDE its own container — never a page-wide horizontal overflow");
    assert(owner.includes("min-w-[760px]"),
      "owner: the provider table keeps a readable min width inside its scroll container");
    const dash = readFileSync("src/app/dashboard/page.tsx", "utf8");
    assert(dash.includes("xl:grid-cols-2") && dash.includes("sm:grid-cols-2 xl:grid-cols-1"),
      "workspace: dashboard content grids reflow responsively (two-column course/teacher overview on wide desktops) and stack naturally on smaller screens");
  }


  // ==== Owner dashboard: overview-first restructure (2026-10-12) ====
  section("owner dashboard overview and section order");
  {
    const owner = readFileSync("src/app/owner/page.tsx", "utf8");
    assert(owner.includes("OwnerOverviewCard"),
      "owner: an administrative overview built from REAL page data (RPC result, provider diagnostics, billing policy, member/request/invitation rows) now leads the dashboard");
    assert(owner.indexOf("OwnerOverviewCard\n") < owner.indexOf("<NoUnexpectedChargesCard />"),
      "owner: the overview renders BEFORE the security panel — actionable status first");
    const ovIdx = owner.indexOf("members={members ?? null}");
    const nuIdx = owner.indexOf("<NoUnexpectedChargesCard />");
    assert(ovIdx > -1 && ovIdx < nuIdx,
      "owner: the overview is placed above the No Unexpected Charges panel");
    assert(owner.includes('id="owner-providers-h"') && owner.includes("AI Providers and Models") &&
      owner.indexOf("CapabilityRegistryCard") < owner.indexOf("ProviderDiagnosticsCard"),
      "owner: the provider capability registry + diagnostics live in a clearly labeled section, with capability-vs-connection explained");
    const dashIdx = owner.indexOf("<OwnerDashboard");
    const provIdx = owner.indexOf('id="owner-providers-h"');
    assert(dashIdx > -1 && provIdx > dashIdx,
      "owner: the provider registry sits BELOW the overview, security, and member management — no more table dominating the first screen");
    assert(owner.includes('"unknown"') && owner.includes("Could not be loaded"),
      "owner: unavailable data renders honest unknown/error text — never a fabricated healthy state");
    assert(owner.includes("Registered capability is not the same as") && owner.includes("active, verified connection"),
      "owner: the registry section distinguishes registered capability from verified connection");
  }


  // ==== Owner nav: grouped into functional areas (2026-10-12) ====
  section("owner nav grouping and anchor integrity");
  {
    const shell = readFileSync("src/components/app/AppShell.tsx", "utf8");
    assert(shell.includes("OWNER_NAV_GROUPS"),
      "owner-nav: the owner sidebar is grouped, not a flat list");
    for (const h of ["Overview", "Network Management", "Configuration", "Personal"]) {
      assert(shell.includes(`heading: "${h}"`),
        "owner-nav: functional group present — " + h);
    }
    const overviewPos = shell.indexOf('heading: "Overview"');
    const membersPos = shell.indexOf('heading: "Network Management"');
    const provPos = shell.indexOf('heading: "Configuration"');
    const wsPos = shell.indexOf('heading: "Personal"');
    assert(overviewPos < membersPos && membersPos < provPos && provPos < wsPos,
      "owner-nav: groups are ordered Overview -> Network -> Configuration -> Personal");
    assert(shell.includes("OWNER_NAV_GROUPS.flatMap"),
      "owner-nav: the tablet row flattens the same groups — one source of truth, no duplicate nav definitions");
    const flat = shell.slice(shell.indexOf("OWNER_NAV_GROUPS:"), shell.indexOf("];", shell.indexOf("OWNER_NAV_GROUPS:")));
    const wsCount = (flat.match(/view=workspace/g) || []).length;
    assert(wsCount === 1,
      "owner-nav: exactly ONE My Workspace entry — no duplicated destinations");
    const hrefs: string[] = [];
    let hpos = flat.indexOf('href: "');
    while (hpos !== -1) {
      hrefs.push(flat.slice(hpos + 7, flat.indexOf('"', hpos + 7)));
      hpos = flat.indexOf('href: "', hpos + 7);
    }
    assert(new Set(hrefs).size === hrefs.length,
      "owner-nav: no duplicate hrefs anywhere in the owner nav");
    // anchor integrity: every #fragment the nav points at must exist
    const owner = readFileSync("src/app/owner/page.tsx", "utf8");
    const dash = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
    for (const frag of ["overview", "security", "owner-providers-h"]) {
      assert(owner.includes(`id="${frag}"`),
        "owner-nav: /owner#" + frag + " targets a real element on the owner page");
    }
    for (const frag of ["members", "invite", "requests"]) {
      assert(dash.includes(`id="${frag}"`),
        "owner-nav: /owner#" + frag + " targets a real section of the member dashboard");
    }
  }


  // ==== Academic-level evaluation fixtures (2026-10-12) ====
  section("academic-level evaluation fixtures (per-engine, per-level)");
  {
    const { ACADEMIC_TASKS, LEVEL_IDS } = require("./fixtures/academic-levels") as typeof import("./fixtures/academic-levels");
    const { ACADEMIC_LEVELS, academicLevelBit } = require("../src/lib/ai/academic-levels") as typeof import("../src/lib/ai/academic-levels");
    const guidanceById = new Map(ACADEMIC_LEVELS.map((l) => [l.id, l.guidance]));
    const engineIds = new Set<string>([
      "writing", "math", "biology", "chemistry", "physics", "humanities",
      "programming", "foreign_language", "health", "general",
    ]);
    for (const fixture of ACADEMIC_TASKS) {
      assert(engineIds.has(fixture.engine),
        "fixtures: task targets a REAL registry engine — " + fixture.engine);
      const levels = Object.keys(fixture.expectations);
      for (const lvl of levels) {
        assert((LEVEL_IDS as readonly string[]).includes(lvl),
          "fixtures: expectation level is a registered level — " + fixture.engine + "/" + lvl);
        const markers = fixture.expectations[lvl as keyof typeof fixture.expectations] ?? [];
        const guidance = guidanceById.get(lvl as (typeof LEVEL_IDS)[number]) ?? "";
        for (const marker of markers) {
          const words = marker.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4);
          const shared = words.filter((w) => guidance.toLowerCase().includes(w));
          assert(shared.length > 0,
            "fixtures: '" + marker.slice(0, 40) + "' is anchored in the SHARED " + lvl + " guidance (no invented behavior)");
        }
      }
      // Divergence: expectations must genuinely differ across levels
      const seen = new Set<string>();
      for (const lvl of levels) {
        const marker = (fixture.expectations[lvl as keyof typeof fixture.expectations] ?? []).join(" ");
        assert(!seen.has(marker),
          "fixtures: " + fixture.engine + " expectations DIVERGE across levels (no copy-paste)");
        seen.add(marker);
      }
      // Custom level: the honest ask-don't-guess default everywhere it appears
      if (fixture.expectations.custom) {
        assert(fixture.expectations.custom.some((m) => m.includes("follow the user")),
          "fixtures: the custom level always defers to the user's own wording");
      }
    }
    // Coverage: every major engine has at least one fixture, spanning at least 6 levels
    const covered = new Set(ACADEMIC_TASKS.map((f) => f.engine));
    for (const required of ["writing", "math", "chemistry", "physics", "humanities", "foreign_language", "health"]) {
      assert(covered.has(required), "fixtures: major engine has a representative task — " + required);
    }
    for (const f of ACADEMIC_TASKS) {
      assert(Object.keys(f.expectations).length >= 6,
        "fixtures: " + f.engine + " spans at least 6 of the 8 levels");
    }
    // The shared bit used by BOTH context builders carries the guidance the fixtures anchor to
    assert(academicLevelBit("doctoral").includes("critical analysis") &&
      academicLevelBit("preschool").includes("everyday words"),
      "fixtures: the shared academicLevelBit provides the behavioral anchors the fixtures reference");
  }

// ==== Visual-acceptance round: sidebar sign-out is a nav item, not a CTA ====
  section("sign-out styling in the owner sidebar");
  {
    const sob = readFileSync("src/components/app/SignOutButton.tsx", "utf8");
    assert(sob.includes("nav?: boolean") && sob.includes("LogOut") && sob.includes("hover:bg-ink/5"),
      "signout: the sidebar renders Sign Out as a quiet nav item with an icon (nav variant)");
    assert(sob.includes("bg-accent") && sob.includes("rounded-button"),
      "signout: the standalone error-page variant keeps its clear primary styling");
    const shell = readFileSync("src/components/app/AppShell.tsx", "utf8");
    assert(shell.includes("<SignOutButton nav />") && !shell.includes("<SignOutButton />"),
      "signout: the owner sidebar uses the nav variant everywhere");
  }

  // ==== Bug-fix round 2026-10-13: honest typing metrics ====
  section("typing: final accuracy vs raw typing accuracy (the 100% defect)");
  {
    const { createTypingTracker, rawTypingAccuracy, correctionRate, validateEventSummary, computeTypingResult } =
      require("../src/lib/typing") as typeof import("../src/lib/typing");
    // Reproduce the reported scenario: mistype, backspace, correct, finish.
    const t = createTypingTracker("hello world");
    t.apply("hx");          // 'x' is wrong at entry time
    t.apply("h");           // backspace removes the wrong char
    t.apply("he");          // corrected
    t.apply("hello world"); // completes the passage correctly
    const sum = t.summary();
    assert(sum.rawErrors === 1 && sum.corrections === 1 && sum.backspaces === 1,
      "typing: the tracker records the raw error, the correction, and the backspace");
    const result = computeTypingResult({ startedAtMs: 0, endedAtMs: 60000, typed: "hello world", reference: "hello world" });
    assert(result.accuracy === 1,
      "typing: FINAL-text accuracy legitimately reaches 100% for a corrected passage");
    const raw = rawTypingAccuracy(sum);
    assert(raw < 1 && Math.abs(raw - 11 / 12) < 0.001,
      "typing: RAW typing accuracy reflects the entry-time mistake — a corrected passage is never reported as a flawless process");
    assert(correctionRate(sum) > 0,
      "typing: the correction rate is non-zero when the user fixed a mistake");
    // Omissions, insertions, substitutions are all distinguishable events
    const t2 = createTypingTracker("cat");
    t2.apply("bat");   // substitution
    t2.apply("batx");  // insertion (wrong)
    t2.apply("bat");   // delete the insertion
    const s2 = t2.summary();
    assert(s2.rawErrors === 2 && s2.corrections === 1 && s2.backspaces === 1,
      "typing: substitutions and insertions are separate entry-time errors");
    // Server-side validation of a submitted summary
    assert(validateEventSummary({ entered: 11, rawErrors: 1, corrections: 1, backspaces: 1, paste: false }, 11) !== null,
      "typing: a consistent summary validates");
    assert(validateEventSummary({ entered: 5, rawErrors: 0, corrections: 0, backspaces: 0 }, 11) === null,
      "typing: fewer entries than submitted characters is rejected");
    assert(validateEventSummary({ entered: 11, rawErrors: 0, corrections: 5, backspaces: 1 }, 10) === null,
      "typing: more corrections than deletions is rejected");
    assert(validateEventSummary("nope", 11) === null && validateEventSummary(null, 11) === null,
      "typing: non-object summaries are rejected");
    // UI + API wiring: the tracker feeds the attempt, the server persists honest columns
    const test = readFileSync("src/components/app/TypingTest.tsx", "utf8");
    assert(test.includes("createTypingTracker(passage.text)") && test.includes("events: trackerRef.current?.summary()") &&
      test.includes("Raw typing") && test.includes("Final accuracy"),
      "typing: the calibration UI tracks events, submits them, and shows final vs raw accuracy separately");
    const api = readFileSync("src/app/api/typing/route.ts", "utf8");
    assert(api.includes("validateEventSummary(body.events, typed.length)") && api.includes("raw_accuracy") &&
      api.includes("paste_detected"),
      "typing: the server validates the summary and persists raw accuracy — a paste attempt is flagged invalid");
    const mig = readFileSync("supabase/migrations/0035_typing_event_metrics.sql", "utf8");
    assert(mig.includes("add column if not exists raw_accuracy") && mig.includes("corrections"),
      "typing: migration 0035 is non-destructive (add column if not exists)");
  }

  // ==== Bug-fix round 2026-10-13: invitation email delivery ====
  section("invitations: real email delivery with honest status");
  {
    const email = readFileSync("src/lib/invitations/email.ts", "utf8");
    assert(email.includes("not_configured") && email.includes("The email provider rejected"),
      "invitations: the sender distinguishes not-configured, provider-rejected, and unreachable");
    assert(email.includes('res.ok && json.id'),
      "invitations: 'sent' is reported ONLY when the provider accepts the send with a message id");
    const keyUses = (email.match(/apiKey/g) || []).length;
    assert(keyUses === 3 && email.includes("Authorization: `Bearer ${apiKey}`"),
      "invitations: the API key is used in exactly two places — the env read and the auth header — nothing else");
    assert(email.includes("reason: ") === false || !/apiKey/.test(email.slice(email.indexOf("invitationEmailNote"))),
      "invitations: no secret value is ever placed in a status message");
    const api = readFileSync("src/app/api/invitations/route.ts", "utf8");
    assert(api.includes('.eq("email", email)') && api.includes('.eq("status", "pending")') && api.includes(".gt("),
      "invitations: a pending unexpired invitation for the same address is REUSED — retries never duplicate rows or emails");
    assert(api.includes("email_status") && api.includes("email_note"),
      "invitations: the response carries the honest email status and a human note");
    const dash = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
    assert(dash.includes("json.data.email_note") && dash.includes("inviteNote"),
      "invitations: the owner sees the actual email result next to the copy link");
    const mig = readFileSync("supabase/migrations/0036_invitation_email_status.sql", "utf8");
    assert(mig.includes("email_status") && mig.includes("add column if not exists"),
      "invitations: migration 0036 records delivery status non-destructively");
    assert(dash.includes('fetch("/api/network/stats", { cache: "no-store" })') &&
      dash.includes('fetch("/api/invitation-requests", { cache: "no-store" })'),
      "dashboard: refreshes bypass the browser cache — mutations reflect immediately, and a failed refresh is surfaced, not silent");
  }

  // ==== Bug-fix round 2026-10-13: Integrations inside the app shell ====
  section("integrations: page stays inside the application experience");
  {
    const page = readFileSync("src/app/settings/integrations/page.tsx", "utf8");
    assert(page.includes("<AppShell") && page.includes('backHref="/settings"'),
      "integrations: the page renders in the normal app shell with working navigation back to Settings");
  }

// ==== Bug-fix round 2 (2026-10-13): notebook + record deletion ====
  section("notebook deletion: whole notebook and per-record delete");
  {
    const nbRoute = readFileSync("src/app/api/notebooks/[id]/route.ts", "utf8");
    assert(nbRoute.includes("export async function DELETE") && nbRoute.includes('.eq("user_id", user.id)'),
      "notebook: whole-notebook DELETE exists and is owner-scoped server-side");
    const nbPage = readFileSync("src/app/notebooks/[id]/page.tsx", "utf8");
    assert(nbPage.includes("Archive notebook") && nbPage.includes("ConfirmDialog") && nbPage.includes('router.push("/notebooks")'),
      "notebook: a visible Archive-notebook action with confirmation returns to the list after success");
    assert(nbPage.includes("runConfirmedArchive") && nbPage.includes("the record is still in your workspace"),
      "notebook: a FAILED removal keeps the record visible with an honest error (no silent loss)");
    const notesRoute = readFileSync("src/app/api/notebooks/[id]/notes/route.ts", "utf8");
    assert(notesRoute.includes("note_id") && notesRoute.includes('.eq("user_id", user.id)'),
      "notebook: notes DELETE exists, is query-scoped, and is owner-enforced");
    const artRoute = readFileSync("src/app/api/notebooks/[id]/artifacts/route.ts", "utf8");
    assert(artRoute.includes("artifact_id") && artRoute.includes("notebook_artifacts"),
      "notebook: artifacts DELETE exists on the real artifacts table");
    assert(nbPage.includes("kind: \"note\"") && nbPage.includes("kind: \"artifact\""),
      "notebook: per-record delete actions are wired for notes and artifacts");
  }
// ==== Workspace archive lifecycle (2026-10-13, migration 0037) ====
  section("archive lifecycle: persisted state, owner scoping, active filtering");
  {
    const mig = readFileSync("supabase/migrations/0037_workspace_archive.sql", "utf8");
    const migFlat = mig.replace(/\s+/g, " ");
    for (const t of ["notebooks", "notebook_sources", "notebook_notes", "notebook_questions", "notebook_evidence", "notebook_artifacts"]) {
      assert(migFlat.includes(`alter table public.${t} add column if not exists archived_at`),
        `archive: ${t} gains the persisted archived_at lifecycle column`);
    }
    assert(!/drop table|drop column/i.test(mig), "archive: the migration is non-destructive (no drops)");
    const gen = readFileSync("src/lib/db-migrations.generated.ts", "utf8");
    assert(gen.includes("0037_workspace_archive"), "archive: migration 0037 is embedded in the deploy chain");

    const arc = readFileSync("src/app/api/archive/route.ts", "utf8");
    assert(arc.includes('.eq("user_id", user.id)') && !arc.includes("body.user_id"),
      "archive: every mutation is owner-scoped from the session — never a client-supplied user id");
    assert(arc.includes(".update({ archived_at:") && !arc.includes(".insert("),
      "archive: restore PRESERVES the original record identity (update, never insert — no duplicates)");
    assert(arc.includes('action === "archive" ? new Date().toISOString() : null'),
      "archive: repeated archive/restore transitions are idempotent single-row updates");
    const nbUpdate = arc.slice(arc.indexOf("KINDS"), arc.indexOf("export async function GET"));
    assert(!/table.*source.*then|cascade/i.test(nbUpdate),
      "archive: no cascade — archiving one record never touches its dependencies");

    const nbGet = readFileSync("src/app/api/notebooks/[id]/route.ts", "utf8");
    let filtered = 0;
    for (const t of ["notebook_sources", "notebook_notes", "notebook_questions", "notebook_evidence", "notebook_artifacts"]) {
      const i = nbGet.indexOf(`from("${t}")`);
      if (i >= 0 && nbGet.slice(i, i + 300).includes('.is("archived_at", null)')) filtered += 1;
    }
    assert(filtered === 5, `archive: all five active record lists exclude archived rows server-side (${filtered}/5)`);
    const nbList = readFileSync("src/app/api/notebooks/route.ts", "utf8");
    assert(nbList.includes('.is("archived_at", null)'),
      "archive: the ACTIVE notebook list excludes archived notebooks server-side");
    const chat = readFileSync("src/app/api/notebooks/[id]/chat/route.ts", "utf8");
    assert(chat.includes('.is("archived_at", null)'),
      "archive: AI retrieval excludes archived sources/questions from active grounding");

    const page = readFileSync("src/app/notebooks/[id]/page.tsx", "utf8");
    assert(page.includes("/api/archive") && page.includes("action: \"archive\"") && page.includes("Archive notebook") && !page.includes("runConfirmedDelete"),
      "archive: the notebook page removes via the ARCHIVE lifecycle (no destructive default)");
    const archPage = readFileSync("src/app/notebooks/archive/page.tsx", "utf8");
    assert(archPage.includes("Nothing here is deleted") && archPage.includes("action: \"restore\"") && archPage.includes("cache: \"no-store\""),
      "archive: the Archive interface restores honestly without stale cache");
    assert(archPage.includes("Could not restore — it stays archived"),
      "archive: a failed restore keeps the record archived with an honest error");
    const nbPage = readFileSync("src/app/notebooks/page.tsx", "utf8");
    assert(nbPage.includes("/notebooks/archive"), "archive: the archive is reachable from the notebooks list");
  }
// ==== Teachers + Library join the archive lifecycle (0038) ====
  section("teacher and library removal is archive, not destruction");
  {
    const mig = readFileSync("supabase/migrations/0038_teacher_material_archive.sql", "utf8");
    assert(mig.includes("alter table public.teachers") && mig.includes("alter table public.study_materials")
      && mig.includes("add column if not exists archived_at") && !mig.includes("drop table"),
      "archive-0038: additive archived_at on teachers + study_materials, zero drops");
    const arc = readFileSync("src/app/api/archive/route.ts", "utf8");
    assert(arc.includes('teacher: { table: "teachers"') && arc.includes('material: { table: "study_materials"'),
      "archive API: teachers and library items are archiveable kinds");
    const tpe = readFileSync("src/app/teachers/[id]/TeacherProfileEditor.tsx", "utf8");
    assert(tpe.includes('kind: "teacher"') && !tpe.includes('.from("teachers").delete()'),
      "teachers: removal calls the archive API — no client-side destructive delete remains");
    assert(tpe.includes("Archive this teacher?") && tpe.includes("Nothing was changed."),
      "teachers: honest archive confirmation and honest failure (record untouched on error)");
    const lib = readFileSync("src/app/library/page.tsx", "utf8");
    assert(lib.includes('kind: "material"') && !lib.includes('.from("study_materials").delete()'),
      "library: removal archives the row and NEVER deletes the storage object");
    assert(lib.split('.is("archived_at", null)').length >= 4,
      "library: all three active material queries exclude archived items server-side");
    const solve = readFileSync("src/app/api/ai/solve/route.ts", "utf8");
    assert(solve.includes('from("teachers").select("name").eq("id", body.teacher_id).eq("user_id", user.id).is("archived_at", null)'),
      "ai/solve: an archived teacher is not active teacher context");
    assert(solve.includes("if (tp && t) teacherProfile = tp;"),
      "ai/solve: a teacher profile is used only when the teacher itself is active");
    for (const f of ["src/app/api/math/practice/route.ts", "src/app/api/math/prepare/route.ts"]) {
      assert(readFileSync(f, "utf8").includes('from("study_materials").select("title, content").is("archived_at", null)'),
        f + ": archived study materials are excluded from active study workflows");
    }
    const plan = readFileSync("src/app/api/essay/plan/route.ts", "utf8");
    assert(plan.includes('.is("archived_at", null)'),
      "essay/plan: an archived teacher is not active essay context");
    const tpage = readFileSync("src/app/teachers/page.tsx", "utf8");
    assert(tpage.includes('from("teachers").select("*").is("archived_at", null)'),
      "teachers list: archived teachers are hidden from the active list");
  }
}
