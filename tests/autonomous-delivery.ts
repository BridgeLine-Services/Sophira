/**
 * THE HAND-OFF FROM A RUN TO THE STUDENT'S ESSAY (directive 2026-11-15, Part 6).
 *
 * The defect this file exists for: a run could reach "completed" with its text stored only in
 * `assignment_runs`, which is not a table any student can open, print or export. The work was
 * real and unreachable. Delivery now writes the piece into `essay_sessions` — the table the
 * essay workspace already reads — and a failure to deliver blocks the run instead of finishing it.
 *
 * Offline: the decisions, the columns and the wiring are pinned from source. The database calls
 * themselves are exercised by the live checks, which need a signed-in member.
 */
import { readFileSync } from "node:fs";
import { deliveryDecision, sessionPayload, sessionTitle } from "@/lib/essay/delivery";
import { newRun, type RunRecord } from "@/lib/essay/autonomous";

function baseRun(overrides: Partial<RunRecord> = {}): RunRecord {
  const run = newRun({
    id: "0b8f6f6e-0000-4000-8000-000000000001",
    userId: "0b8f6f6e-0000-4000-8000-0000000000aa",
    request: {
      question: "Why did the Berlin Wall fall in 1989?",
      title: "The wall comes down",
      genre: "Essay",
      courseId: "course-1",
      subject: null,
      teacherId: "teacher-1",
      assignmentId: "assignment-1",
      researchProjectId: null,
      deadline: null,
    },
    nowMs: 1_760_000_000_000,
  });
  return {
    ...run,
    outline: [
      { id: "s1", title: "Introduction", brief: "", targetWords: 300 },
      { id: "s2", title: "Pressure", brief: "", targetWords: 500 },
    ],
    sections: [
      { id: "s1", draft: "The wall fell because pressure built on several fronts.", audits: { citation: "pass", rubric: "pass", style: "pass" } },
      { id: "s2", draft: "Moscow's decision not to intervene removed the last guarantee.", audits: { citation: "pass", rubric: "pass", style: "pass" } },
    ],
    final_verification: { status: "VERIFIED", note: "Every section cites a source that is in the plan." },
    state: "verifying",
    ...overrides,
  } as RunRecord;
}

export function runAutonomousDeliveryTests(assert: (cond: boolean, msg: string) => void, section: (name: string) => void): void {
  section("delivery: an unfinished run never reaches the library");

  // A run as it is created: no outline, no text, no verdict.
  const fresh = newRun({
    id: "0b8f6f6e-0000-4000-8000-000000000002",
    userId: "0b8f6f6e-0000-4000-8000-0000000000aa",
    request: { question: "What caused the 2008 financial crisis?", title: null, genre: "Essay", courseId: null, subject: null, teacherId: null, assignmentId: null, researchProjectId: null, deadline: null },
    nowMs: 1_760_000_000_000,
  });
  assert(deliveryDecision(fresh).allowed === false,
    "delivery: a run that has not finished may not place a document in the library");
  assert((deliveryDecision(fresh).reason ?? "").length > 0,
    "delivery: refusing says why, in a sentence a student can read");

  const noVerdict = baseRun({ final_verification: null });
  assert(deliveryDecision(noVerdict).allowed === false,
    "delivery: a run with stored text but no stored verdict may not deliver — the same gate completion uses");

  const halfDrafted = baseRun();
  halfDrafted.sections = [halfDrafted.sections[0], { ...halfDrafted.sections[1], draft: null }];
  assert(deliveryDecision(halfDrafted).allowed === false,
    "delivery: one section without text is enough to refuse delivery of the whole piece");

  assert(deliveryDecision(baseRun()).allowed === true,
    "delivery: a run whose every section is stored and verified may deliver");

  section("delivery: the columns it writes are the ones the essay workspace reads");

  const payload = sessionPayload(baseRun());
  assert(payload.stage === "final_verification" && payload.status === "verified",
    "delivery: the essay is stored in the same stage and status the manual workflow would reach");
  assert(payload.outline_approved === true,
    "delivery: the outline is recorded as approved, because the runner drafted against it");
  assert(Array.isArray(payload.outline) && Array.isArray(payload.sections),
    "delivery: the outline and the sections are the run's own arrays, not a summary of them");
  assert(payload.final_verification !== null,
    "delivery: the verification result travels with the piece");
  assert(payload.assignment_id === "assignment-1" && payload.course_id === "course-1" && payload.teacher_id === "teacher-1",
    "delivery: the essay keeps the assignment, course and teacher the run was started for");
  assert(payload.question.includes("Berlin Wall"),
    "delivery: the student's own question is stored with the essay, so it opens with its brief");
  assert(sessionTitle(baseRun()) === "The wall comes down",
    "delivery: the essay is titled from what the student asked for, never from model output");
  const longTitle = baseRun();
  longTitle.request = { ...longTitle.request, title: null, question: "x".repeat(200) };
  assert(sessionTitle(longTitle).length <= 80,
    "delivery: a long question is shortened to a usable title instead of filling the library with one line");

  section("delivery: a retry updates the same essay instead of duplicating it");

  const delivered = baseRun({ essay_session_id: "session-abc" });
  assert(delivered.essay_session_id === "session-abc",
    "delivery: the run remembers the essay it created");
  const viewSource = readFileSync("src/lib/essay/autonomous.ts", "utf8");
  assert(viewSource.includes("documentSessionId: run.essay_session_id"),
    "delivery: the student's screen is told which essay the run delivered");
  assert(viewSource.includes("documentSessionId: string | null"),
    "delivery: that field is optional, because a run that has not finished has no essay yet");

  section("delivery: a run is never finished without a reachable essay");

  const runner = readFileSync("src/lib/essay/runner.ts", "utf8");
  assert(runner.includes("deliverRunToLibrary(supabase, userId, adjusted)"),
    "delivery: the runner calls delivery as part of the completion step");
  assert(/delivered\.error \|\| !delivered\.sessionId/.test(runner) && runner.includes("blockRun(adjusted"),
    "delivery: when delivery fails the run is blocked, not marked complete");
  assert(runner.includes("essay_session_id: delivered.sessionId"),
    "delivery: the run records the essay id it just delivered");
  assert(runner.includes("put the piece in your library") || runner.includes("updated the piece in your library"),
    "delivery: the step's own account of what it did mentions the hand-off");

  const screen = readFileSync("src/components/app/AutonomousRuns.tsx", "utf8");
  assert(screen.includes("/essay?session=${run.documentSessionId}"),
    "delivery: the student's screen links straight to the finished piece");
  assert(screen.includes("Open the finished piece"),
    "delivery: that link says what it opens");

  const essayPage = readFileSync("src/app/essay/page.tsx", "utf8");
  assert(essayPage.includes('searchParams.get("session")'),
    "delivery: the essay workspace honours the essay named in the link");
  assert(essayPage.includes('localStorage.setItem("sophira:essay:last-session", requestedSession)'),
    "delivery: opening a delivered essay makes it the one the device reopens next time");

  const store = readFileSync("src/lib/essay/run-store.ts", "utf8");
  assert(store.includes("essay_session_id, progress, request,"),
    "delivery: the run's essay id is a column the store loads, so the link survives a reload");
  assert(store.includes("essay_session_id: run.essay_session_id,"),
    "delivery: and a column it saves");
}
