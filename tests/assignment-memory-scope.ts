/**
 * ASSIGNMENT NOTES — scope 5 of five (2026-11-14).
 *
 * The memory engine has always treated an assignment-scoped memory as the narrowest
 * and highest-precedence scope, and has always refused to apply a note belonging to a
 * different assignment. What was missing was any way for a student to WRITE one:
 * /api/memory accepted a course, and since 2026-11-13 a teacher, but nothing narrower.
 * Scope 5 was therefore reachable only by the learning system, never by the person the
 * note is about.
 *
 * These tests pin four things:
 *   1. the precedence is real — an assignment note outranks teacher, course, subject and
 *      general memories carrying identical wording;
 *   2. the isolation is real — one assignment's note is never applied to another, and
 *      with no assignment in context an assignment-scoped note is not applied at all;
 *   3. the API accepts an assignment, refuses one that is not the student's BEFORE
 *      writing anything, and still takes user_id from the session, never the body;
 *   4. the screen exists on the assignment page, says what the note does in plain
 *      English, and can turn one off, back on, or remove it.
 */
import { readFileSync } from "fs";
import {
  SCOPE_BONUS,
  WIDER_SCOPE_TIEBREAK,
  relevanceScore,
  selectRelevantMemories,
  type StudentMemory,
} from "../src/lib/memory/engine";

type Assert = (cond: boolean, msg: string) => void;

const USER = "11111111-1111-4111-8111-111111111111";
const ASSIGNMENT_A = "22222222-2222-4222-8222-222222222222";
const ASSIGNMENT_B = "33333333-3333-4333-8333-333333333333";
const TEACHER = "44444444-4444-4444-8444-444444444444";
const COURSE = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-11-14T00:00:00Z";

function memory(over: Partial<StudentMemory> & { id: string }): StudentMemory {
  return {
    user_id: USER,
    category: "learning_preference",
    statement: "Put the uncertainty in its own column",
    details: "",
    subject: null,
    subject_tags: [],
    confidence: 1,
    status: "active",
    improvement_trend: "",
    origin: "student_supplied",
    source: "manual",
    first_observed: NOW,
    last_observed: NOW,
    last_used_at: null,
    created_at: NOW,
    updated_at: NOW,
    course_id: null,
    teacher_id: null,
    assignment_id: null,
    ...over,
  } as unknown as StudentMemory;
}

