/**
 * TEACHER PREFERENCES — scope 4 of five (2026-11-13).
 *
 * The memory engine has always ranked a teacher-scoped memory above course, subject and
 * general ones, and has always refused to apply it to another teacher's work. What was
 * missing was any way for a student to WRITE one: /api/memory accepted a course and
 * nothing narrower, so scope 4 was reachable only by the learning system, never by the
 * person the memory is about.
 *
 * These tests pin three things:
 *   1. the precedence is real, in both directions — teacher beats course/subject/general,
 *      and a teacher-scoped memory never applies to another teacher;
 *   2. the API accepts a teacher, validates that the teacher is the student's own before
 *      writing anything, and still takes user_id from the signed-in session, never the body;
 *   3. the screen exists on the teacher's page, says what the preference does in plain
 *      English, and can turn one off, back on, or remove it.
 */
import { readFileSync } from "fs";
import {
  SCOPE_BONUS,
  relevanceScore,
  selectRelevantMemories,
  type StudentMemory,
} from "../src/lib/memory/engine";

type Assert = (cond: boolean, msg: string) => void;

const USER = "11111111-1111-4111-8111-111111111111";
const TEACHER_A = "22222222-2222-4222-8222-222222222222";
const TEACHER_B = "33333333-3333-4333-8333-333333333333";
const COURSE = "44444444-4444-4444-8444-444444444444";

function memory(over: Partial<StudentMemory> & { id: string }): StudentMemory {
  return {
    user_id: USER,
    category: "learning_preference",
    statement: "Always show the working before the answer",
    details: "",
    subject: null,
    subject_tags: [],
    confidence: 1,
    status: "active",
    improvement_trend: "",
    origin: "student_supplied",
    source: "manual",
    first_observed: "2026-11-13T00:00:00Z",
    last_observed: "2026-11-13T00:00:00Z",
    last_used_at: null,
    created_at: "2026-11-13T00:00:00Z",
    updated_at: "2026-11-13T00:00:00Z",
    course_id: null,
    teacher_id: null,
    assignment_id: null,
    ...over,
  } as unknown as StudentMemory;
}

