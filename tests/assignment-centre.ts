import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCentre,
  describeAssignment,
  isNeedsReview,
  isVerified,
  stateTone,
  type AssignmentLite,
  type RunLite,
  type SessionLite,
} from "../src/lib/assignments/centre";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const assignment = (over: Partial<AssignmentLite> & { id: string }): AssignmentLite => ({
  title: `Essay ${over.id}`,
  subject: "Politics",
  status: "active",
  created_at: "2026-11-10T10:00:00.000Z",
  ...over,
});

const run = (over: Partial<RunLite> & { id: string }): RunLite => ({
  assignment_id: "a1",
  state: "completed",
  step_index: 3,
  total_steps: 6,
  final_verification: { status: "VERIFIED", note: "Every claim traced to a source." },
  findings: [],
  last_error: null,
  created_date: "2026-11-15T09:00:00.000Z",
  updated_date: "2026-11-15T10:00:00.000Z",
  ...over,
});

const session = (over: Partial<SessionLite> & { id: string }): SessionLite => ({
  assignment_id: "a1",
  title: "Draft",
  status: "verified",
  final_verification: null,
  created_at: "2026-11-14T09:00:00.000Z",
  updated_at: "2026-11-14T10:00:00.000Z",
  ...over,
});

export function runAssignmentCentreTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
): void {
  /* ---------------------------------------------------------------- */
  section("1. A draft is called checked only when the stored check says VERIFIED (R17 area 6)");
  /* ---------------------------------------------------------------- */
  {
    const verified = describeAssignment(assignment({ id: "a1" }), [run({ id: "r1" })], []);
    assert(verified.checked === true, "centre: a VERIFIED final check makes the draft checked");
    assert(verified.state === "draft-checked" && verified.label === "Draft checked",
      "centre: the chip says Draft checked");

    const needsReview = describeAssignment(
      assignment({ id: "a1" }),
      [run({ id: "r1", final_verification: { status: "NEEDS REVIEW", note: "Two claims are uncited." } })],
      [],
    );
    assert(needsReview.checked === false, "centre: NEEDS REVIEW is not checked");
    assert(needsReview.state === "draft-review" && /did not pass/i.test(needsReview.detail),
      "centre: a draft that needs review says plainly that it did not pass its check");
    assert(needsReview.limitations.includes("Two claims are uncited."),
      "centre: the note explaining the failure is shown, not hidden");

    const unchecked = describeAssignment(
      assignment({ id: "a1" }),
      [run({ id: "r1", final_verification: null })],
      [],
    );
    assert(unchecked.checked === false, "centre: a completed run with no recorded check is never called checked");
    assert(unchecked.state === "draft-unchecked" && unchecked.label === "Draft, not checked",
      "centre: the chip says Draft, not checked");
    assert(/not checked|unchecked/i.test(unchecked.detail), "centre: the sentence says the work is unchecked");

    const missingStatus = describeAssignment(
      assignment({ id: "a1" }),
      [run({ id: "r1", final_verification: { status: null } })],
      [],
    );
    assert(missingStatus.checked === false, "centre: an empty status is not a pass");

    // Case and spacing must not turn a lesser answer into a pass.
    assert(isVerified({ status: " verified " }) === true, "centre: the exact word VERIFIED is accepted whatever its case");
    assert(isVerified({ status: "VERIFIED WITH NOTES" }) === false, "centre: a qualified status is not a pass");
    assert(isVerified({ status: "verified?" }) === false, "centre: a hedged status is not a pass");
    assert(isVerified(null) === false && isVerified(undefined) === false && isVerified({}) === false,
      "centre: nothing stored is not a pass");
    assert(isNeedsReview({ status: "needs review" }) === true && isNeedsReview({ status: "NEEDS  REVIEW" }) === false,
      "centre: only the recorded review status counts, not a near miss");
  }

  /* ---------------------------------------------------------------- */
  section("2. An unfinished run is never described as finished");
  /* ---------------------------------------------------------------- */
  {
    for (const state of ["queued", "analyzing", "planning", "researching", "drafting", "auditing", "verifying"]) {
      const entry = describeAssignment(assignment({ id: "a1" }), [run({ id: "r1", state, final_verification: null })], []);
      assert(entry.state === "preparing", `centre: a run in ${state} is being prepared, not finished`);
      assert(entry.checked === false, `centre: a run in ${state} is never checked`);
      assert(/nothing is finished yet/i.test(entry.detail), `centre: ${state} says plainly that nothing is finished`);
      assert(!/complete|ready|done/i.test(entry.detail), `centre: ${state} avoids finished-sounding words`);
    }
    const stepped = describeAssignment(assignment({ id: "a1" }), [run({ id: "r1", state: "drafting", step_index: 3, total_steps: 6 })], []);
    assert(stepped.step?.index === 3 && stepped.step?.total === 6, "centre: the step is carried through");
    assert(/step 4 of 6/.test(stepped.detail), "centre: the step is shown counting from one, as a person counts");

    const noSteps = describeAssignment(assignment({ id: "a1" }), [run({ id: "r1", state: "drafting", step_index: null, total_steps: null })], []);
    assert(noSteps.step === null, "centre: no progress is invented when the run did not record any");
    assert(!/step/i.test(noSteps.detail), "centre: with no progress recorded, no step is mentioned");

    const zeroTotal = describeAssignment(assignment({ id: "a1" }), [run({ id: "r1", state: "drafting", step_index: 0, total_steps: 0 })], []);
    assert(zeroTotal.step === null, "centre: a zero-step run does not produce 'step 1 of 0'");
  }

  /* ---------------------------------------------------------------- */
  section("3. Stopped is stopped, in the student's words");
  /* ---------------------------------------------------------------- */
  {
    const blocked = describeAssignment(
      assignment({ id: "a1" }),
      [run({ id: "r1", state: "blocked", final_verification: null, last_error: "No AI provider is configured." })],
      [],
    );
    assert(blocked.state === "stopped-needs-you", "centre: a blocked run is filed under what needs the student");
    assert(/needs something from you/i.test(blocked.detail), "centre: a blocked run says it needs the student");
    assert(blocked.detail.includes("No AI provider is configured."), "centre: the recorded reason is shown verbatim");
    assert(blocked.checked === false, "centre: a blocked run is never checked");

    const blockedNoReason = describeAssignment(
      assignment({ id: "a1" }),
      [run({ id: "r1", state: "blocked", final_verification: null, last_error: null })],
      [],
    );
    assert(/needs something from you/i.test(blockedNoReason.detail) && !/null|undefined/.test(blockedNoReason.detail),
      "centre: with no recorded reason the sentence still reads, and never leaks a null");

    const failed = describeAssignment(
      assignment({ id: "a1" }),
      [run({ id: "r1", state: "failed", final_verification: null, last_error: "The provider timed out." })],
      [],
    );
    assert(failed.state === "stopped-failed" && failed.label === "Did not finish", "centre: a failed run says it did not finish");
    assert(failed.detail.includes("The provider timed out."), "centre: the failure reason is shown");

    const cancelled = describeAssignment(
      assignment({ id: "a1" }),
      [run({ id: "r1", state: "cancelled", final_verification: null })],
      [],
    );
    assert(cancelled.state === "cancelled" && /cancelled/i.test(cancelled.detail), "centre: a cancelled run is named as cancelled");
    assert(cancelled.checked === false, "centre: a cancelled run contributes no draft");

    const unknown = describeAssignment(assignment({ id: "a1" }), [run({ id: "r1", state: "teleporting" })], []);
    assert(unknown.state === "stopped-failed" && /does not recognise/i.test(unknown.detail),
      "centre: an unrecognised state is admitted rather than guessed into a friendly one");
    assert(unknown.checked === false, "centre: an unrecognised state never claims a checked draft");
  }

  /* ---------------------------------------------------------------- */
  section("4. The newest run decides, and a stale pass cannot win");
  /* ---------------------------------------------------------------- */
  {
    const entries = describeAssignment(
      assignment({ id: "a1" }),
      [
        run({ id: "old", state: "completed", updated_date: "2026-11-14T10:00:00.000Z" }),
        run({ id: "new", state: "failed", final_verification: null, last_error: "Gave up.", updated_date: "2026-11-16T10:00:00.000Z" }),
      ],
      [],
    );
    assert(entries.run?.id === "new", "centre: the most recently updated run is the one that decides");
    assert(entries.state === "stopped-failed", "centre: a newer failure is not hidden by an older pass");
    assert(entries.checked === false, "centre: an older pass does not make the assignment checked");
    assert(entries.runCount === 2, "centre: every run is counted, so the history is visible");

    const badStamp = describeAssignment(
      assignment({ id: "a1" }),
      [
        run({ id: "good", state: "completed", updated_date: "2026-11-15T10:00:00.000Z" }),
        run({ id: "bad", state: "failed", final_verification: null, updated_date: "not a date" }),
      ],
      [],
    );
    assert(badStamp.run?.id === "good", "centre: a row with an unreadable time sorts last, so it cannot become the newest fact");
    assert(badStamp.checked === true, "centre: a malformed row cannot manufacture a regression");

    const otherAssignment = describeAssignment(
      assignment({ id: "a1" }),
      [run({ id: "r1", assignment_id: "a2", state: "completed" })],
      [session({ id: "s1", assignment_id: "a2" })],
    );
    assert(otherAssignment.state === "not-started", "centre: another assignment's run is never borrowed, even by accident");
    assert(otherAssignment.runCount === 0, "centre: another assignment's run is not counted");
  }

  /* ---------------------------------------------------------------- */
  section("5. An older draft is read for what it records, not for its status column");
  /* ---------------------------------------------------------------- */
  {
    const legacyVerified = describeAssignment(
      assignment({ id: "a1" }),
      [],
      [session({ id: "s1", status: "verified", final_verification: null })],
    );
    assert(legacyVerified.checked === false,
      "centre: a session whose status says 'verified' but which records no check is NOT called checked");
    assert(legacyVerified.state === "draft-unchecked", "centre: it is filed as an unchecked draft");
    assert(/no final check was recorded/i.test(legacyVerified.detail), "centre: the sentence explains why");

    const checkedSession = describeAssignment(
      assignment({ id: "a1" }),
      [],
      [session({ id: "s1", final_verification: { status: "VERIFIED" } })],
    );
    assert(checkedSession.checked === true, "centre: a session that DOES record VERIFIED is checked");
    assert(checkedSession.state === "draft-checked", "centre: and it is filed as a checked draft");

    const noSessionNoRun = describeAssignment(assignment({ id: "a1" }), [], []);
    assert(noSessionNoRun.state === "not-started", "centre: an untouched assignment is not started");
    assert(noSessionNoRun.updated === null, "centre: no activity time is invented");
    assert(/nothing has been prepared/i.test(noSessionNoRun.detail), "centre: the sentence says nothing is prepared");
  }

  /* ---------------------------------------------------------------- */
  section("6. Only recorded limitations are shown, in the student's words");
  /* ---------------------------------------------------------------- */
  {
    const withFindings = describeAssignment(
      assignment({ id: "a1" }),
      [
        run({
          id: "r1",
          findings: [
            { severity: "note", text: "Used the 2019 edition." },
            { severity: "limitation", text: "One source could not be opened." },
            { severity: "limitation", text: "The rubric asked for 1500 words; the draft is 1420." },
          ],
        }),
      ],
      [],
    );
    assert(withFindings.limitations.length === 2, "centre: only limitations are surfaced, not every note");
    assert(withFindings.limitations.includes("One source could not be opened."), "centre: the limitation is shown as written");

    const many = describeAssignment(
      assignment({ id: "a1" }),
      [run({ id: "r1", findings: Array.from({ length: 7 }, (_, i) => ({ severity: "limitation", text: `Limitation ${i}` })) })],
      [],
    );
    assert(many.limitations.length === 3, "centre: at most three limitations are shown, so the row stays readable");

    const emptyText = describeAssignment(
      assignment({ id: "a1" }),
      [run({ id: "r1", final_verification: null, findings: [{ severity: "limitation", text: "   " }] })],
      [],
    );
    assert(emptyText.limitations.length === 0, "centre: a blank limitation is not rendered as an empty bullet");
  }

  /* ---------------------------------------------------------------- */
  section("7. The summary adds up, and never counts what it could not read");
  /* ---------------------------------------------------------------- */
  {
    const centre = buildCentre({
      assignments: [assignment({ id: "a1" }), assignment({ id: "a2" }), assignment({ id: "a3" }), assignment({ id: "a4" })],
      runs: [
        run({ id: "r1", assignment_id: "a1" }),
        run({ id: "r2", assignment_id: "a2", state: "blocked", final_verification: null, last_error: "Needs a key." }),
        run({ id: "r3", assignment_id: "a3", state: "drafting", final_verification: null }),
      ],
      sessions: [],
    });
    assert(centre.summary.total === 4, "centre: every assignment is counted");
    assert(centre.summary.checked === 1, "centre: exactly one draft passed its check");
    assert(centre.summary.needsYou === 1, "centre: the blocked run is counted as needing the student");
    assert(centre.summary.preparing === 1, "centre: the unfinished run is counted as preparing");
    assert(centre.summary.notStarted === 1, "centre: the untouched assignment is counted as not started");
    assert(centre.summary.incomplete === false, "centre: a complete set of reads is not called incomplete");
    assert(centre.summary.ready === 1, "centre: only the checked draft counts as ready");
    assert(/Across 4 assignments/.test(centre.headline), "centre: the headline states the total");
    assert(/1 needs you/.test(centre.headline), "centre: the headline names the work that needs the student");
    assert(/1 checked against the brief/.test(centre.headline), "centre: the headline names the checked draft");
    assert(!/all/i.test(centre.headline), "centre: a partly finished workspace is never summarised as all done");

    const empty = buildCentre({ assignments: [], runs: [], sessions: [] });
    assert(empty.summary.total === 0 && /no assignments yet/i.test(empty.headline),
      "centre: an empty workspace says so plainly");
    assert(empty.summary.incomplete === false, "centre: an empty workspace is not an unreadable one");
  }

  /* ---------------------------------------------------------------- */
  section("8. A failed read is said out loud, never shown as zero");
  /* ---------------------------------------------------------------- */
  {
    const noAssignments = buildCentre({ assignments: null, runs: [], sessions: [] });
    assert(noAssignments.summary.incomplete === true, "centre: an unreadable assignment list makes the picture incomplete");
    assert(/could not be read/i.test(noAssignments.headline), "centre: the headline says part of it could not be read");
    assert(/Nothing has been deleted/.test(noAssignments.headline), "centre: it reassures in the same breath, without claiming more");
    assert(noAssignments.summary.total === 0 && noAssignments.entries.length === 0,
      "centre: nothing is claimed from a list that could not be read");

    const noRuns = buildCentre({ assignments: [assignment({ id: "a1" })], runs: null, sessions: [] });
    assert(noRuns.summary.incomplete === true, "centre: unreadable runs make the picture incomplete");
    assert(noRuns.summary.notStarted === 0, "centre: an unreadable run list is not turned into 'nothing started'");
    assert(noRuns.summary.preparing === 0 && noRuns.summary.checked === 0, "centre: no work is counted from an unreadable run list");
    assert(/could not be read/i.test(noRuns.headline), "centre: the headline says so");

    const noSessions = buildCentre({ assignments: [assignment({ id: "a1" })], runs: [run({ id: "r1" })], sessions: null });
    assert(noSessions.summary.incomplete === true && noSessions.summary.checked === 1,
      "centre: a readable run still counts, while the headline admits the drafts could not be read");
    assert(/could not be read/i.test(noSessions.headline), "centre: the incompleteness is not hidden by a good number");
  }

  /* ---------------------------------------------------------------- */
  section("9. What needs the student comes first, then the freshest work");
  /* ---------------------------------------------------------------- */
  {
    const centre = buildCentre({
      assignments: [assignment({ id: "a1" }), assignment({ id: "a2" }), assignment({ id: "a3" })],
      runs: [
        run({ id: "r1", assignment_id: "a1", state: "completed", final_verification: { status: "VERIFIED" }, updated_date: "2026-11-16T09:00:00.000Z" }),
        run({ id: "r2", assignment_id: "a2", state: "blocked", final_verification: null, updated_date: "2026-11-14T09:00:00.000Z" }),
        run({ id: "r3", assignment_id: "a3", state: "completed", final_verification: { status: "NEEDS REVIEW" }, updated_date: "2026-11-15T09:00:00.000Z" }),
      ],
      sessions: [],
    });
    assert(centre.entries[0].assignment.id === "a2", "centre: a blocked run outranks everything, even fresher work");
    assert(centre.entries[1].assignment.id === "a3", "centre: a draft awaiting review comes next");
    assert(centre.entries[2].assignment.id === "a1", "centre: a checked draft is comfortable, so it sits last of these");
    assert(centre.needsYou.length === 2 && centre.readyToOpen.length === 1,
      "centre: the needs-you and ready groups are split without overlap");
    assert(centre.preparing.length === 0 && centre.untouched.length === 0, "centre: nothing is filed in the wrong group");

    const tones = ["draft-checked", "draft-review", "stopped-failed", "preparing", "not-started"] as const;
    assert(tones.map(stateTone).join(",") === "success,warn,danger,accent,neutral",
      "centre: each state keeps one tone, so the colour cannot be chosen per page");
  }

  /* ---------------------------------------------------------------- */
  section("10. The screen reads real rows, with no admin client and no widened access");
  /* ---------------------------------------------------------------- */
  {
    const page = read("src/app/assignments/page.tsx");
    assert(/from\("assignment_runs"\)/.test(page) && /from\("essay_sessions"\)/.test(page) && /from\("assignments"\)/.test(page),
      "assignment centre: it reads assignments, runs and drafts from the tables themselves");
    assert(!/createAdminClient|createServiceClient|service_role/.test(page),
      "assignment centre: the student's own client reads it, so row-level security still decides");
    assert(/\.eq\("user_id", user\.id\)/.test(page), "assignment centre: every read is filtered to the signed-in student as well");
    assert(/buildCentre\(/.test(page), "assignment centre: the words come from the tested module, not from markup");
    assert(/needsDatabaseUpdate\(/.test(page), "assignment centre: a missing table says so instead of showing an empty list");
    assert(/requireUser\(/.test(page), "assignment centre: a signed-out visitor is sent to sign in");

    const nav = read("src/lib/navigation/workspace-nav.ts");
    assert(/href: "\/assignments", label: "Assignments"/.test(nav), "navigation: the centre has a menu entry a student can find");

    const spec = read("src/lib/governance/product-spec.ts");
    assert(spec.includes("src/lib/assignments/centre.ts"),
      "product spec: R17 area 6 cites the file that implements it");
  }
}
