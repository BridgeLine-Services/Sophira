/**
 * SHARED ACADEMIC CONTEXT (2026-11-13, Phase 2).
 *
 * The defect these tests pin: the same student got a personalised answer from the main
 * solver and a generic one from the tutor, because the tutor retrieved no memory, no
 * learning patterns and no teacher rules at all - and /api/math/prepare and
 * /api/writing/plan only retrieved subject memory when NO course was selected, so
 * choosing a course silently threw the student's learning history away.
 *
 * The service under test (src/lib/ai/academic-context.ts) assembles that context once for
 * every AI path, from the same tables and selectors the solver uses. What must hold:
 * relevance caps, scope isolation, teacher-over-student precedence, approved-profile-only,
 * graceful degradation, and every read filtered to the signed-in student.
 */
import { readFileSync } from "fs";
import { loadAcademicContext, bounded, contextPrompt, MAX_CONTEXT_CHARS, MAX_PATTERNS } from "../src/lib/ai/academic-context";
import { MAX_PROMPT_MEMORIES, type StudentMemory } from "../src/lib/memory/engine";
import type { LearningPattern } from "../src/lib/learning/patterns";

type Assert = (cond: boolean, msg: string) => void;

type Row = Record<string, unknown>;
type Tables = Record<string, ReadonlyArray<Row>>;
const rows = (v: unknown): Row[] => v as Row[];

/** A minimal chainable stand-in for the Supabase client: filters, updates, failures. */
function fakeClient(tables: Tables, opts: { fail?: string[] } = {}) {
  const reads: { table: string; filters: Record<string, unknown> }[] = [];
  const writes: { table: string; filters: Record<string, unknown>; patch: Row }[] = [];
  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let single = false;
      let patch: Row | null = null;
      const api: Record<string, unknown> = {};
      const self = () => api;
      api.select = self;
      api.order = self;
      api.limit = self;
      api.is = (k: string, v: unknown) => { filters[k] = v; return self(); };
      api.eq = (k: string, v: unknown) => { filters[k] = v; return self(); };
      api.in = (k: string, v: unknown) => { filters[k] = v; return self(); };
      api.maybeSingle = () => { single = true; return self(); };
      api.single = () => { single = true; return self(); };
      api.update = (p: Row) => { patch = p; return self(); };
      // Thenable: every chain resolves to { data, error }.
      api.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
        try {
          if (opts.fail?.includes(table)) {
            return Promise.resolve({ data: null, error: { message: `${table} unavailable` } }).then(onOk, onErr);
          }
          if (patch) {
            writes.push({ table, filters: { ...filters }, patch });
            return Promise.resolve({ data: null, error: null }).then(onOk, onErr);
          }
          reads.push({ table, filters: { ...filters } });
          const rows = (tables[table] ?? []).filter((row) =>
            Object.entries(filters).every(([k, v]) => {
              if (Array.isArray(v)) return v.includes(row[k]);
              return row[k] === v;
            }));
          const data = single ? rows[0] ?? null : rows;
          return Promise.resolve({ data, error: null }).then(onOk, onErr);
        } catch (e) {
          return Promise.reject(e).then(onOk, onErr);
        }
      };
      return api;
    },
  };
  return { client, reads, writes };
}

const USER = "user-1";

function memory(over: Partial<StudentMemory> & { id: string }): StudentMemory {
  return {
    user_id: USER,
    category: "learning_preference",
    statement: "prefers worked examples before practice",
    details: "",
    subject: null,
    subject_tags: ["biology"],
    confidence: 0.8,
    status: "active",
    improvement_trend: "",
    origin: "ai_inferred",
    source: "session",
    first_observed: "2026-11-01T00:00:00Z",
    last_observed: "2026-11-10T00:00:00Z",
    last_used_at: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-10T00:00:00Z",
    course_id: null,
    teacher_id: null,
    assignment_id: null,
    ...over,
  } as unknown as StudentMemory;
}