export function runTeacherPreferenceTests(assert: Assert, section: (name: string) => void) {
  const api = readFileSync("src/app/api/memory/route.ts", "utf8");
  const page = readFileSync("src/app/teachers/[id]/page.tsx", "utf8");
  const component = readFileSync("src/components/app/TeacherPreferences.tsx", "utf8");

  section("teacher preferences: the precedence is real, not a comment");

  // Narrower always outranks wider, and no combination of wider bonuses can overtake it.
  assert(SCOPE_BONUS.teacher > SCOPE_BONUS.course, "a teacher preference outranks a course one");
  assert(SCOPE_BONUS.course > SCOPE_BONUS.subjectTag, "a course preference outranks a subject one");
  assert(SCOPE_BONUS.subjectTag > SCOPE_BONUS.subjectField, "a subject tag outranks a bare subject field");
  assert(SCOPE_BONUS.subjectField > SCOPE_BONUS.general, "any subject match outranks a general memory");
  // A memory is scored by its OWN dimensions, so the honest invariant is that adding a
  // narrower scope to otherwise identical wording always ranks higher, never lower.
  assert(SCOPE_BONUS.teacher > 0 && SCOPE_BONUS.course > 0 && SCOPE_BONUS.subjectTag > 0,
    "every scope level contributes a real bonus");
  assert(SCOPE_BONUS.teacher > SCOPE_BONUS.general * 4,
    "a teacher preference is never a tie with a general one");

  const ctx = { teacherId: TEACHER_A, courseId: COURSE, subject: "Calculus" };
  const nowISO = "2026-11-13T00:00:00Z";
  const sameText = "Always show the working before the answer";
  const teacherLevel = memory({ id: "m1", statement: sameText, teacher_id: TEACHER_A });
  const courseLevel = memory({ id: "m2", statement: sameText, course_id: COURSE });
  const subjectLevel = memory({ id: "m3", statement: sameText, subject_tags: ["calculus"] });
  const general = memory({ id: "m4", statement: sameText });

  const sTeacher = relevanceScore(teacherLevel, ctx, nowISO);
  const sCourse = relevanceScore(courseLevel, ctx, nowISO);
  const sSubject = relevanceScore(subjectLevel, ctx, nowISO);
  const sGeneral = relevanceScore(general, ctx, nowISO);
  assert(sTeacher > sCourse, "with a teacher in context, the teacher's preference scores highest");
  assert(sCourse > sSubject && sSubject > sGeneral,
    "course, then subject, then general: the ladder holds for identical wording");
  const teacherPlusSubject = memory({ id: "m6", statement: sameText, teacher_id: TEACHER_A, subject_tags: ["calculus"] });
  assert(relevanceScore(teacherPlusSubject, ctx, nowISO) > sTeacher,
    "adding the teacher's own subject to a teacher preference still ranks it higher, never lower");

  section("teacher preferences: they never leak to another teacher");

  const otherTeacher = memory({ id: "m5", statement: "Use British spelling", teacher_id: TEACHER_B });
  const forA = selectRelevantMemories([otherTeacher], { teacherId: TEACHER_A }, nowISO);
  const forB = selectRelevantMemories([otherTeacher], { teacherId: TEACHER_B }, nowISO);
  assert(forA.lines.length === 0, "another teacher's preference is never retrieved for this teacher");
  assert(forB.lines.length === 1, "it is retrieved for the teacher it belongs to");
  const noTeacher = selectRelevantMemories([otherTeacher], {}, nowISO);
  assert(noTeacher.lines.length === 0,
    "with no teacher in context, a teacher-scoped preference is not applied at all");

  const both = selectRelevantMemories([teacherLevel, general], ctx, nowISO);
  assert(both.lines[0].includes(sameText) && both.lines.length === 2,
    "when both apply, the teacher's preference is listed first");

  section("teacher preferences: the API takes a teacher and checks it is yours");

  assert(api.includes('teacher_id: params.get("teacher_id") || undefined'),
    "the list can be narrowed to one teacher (an already user_id-scoped, RLS-protected list)");
  assert(api.includes("const teacher_id = body.teacher_id ? String(body.teacher_id) : null;"),
    "a saved preference can carry the teacher it belongs to");
  assert(/if \(teacher_id\) \{[\s\S]{0,400}\.from\("teachers"\)[\s\S]{0,200}maybeSingle\(\)/.test(api),
    "the teacher id is looked up on the request-scoped client before anything is written");
  assert(api.includes("That teacher is not in your list."),
    "an unknown or someone else's teacher is refused in plain language");
  assert(/if \(!teacher\) \{\s*return NextResponse\.json\(\{ error: "That teacher is not in your list\." \}, \{ status: 400 \}\);/.test(api),
    "the refusal happens before the insert, and is a 400 not a 500");
  assert(api.includes("teacher_id,") && api.includes("course_id,"),
    "the scoped ids are stored with the memory");
  assert(api.includes("user_id: guard.data.user.id"),
    "the owner of the preference still comes from the session, never from the request body");
  assert(!/user_id:\s*body/.test(api), "no route accepts a user_id from the body");
  assert(api.includes("origin: \"student_supplied\""),
    "a preference the student writes is a stated fact, not an AI guess");

  section("teacher preferences: the teacher's page shows and manages them");

  assert(page.includes("TeacherPreferences") && page.includes("teacherName={teacher.name}"),
    "the teacher page renders the preferences card for that teacher");
  assert(/\.eq\("teacher_id", teacher\.id\)/.test(page) && /\.eq\("user_id", user\.id\)/.test(page),
    "the page reads only this member's rows for this teacher");
  assert(page.includes('.neq("status", "forgotten")'),
    "a removed preference is not listed again");
  assert(page.includes("import type { StudentMemory }"), "the initial list is typed, not `any`");

  assert(component.includes('fetch(`/api/memory?teacher_id='),
    "the card asks the API for this teacher only");
  assert(component.includes("teacher_id: teacherId"),
    "saving sends the teacher with the preference");
  const compFlat = component.replace(/\s+/g, " ");
  assert(compFlat.includes("They come before your course, subject and general preferences"),
    "the card says, in plain English, that these outrank the wider ones");
  assert(compFlat.includes("These apply only when you are working with"),
    "the card says the preference is limited to this teacher");
  assert(component.includes("Nothing saved for ${teacherName} yet"),
    "an empty teacher shows an empty state, not a blank space");
  assert(component.includes('act(m, "disable")') && component.includes('act(m, "restore")')
    && component.includes('act(target, "forget")'),
    "a preference can be turned off, turned back on, and removed");
  assert(component.includes("cannot be undone"),
    "removing is confirmed first and says it cannot be undone");
  assert(component.includes("noticed by Sophira, not yet confirmed by you"),
    "an AI-observed preference is labelled differently from one the student wrote");

  // The five scopes must stay understandable to a student: no database words on screen.
  // Only the prose a student reads is collected: JSX text between tags, plus the prose
  // attributes. Class names and identifiers are not student-visible copy.
  const proseAttrs = (component.match(/(?:placeholder|title|description|confirmLabel|message)="([^"]{12,})"/g) ?? [])
    .map((t) => t.replace(/^[a-zA-Z]+="|"$/g, ""));
  // Strip comments and JSX expressions, then every remaining >text< run is copy the
  // student actually reads. Code identifiers live inside the expressions we removed.
  const stripped = component
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\{[^{}]*\}/g, " ");
  const jsxLines = (stripped.match(/>([^<>]{25,})</g) ?? [])
    .map((t) => t.slice(1, -1).trim())
    .filter((t) => /^[A-Z]/.test(t) && /\s/.test(t) && !/[;=]/.test(t));
  const copy = [...jsxLines, ...proseAttrs].filter((line) => /\s/.test(line));
  assert(copy.length >= 4, `the card has real prose on screen, not only labels (found ${copy.length})`);
  const jargon = copy.filter((line) =>
    /\bRLS\b|row level|row-level|scope 4|memory_id|user_id|teacher_id|foreign key|\bnull\b|endpoint|payload/i.test(line));
  assert(jargon.length === 0, `the card says nothing a student cannot read (found: ${jargon.join(" | ")})`);
}