export function runAssignmentMemoryTests(assert: Assert, section: (name: string) => void) {
  const api = readFileSync("src/app/api/memory/route.ts", "utf8");
  const page = readFileSync("src/app/assignments/[id]/page.tsx", "utf8");
  const component = readFileSync("src/components/app/AssignmentNotes.tsx", "utf8");
  const store = readFileSync("src/lib/memory/store.ts", "utf8");

  section("assignment notes: scope 5 is the narrowest, and it wins");

  assert(SCOPE_BONUS.assignment > SCOPE_BONUS.teacher,
    "an assignment note outranks a teacher preference");
  assert(SCOPE_BONUS.teacher > SCOPE_BONUS.course && SCOPE_BONUS.course > SCOPE_BONUS.subjectTag,
    "under it, the ladder teacher > course > subject still holds");
  // Precedence has to survive STACKING. A memory that matches several wider scopes used to
  // add every bonus together (teacher + course = 1.9), which outranked the student's own
  // note for the assignment in front of them (1.4) — an inversion the five-scope rule
  // forbids. The narrowest match now decides, and extra wider matches are a tie-break.
  assert(WIDER_SCOPE_TIEBREAK > 0 && WIDER_SCOPE_TIEBREAK < SCOPE_BONUS.general,
    "the tie-break is small enough to never add up to another scope level");
  assert(SCOPE_BONUS.assignment > SCOPE_BONUS.teacher + WIDER_SCOPE_TIEBREAK * 5,
    "even matching every wider scope at once cannot overtake an assignment note");

  const ctx = { assignmentId: ASSIGNMENT_A, teacherId: TEACHER, courseId: COURSE, subject: "Biology" };
  const wording = "Put the uncertainty in its own column";
  const sAssignment = relevanceScore(memory({ id: "a1", assignment_id: ASSIGNMENT_A }), ctx, NOW);
  const sTeacher = relevanceScore(memory({ id: "t1", teacher_id: TEACHER }), ctx, NOW);
  const sCourse = relevanceScore(memory({ id: "c1", course_id: COURSE }), ctx, NOW);
  const sSubject = relevanceScore(memory({ id: "s1", subject_tags: ["biology"] }), ctx, NOW);
  const sGeneral = relevanceScore(memory({ id: "g1" }), ctx, NOW);
  assert(sAssignment > sTeacher, "with the assignment in context, its own note scores highest");
  assert(sTeacher > sCourse && sCourse > sSubject && sSubject > sGeneral,
    "and the rest of the ladder is unchanged for identical wording");
  const both = selectRelevantMemories(
    [memory({ id: "all", assignment_id: ASSIGNMENT_A, teacher_id: TEACHER, course_id: COURSE, subject_tags: ["biology"] })],
    ctx, NOW);
  assert(both.lines.length === 1 && both.lines[0].includes(wording),
    "a note can carry an assignment and wider scopes at once and is still retrieved");

  // The regression that matters: a stacked wider memory must not beat this assignment's note.
  const stacked = memory({ id: "st", teacher_id: TEACHER, course_id: COURSE, subject_tags: ["biology"] });
  const ownNote = memory({ id: "own", assignment_id: ASSIGNMENT_A });
  const sStacked = relevanceScore(stacked, ctx, NOW);
  const sOwn = relevanceScore(ownNote, ctx, NOW);
  assert(sOwn > sStacked,
    "one assignment note outranks a memory that matches the teacher, course and subject all at once");
  const ranking = selectRelevantMemories([stacked, ownNote], ctx, NOW);
  assert(ranking.lines[0].includes(wording) && ranking.decisions[0].id === "own",
    "and it is listed first in the prompt, so the model reads it as the one that wins");
  // Adding the wider scopes to the SAME note may only raise it, never lower it.
  const ownPlusWider = memory({ id: "own2", assignment_id: ASSIGNMENT_A, teacher_id: TEACHER, course_id: COURSE });
  assert(relevanceScore(ownPlusWider, ctx, NOW) > sOwn,
    "a note that also names its teacher and course still ranks at or above the same note alone");

  section("assignment notes: they never leak into another assignment");

  const noteForB = memory({ id: "b1", statement: wording, assignment_id: ASSIGNMENT_B });
  const forA = selectRelevantMemories([noteForB], { assignmentId: ASSIGNMENT_A }, NOW);
  const forB = selectRelevantMemories([noteForB], { assignmentId: ASSIGNMENT_B }, NOW);
  assert(forA.lines.length === 0, "another assignment's note is never retrieved for this one");
  assert(forB.lines.length === 1, "it is retrieved for the assignment it belongs to");
  assert(selectRelevantMemories([noteForB], {}, NOW).lines.length === 0,
    "with no assignment in context, an assignment-scoped note is not applied at all");
  assert(selectRelevantMemories([noteForB], { teacherId: TEACHER, courseId: COURSE }, NOW).lines.length === 0,
    "matching the same teacher and course is not enough: the assignment must match too");

  // The narrow scope must not swallow the wider ones: ordinary memories still apply.
  const mixture = selectRelevantMemories(
    [noteForB, memory({ id: "g2", statement: "Prefers short paragraphs" })],
    { assignmentId: ASSIGNMENT_A }, NOW);
  assert(mixture.lines.length === 1 && mixture.lines[0].includes("Prefers short paragraphs"),
    "a general memory is still applied while a different assignment's note is held back");

  section("assignment notes: the API takes an assignment and checks it is yours");

  assert(api.includes('assignment_id: params.get("assignment_id") || undefined'),
    "the list can be narrowed to one assignment (an already user_id-scoped, RLS-protected list)");
  assert(api.includes("const assignment_id = body.assignment_id ? String(body.assignment_id) : null;"),
    "a saved note can carry the assignment it belongs to");
  assert(/if \(assignment_id\) \{[\s\S]{0,400}\.from\("assignments"\)[\s\S]{0,200}maybeSingle\(\)/.test(api),
    "the assignment id is looked up on the request-scoped client before anything is written");
  assert(api.includes("That assignment is not in your list."),
    "an unknown or someone else's assignment is refused in plain language");
  assert(/if \(!assignment\) \{\s*return NextResponse\.json\(\{ error: "That assignment is not in your list\." \}, \{ status: 400 \}\);/.test(api),
    "the refusal happens before the insert, and is a 400 not a 500");
  assert(api.includes("assignment_id,") && api.includes("teacher_id,") && api.includes("course_id,"),
    "the scoped ids are stored with the note");
  assert(api.includes("user_id: guard.data.user.id"),
    "the owner of the note still comes from the session, never from the request body");
  assert(!/user_id:\s*body/.test(api), "no route accepts a user_id from the body");

  section("assignment notes: the storage layer already carries the scope");

  assert(/filters: \{[^}]*assignment_id\?: string/.test(store),
    "listMemories accepts an assignment filter");
  assert(store.includes('query.eq("assignment_id", filters.assignment_id)'),
    "the filter is applied to the query, not ignored");
  assert(store.includes("assignment_id?: string | null;"),
    "the learning system can still record an observation against an assignment");
  assert(store.includes("assignment_id: args.assignment_id ?? null,"),
    "and that assignment is written with the new memory row");

  section("assignment notes: the model is given the assignment, not just the course");

  for (const route of [
    "src/app/api/ai/solve/route.ts",
    "src/app/api/math/prepare/route.ts",
    "src/app/api/math/solve/route.ts",
    "src/app/api/math/practice/route.ts",
  ]) {
    const src = readFileSync(route, "utf8");
    const wired = /assignmentId:\s*[^,\n]*assignment_id/.test(src) || /assignmentId:\s*assignmentId/.test(src);
    assert(wired && src.includes("assignment_id"),
      `${route} passes the assignment into the academic context, so scope 5 is actually retrieved`);
  }

  section("assignment notes: the assignment page shows and manages them");

  assert(page.includes("AssignmentNotes") && page.includes("assignmentTitle={assignment.title}"),
    "the assignment page renders the notes card for that assignment");
  assert(/\.eq\("assignment_id", assignment\.id\)/.test(page) && /\.eq\("user_id", user\.id\)/.test(page),
    "the page reads only this member's rows for this assignment");
  assert(page.includes('.neq("status", "forgotten")'),
    "a removed note is not listed again");
  assert(page.includes("import type { StudentMemory }"), "the initial list is typed, not `any`");

  assert(component.includes("fetch(`/api/memory?assignment_id="),
    "the card asks the API for this assignment only");
  assert(component.includes("assignment_id: assignmentId"),
    "saving sends the assignment with the note");
  const flat = component.replace(/\s+/g, " ");
  assert(flat.includes("Anything you save here is used only while you work on"),
    "the card says the note is limited to this assignment");
  assert(flat.includes("It comes before your teacher, course and subject preferences"),
    "the card says, in plain English, that it outranks the wider scopes");
  assert(flat.includes("The brief and your teacher&apos;s instructions still come first"),
    "the card says the brief and the teacher still win");
  assert(component.includes("Nothing saved for this assignment yet"),
    "an empty assignment shows an empty state, not a blank space");
  assert(component.includes('act(m, "disable")') && component.includes('act(m, "restore")')
    && component.includes('act(target, "forget")'),
    "a note can be turned off, turned back on, and removed");
  assert(component.includes("cannot be undone"),
    "removing is confirmed first and says it cannot be undone");
  assert(component.includes("noticed by Sophira, not yet confirmed by you"),
    "an AI-observed note is labelled differently from one the student wrote");

  // A student reads prose, not identifiers. Collect the JSX text and the prose
  // attributes, then refuse database or scope vocabulary.
  const proseAttrs = (component.match(/(?:placeholder|title|description|confirmLabel|message)="([^"]{12,})"/g) ?? [])
    .map((t) => t.replace(/^[a-zA-Z]+="|"$/g, ""));
  const stripped = component
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\{[^{}]*\}/g, " ");
  const jsxLines = (stripped.match(/>([^<>]{25,})</g) ?? [])
    .map((t) => t.slice(1, -1).trim())
    .filter((t) => /^[A-Z]/.test(t) && /\s/.test(t) && !/[;=]/.test(t));
  const copy = [...jsxLines, ...proseAttrs].filter((line) => /\s/.test(line));
  assert(copy.length >= 4, `the card has real prose on screen, not only labels (found ${copy.length})`);
  const jargon = copy.filter((line) =>
    /\bRLS\b|row level|row-level|scope 5|memory_id|user_id|assignment_id|teacher_id|foreign key|\bnull\b|endpoint|payload/i.test(line));
  assert(jargon.length === 0, `the card says nothing a student cannot read (found: ${jargon.join(" | ")})`);
}