function pattern(over: Partial<LearningPattern> & { id: string; description: string }): LearningPattern {
  return {
    user_id: USER,
    kind: "recurring_mistake",
    scope: "course",
    subject: "biology",
    course_id: null,
    teacher_id: null,
    assignment_id: null,
    task_type: null,
    examples: [],
    status: "active",
    first_observed: "2026-11-01T00:00:00Z",
    last_observed: "2026-11-10T00:00:00Z",
    observation_count: 3,
    confidence: 0.7,
    source: "observed",
    correction_source: "",
    intentional: false,
    created_at: "2026-11-01T00:00:00Z",
    ...over,
  } as unknown as LearningPattern;
}

export async function runAcademicContextTests(assert: Assert, section: (name: string) => void) {
  section("shared academic context: every AI path sees the same student");

  const course = { id: "course-1", user_id: USER, name: "Biology 101", subject: "biology", academic_level: "high school", instructions: "Show all working.", teacher_id: "teacher-1" };
  const teacher = { id: "teacher-1", user_id: USER, name: "Ms. Okafor" };
  const teacherProfile = { id: "tp-1", user_id: USER, teacher_id: "teacher-1", required_methods: "always state the controlled variables", required_steps: "hypothesis, method, results", preferred_notation: "SI units", units_sig_figs: "2 significant figures", formatting_requirements: "typed, double spaced", citation_requirements: "APA 7", essay_structure: "" };

  // --- 1. course + teacher requirements, with precedence stated --------------
  {
    const { client } = fakeClient({ courses: [course], teachers: [teacher], teacher_profiles: [teacherProfile], learning_patterns: [], student_memories: [] });
    const r = await loadAcademicContext(client as never, USER, { mode: "tutor", courseId: "course-1", subject: "biology" });
    const prompt = contextPrompt(r);
    assert(r.sections[0].startsWith("ORDER OF AUTHORITY"), "context: the order of authority is always the first section");
    assert(/teacher requirements\/rubric/i.test(r.sections[0]) && /approved student preferences/i.test(r.sections[0]),
      "context: the precedence ladder names teacher rules above student preferences");
    assert(prompt.includes("Biology 101") && prompt.includes("Show all working."),
      "context: the course and its instructions are included");
    assert(/Teacher requirements \(Ms\. Okafor\)/.test(prompt), "context: the course's teacher is named");
    assert(prompt.includes("state the controlled variables") && prompt.includes("APA 7"),
      "context: the teacher's structured requirements are included");
    assert(/override the student's own habits/.test(prompt),
      "context: teacher requirements are labelled as overriding the student's habits");
    assert(r.degraded.length === 0, "context: a healthy read reports nothing degraded");
  }

  // --- 2. the regression: memory IS retrieved when a course is selected -----
  {
    const mine = memory({ id: "m-1", course_id: "course-1", statement: "gets cell transport and osmosis confused" });
    const otherCourse = memory({ id: "m-2", course_id: "course-9", statement: "hates poetry" });
    const { client, writes } = fakeClient({ courses: [course], teachers: [], teacher_profiles: [], learning_patterns: [], student_memories: rows([mine, otherCourse]) });
    const r = await loadAcademicContext(client as never, USER, { mode: "math-prepare", courseId: "course-1", subject: "biology" });
    const prompt = contextPrompt(r);
    assert(prompt.includes("cell transport"), "context: a memory scoped to THIS course is used");
    assert(!prompt.includes("poetry"), "context: a memory scoped to another course is excluded, not merely down-ranked");
    assert(r.memoryIds.join(",") === "m-1", "context: only the used memory id is reported back");
    assert(writes.some((w) => w.table === "student_memories" && w.patch.last_used_at && (w.filters as Row).user_id === USER),
      "context: usage is recorded for the used memory, scoped to the signed-in student");
  }

  // --- 3. teacher / assignment scope isolation ------------------------------
  {
    const forThisTeacher = memory({ id: "m-3", teacher_id: "teacher-1", statement: "teacher wants hypotheses in past tense" });
    const forOtherTeacher = memory({ id: "m-4", teacher_id: "teacher-2", statement: "other teacher likes bullet points" });
    const forOtherAssignment = memory({ id: "m-5", assignment_id: "assignment-9", statement: "assignment nine only note" });
    const { client } = fakeClient({ courses: [course], teachers: [teacher], teacher_profiles: [teacherProfile], learning_patterns: [], student_memories: rows([forThisTeacher, forOtherTeacher, forOtherAssignment]) });
    const r = await loadAcademicContext(client as never, USER, { mode: "tutor", courseId: "course-1", subject: "biology", teacherId: "teacher-1", assignmentId: "assignment-1" });
    const prompt = contextPrompt(r);
    assert(prompt.includes("past tense"), "context: this teacher's memory applies inside this teacher's scope");
    assert(!prompt.includes("bullet points"), "context: another teacher's memory never leaks in");
    assert(!prompt.includes("assignment nine"), "context: another assignment's memory never leaks in");
  }

  // --- 4. caps: relevance-bounded, never a dump ----------------------------
  {
    const many = Array.from({ length: 14 }, (_, i) => memory({ id: `many-${i}`, subject_tags: ["biology"], statement: `memory number ${i}` }));
    const { client } = fakeClient({ courses: [], teachers: [], teacher_profiles: [], learning_patterns: [], student_memories: rows(many) });
    const r = await loadAcademicContext(client as never, USER, { mode: "tutor", subject: "biology" });
    assert(r.memoryIds.length === MAX_PROMPT_MEMORIES,
      `context: at most ${MAX_PROMPT_MEMORIES} memories enter the prompt (got ${r.memoryIds.length} of 14 eligible)`);
    assert(r.sections.join("\n").length <= MAX_CONTEXT_CHARS, "context: the assembled prompt stays under the character cap");
  }

  // --- 5. learning patterns are scope-filtered and capped ------------------
  {
    const applicable = pattern({ id: "p-1", description: "omits units in final answers", course_id: "course-1" });
    const wrongCourse = pattern({ id: "p-2", description: "uses contractions in essays", course_id: "course-7" });
    const extra = Array.from({ length: 9 }, (_, i) => pattern({ id: `p-extra-${i}`, description: `pattern ${i}`, course_id: "course-1" }));
    const { client } = fakeClient({ courses: [course], teachers: [], teacher_profiles: [], learning_patterns: rows([applicable, wrongCourse, ...extra]), student_memories: [] });
    const r = await loadAcademicContext(client as never, USER, { mode: "tutor", courseId: "course-1", subject: "biology" });
    const prompt = contextPrompt(r);
    assert(prompt.includes("omits units"), "context: a pattern from this scope is included");
    assert(!prompt.includes("contractions"), "context: a pattern from another course is excluded");
    assert(r.patternTitles.length <= MAX_PATTERNS, `context: patterns are capped at ${MAX_PATTERNS}`);
    assert(/evidence-based, not facts about the student's character/.test(prompt),
      "context: patterns are framed as evidence, not as facts about the student");
  }

  // --- 6. writing profile: approved only, writing tasks only ---------------
  {
    const approved = { id: "wp-1", user_id: USER, guidance: "short sentences, first person, concrete examples", status: "approved", created_at: "2026-11-02T00:00:00Z" };
    const draft = { id: "wp-2", user_id: USER, guidance: "DRAFT ONLY should never apply", status: "draft", created_at: "2026-11-05T00:00:00Z" };
    const writing = fakeClient({ courses: [], teachers: [], teacher_profiles: [], learning_patterns: [], student_memories: [], writing_profiles: [draft, approved] });
    const w = await loadAcademicContext(writing.client as never, USER, { mode: "writing-plan", subject: "english", isWritingTask: true });
    assert(contextPrompt(w).includes("short sentences"), "context: the approved writing profile applies to writing tasks");
    assert(!contextPrompt(w).includes("DRAFT ONLY"), "context: a draft profile is never applied");
    const tutoring = fakeClient({ courses: [], teachers: [], teacher_profiles: [], learning_patterns: [], student_memories: [], writing_profiles: [approved] });
    const t = await loadAcademicContext(tutoring.client as never, USER, { mode: "tutor", subject: "english" });
    assert(!tutorialsIncludes(t.sections), "context: the writing profile is not injected into a non-writing answer");
  }

  // --- 7. degradation: a failed read is reported, never invented -----------
  {
    const { client } = fakeClient({ courses: [course], teachers: [teacher], teacher_profiles: [teacherProfile], learning_patterns: [], student_memories: [] }, { fail: ["student_memories", "learning_patterns"] });
    const r = await loadAcademicContext(client as never, USER, { mode: "tutor", courseId: "course-1", subject: "biology" });
    assert(contextPrompt(r).includes("Biology 101"), "degrade: the sections that could be read are still used");
    assert(r.degraded.some((d) => /learning memory/.test(d)), "degrade: an unavailable memory source is stated plainly");
    assert(r.degraded.some((d) => /learning patterns/.test(d)), "degrade: an unavailable pattern source is stated plainly");
    assert(r.memoryIds.length === 0, "degrade: nothing is invented to fill a failed read");
  }

  // --- 8. privacy: every read is filtered to the signed-in student --------
  {
    const { client, reads } = fakeClient({ courses: [course], teachers: [teacher], teacher_profiles: [teacherProfile], learning_patterns: [], student_memories: [], writing_profiles: [] });
    await loadAcademicContext(client as never, USER, { mode: "writing-plan", courseId: "course-1", subject: "biology", isWritingTask: true });
    const unscoped = reads.filter((r) => r.table !== "courses" && (r.filters as Row).user_id !== USER);
    assert(unscoped.length === 0, `privacy: every non-course read carries the signed-in user id (unscoped: ${unscoped.map((r) => r.table).join(", ") || "none"})`);
    assert(reads.some((r) => r.table === "courses" && (r.filters as Row).user_id === USER), "privacy: the course read is scoped too");
  }

  // --- 9. bounded() keeps the authority line and drops whole sections ----
  {
    const big = Array.from({ length: 20 }, () => "x".repeat(500));
    const out = bounded(big);
    assert(out[0].startsWith("ORDER OF AUTHORITY"), "bounded: the precedence rule always survives");
    assert(out.reduce((n, s) => n + s.length + 1, 0) <= MAX_CONTEXT_CHARS, "bounded: the total stays within the cap");
    assert(out.length < big.length + 1 && out.length > 1, "bounded: whole sections are dropped rather than clipped mid-rule");
  }

  // --- 10. nothing to say -> no invented context, no crash --------------
  {
    const { client } = fakeClient({});
    const r = await loadAcademicContext(client as never, USER, { mode: "tutor" });
    assert(r.sections.length === 1 && r.sections[0].startsWith("ORDER OF AUTHORITY"), "empty: only the precedence rule is emitted");
    assert(contextPrompt(r).trim().length > 0, "empty: the prompt still carries the precedence rule");
  }

  // --- 11. every AI path is actually wired to the service --------------
  section("shared academic context: the tutor and subject engines use it");
  const tutor = readFileSync("src/app/api/tutor/route.ts", "utf8");
  const mathPrep = readFileSync("src/app/api/math/prepare/route.ts", "utf8");
  const writingPlan = readFileSync("src/app/api/writing/plan/route.ts", "utf8");
  assert(tutor.includes("loadAcademicContext") && tutor.includes("contextPrompt(academic)"),
    "tutor: the tutor route passes the assembled context into its system prompt");
  const mathPractice = readFileSync("src/app/api/math/practice/route.ts", "utf8");
  const mathSolve = readFileSync("src/app/api/math/solve/route.ts", "utf8");
  const grammar = readFileSync("src/app/api/writing/grammar/route.ts", "utf8");

  // 2026-11-13 (Phase 4): ALL FIVE AI paths now use it. practice and grammar were the
  // last two that read no academic memory, and the solver answered from the problem
  // alone. The list is explicit so a future route cannot quietly skip the context.
  const wired: [string, string][] = [
    ["math/prepare", mathPrep], ["writing/plan", writingPlan],
    ["math/practice", mathPractice], ["writing/grammar", grammar], ["math/solve", mathSolve],
  ];
  for (const [name, src] of wired) {
    assert(src.includes("loadAcademicContext") && src.includes("contextPrompt(academic"),
      `${name}: uses the shared academic context`);
    assert(/teacherId: body\.teacher_id \?\? null/.test(src) && /assignmentId: body\.assignment_id \?\? null/.test(src),
      `${name}: passes the teacher and assignment scope through, so the five scopes stay separate`);
  }

  // The subject WORKSPACE context is a different feature and must survive: practice and
  // grammar keep it, because science reasoning rules and language preferences live there.
  for (const [name, src] of [["math/practice", mathPractice], ["writing/grammar", grammar]] as const) {
    assert(src.includes("subjectPromptContext"),
      `${name}: still applies the subject workspace context (science reasoning, language preference)`);
  }
  // The defect was MEMORY being gated on "no course selected". The academic context is
  // loaded unconditionally, and the subject workspace text (a different feature) may stay
  // behind that condition without hiding any memory.
  const practiceContextLine = mathPractice.indexOf("const academic = await loadAcademicContext");
  const practiceGate = mathPractice.indexOf("if (!body.course_id) {");
  assert(practiceContextLine > 0 && practiceContextLine < practiceGate,
    "math/practice: memory is loaded for EVERY course selection, not only when no course is chosen");

  // THE SOLVER'S DETERMINISM IS NON-NEGOTIABLE: the context may reach the EXPLANATION,
  // and must never reach the deterministic pipeline, its steps, or its verification.
  assert(/explainWithAi\(sol, rec, body\.mode, subjectLabel, academicText\)/.test(mathSolve),
    "math/solve: the academic context reaches the explanation");
  assert(!/runMathPipeline\([\s\S]{0,200}academicText/.test(mathSolve),
    "math/solve: the academic context NEVER reaches the deterministic solver");
  assert(/applyTeacherMethod: applyTeacherMethod\(teacherProfile\)/.test(mathSolve),
    "math/solve: the existing teacher-method check is unchanged");
  assert(/isWritingTask: true/.test(grammar) && !/isWritingTask: true/.test(mathPractice),
    "grammar: asks for the writing profile; math does not");
  assert(/isWritingTask: true/.test(writingPlan), "writing/plan: asks for the writing profile explicitly");
  assert(!/isWritingTask: true/.test(mathPrep) && !/isWritingTask: true/.test(tutor),
    "math and tutor: no writing profile is injected into non-writing work");

  // --- 12. provider readiness wording is shared and names no secret ----
  section("provider readiness: one plain-language message, no secrets, no vendor");
  const providerSrc = readFileSync("src/lib/ai/provider.ts", "utf8");
  assert(providerSrc.includes("export const AI_NOT_CONFIGURED_MESSAGE"), "provider: the shared message exists");
  for (const f of [
    "src/app/api/ai/analyze-writing/route.ts", "src/app/api/ai/extract-teacher-doc/route.ts", "src/app/api/ai/solve/route.ts",
    "src/app/api/math/practice/route.ts", "src/app/api/math/prepare/route.ts", "src/app/api/tutor/route.ts",
    "src/app/api/writing/grammar/route.ts", "src/app/api/writing/plan/route.ts",
  ]) {
    const src = readFileSync(f, "utf8");
    assert(src.includes("AI_NOT_CONFIGURED_MESSAGE"), `${f}: uses the shared readiness message`);
    assert(!/OPENAI_API_KEY environment variable/.test(src), `${f}: no longer names an environment variable to a student`);
  }
}

/** helper kept separate so the assertion reads as intent, not as a regex */
function tutorialsIncludes(sections: string[]): boolean {
  return sections.join("\n").includes("short sentences");
}
