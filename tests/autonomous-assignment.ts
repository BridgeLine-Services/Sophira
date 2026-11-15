/**
 * AUTONOMOUS ASSIGNMENT RUNS (directive 2026-11-15, Parts 4, 11, 13).
 *
 * These assertions defend the two things that are easy to fake and hard to prove:
 *
 *  1. NO FALSE COMPLETION. A run may not be called finished until every section's text is
 *     stored and a verdict is stored, and a "completed" state cannot be produced by submitting
 *     a request.
 *  2. NO REGRESSION. The manual workflow — plan, outline approval, one section per call — still
 *     exists, still refuses to draft before approval, and its routes are untouched.
 *
 * They are offline: no database, no provider, no clock. Time is injected everywhere.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  applyStep,
  blockRun,
  buildPlanMessages,
  buildSectionMessages,
  buildVerificationMessages,
  canClaimCompletion,
  canRetry,
  cancelRun,
  completionClaim,
  continuationMode,
  draftedSections,
  estimateTotalSteps,
  failRun,
  feasibility,
  idempotencyKey,
  isResumable,
  isTerminal,
  leaseDecision,
  leaseExpiry,
  MAX_OUTLINE_SECTIONS,
  newRun,
  nextAction,
  planFindings,
  retryRun,
  runProgress,
  RUN_STATES,
  runView,
  sectionEvidence,
  sectionsMissingAudits,
  splitDraftAndAudits,
  type RunRecord,
  type RunSection,
} from "../src/lib/essay/autonomous";
import {
  REQUIREMENT_STATUSES,
  PRODUCT_REQUIREMENTS,
  HISTORICAL_DECISIONS,
  agentDecisions,
  hasEvidence,
} from "../src/lib/governance/product-spec";
import { FLAG_KEYS, FLAGS, flagDisabledMessage, flagEnabled, flagStates } from "../src/lib/features/flags";
import { EXPORT_FORMATS, exportFilename, isExportFormat, renderExport } from "../src/lib/essay/export";
import { changeSummary, changesIn, recentChanges, silentCategories } from "../src/lib/owner/change-log";
import { CHANGE_CATEGORIES, CHANGE_CATEGORY_LABELS } from "../src/lib/governance/product-spec";

const ROOT = join(__dirname, "..", "..");
type Check = (condition: boolean, message: string) => void;

const NOW = Date.parse("2026-11-15T12:00:00Z");

function baseRun(overrides: Partial<RunRecord> = {}): RunRecord {
  const run = newRun({ id: "run-1", userId: "user-1", request: { question: "Was the New Deal successful?", genre: "Essay" }, nowMs: NOW });
  return { ...run, ...overrides };
}

/** A run that has been planned with three sections. */
function plannedRun(): RunRecord {
  const run = baseRun({
    context: {
      course: "US History", teacher: "Ms Abbott", academicLevel: "High school",
      rubricCriteria: 2, teacherRequirements: 1, approvedSources: 0,
      memoriesUsed: 2, patternsUsed: 1, writingContext: "academic", degraded: [],
    },
  });
  const outline = [
    { id: "s1", title: "Introduction", points: ["frame"], evidenceLabels: [], targetWords: 120 },
    { id: "s2", title: "Body", points: ["argument"], evidenceLabels: [], targetWords: 200 },
    { id: "s3", title: "Conclusion", points: ["close"], evidenceLabels: [], targetWords: 120 },
  ];
  const plan = {
    title: "New Deal", genre: "Essay", academicLevel: "High school", wordTarget: 440,
    analysis: { assignmentType: "argument", keyRequirements: ["thesis"], constraints: [] },
    rubric: [], teacherRequirements: [], sources: [], evidenceMap: [], thesis: "The New Deal partly succeeded.",
    outline,
  };
  return {
    ...run,
    state: "drafting",
    outline_approved: true,
    plan,
    outline,
    total_steps: estimateTotalSteps({ ...run, outline }),
    sections: outline.map((o) => ({ id: o.id, title: o.title, draft: null, audits: null })),
  };
}

const AUDITS = { citation: "no citations used", rubric: "covers the thesis", style: "consistent voice" };

function fullyDrafted(): RunRecord {
  const run = plannedRun();
  return {
    ...run,
    sections: run.sections.map((s) => ({ ...s, draft: `Text for ${s.id}.`, audits: AUDITS })),
    final_verification: { status: "VERIFIED", note: "supports the thesis" },
  };
}

export function runAutonomousAssignmentTests(assert: Check, section: (title: string) => void): void {
  /* ---------------------------------------------------------------- */
  section("Autonomous runs — the state machine cannot claim work it did not do");
  /* ---------------------------------------------------------------- */

  assert(RUN_STATES.length === 11, `every state the directive names exists (found ${RUN_STATES.length})`);
  for (const state of ["queued", "analyzing", "planning", "researching", "drafting", "auditing", "verifying", "completed", "blocked", "failed", "cancelled"]) {
    assert((RUN_STATES as readonly string[]).includes(state), `state ${state} is part of the machine`);
  }
  assert(isTerminal("completed") && isTerminal("blocked") && isTerminal("failed") && isTerminal("cancelled"), "completed/blocked/failed/cancelled are terminal");
  assert(!isTerminal("drafting") && isResumable("drafting"), "drafting is resumable, so a crash can be recovered");
  assert(!isResumable("blocked"), "a blocked run is not swept up automatically");

  const fresh = baseRun();
  assert(fresh.state === "queued", "a new run starts queued");
  assert(fresh.completion_claim === null, "a new run makes no completion claim");
  assert(canClaimCompletion(fresh).allowed === false, "a new run cannot be called complete");

  const first = nextAction(fresh);
  assert(first.kind === "capture_context", "the first step reads the student's own records");
  assert(first.state === "analyzing", "and it is reported as analysing, not as planning");

  const captured = applyStep(fresh, first, {
    context: { course: "C", teacher: "T", academicLevel: "High school", rubricCriteria: 0, teacherRequirements: 0, approvedSources: 0, memoriesUsed: 0, patternsUsed: 0, writingContext: null, degraded: [] },
  }, NOW);
  assert(captured.state === "planning", "after context, the next state is planning");
  assert(nextAction(captured).kind === "build_plan", "the next step builds the plan");

  // A plan step that returns nothing must NOT be recorded as a plan.
  const emptyPlan = applyStep(captured, nextAction(captured), { plan: null, outline: [] }, NOW);
  assert(emptyPlan.plan === null, "an empty plan result does not become a plan");
  assert(emptyPlan.state !== "drafting", "and the run does not move to drafting");
  assert(emptyPlan.attempt === captured.attempt + 1, "the failed attempt is counted, so retries are bounded");
  assert(emptyPlan.last_error !== null, "the failure reason is stored for the student");

  const planned = applyStep(captured, nextAction(captured), {
    plan: {
      title: "T", genre: "Essay", academicLevel: "High school", wordTarget: 400,
      analysis: { assignmentType: "argument", keyRequirements: [], constraints: [] },
      rubric: [], teacherRequirements: [], sources: [], evidenceMap: [], thesis: "X",
      outline: [
        { id: "s1", title: "One", points: [], evidenceLabels: [], targetWords: 100 },
        { id: "s2", title: "Two", points: [], evidenceLabels: [], targetWords: 100 },
      ],
    },
    outline: [
      { id: "s1", title: "One", points: [], evidenceLabels: [], targetWords: 100 },
      { id: "s2", title: "Two", points: [], evidenceLabels: [], targetWords: 100 },
    ],
  }, NOW);
  assert(planned.state === "drafting", "a usable plan moves the run to drafting");
  assert(planned.sections.length === 2, "one section record exists per outline section");
  assert(planned.sections.every((s) => s.draft === null), "planning does not pretend a section is drafted");
  assert(planned.outline_approved === true, "the chosen mode authorizes drafting; the manual gate is a different route");
  assert(planned.total_steps === estimateTotalSteps(planned), "the step total is computed from the real outline");

  // Sections are drafted in order, one per step.
  assert(nextAction(planned).kind === "draft_section", "the next step drafts a section");
  const firstSection = nextAction(planned);
  assert(firstSection.kind === "draft_section" && firstSection.sectionId === "s1", "sections are drafted in outline order");

  // An empty section response is never stored as a draft.
  const emptyDraft = applyStep(planned, firstSection, { sections: [{ id: "s1", title: "One", draft: "   ", audits: null }] }, NOW);
  assert(draftedSections(emptyDraft).length === 0, "whitespace is not a drafted section");
  assert(emptyDraft.attempt === 1, "the empty result is counted as a failed attempt");

  const oneDraft = applyStep(planned, firstSection, { sections: [{ id: "s1", title: "One", draft: "Real text.", audits: AUDITS }] }, NOW);
  assert(draftedSections(oneDraft).length === 1, "a real section is stored");
  assert(nextAction(oneDraft).kind === "draft_section", "the run continues to the next section");

  // Missing audit notes are detected, not assumed.
  const noAudits: RunSection[] = [{ id: "s1", title: "One", draft: "Text.", audits: null }];
  const auditless = { ...planned, sections: noAudits };
  assert(sectionsMissingAudits(auditless).join() === "s1", "a section without audit notes is listed");
  assert(nextAction(auditless).kind === "audit_sections", "the machine asks for the missing audit notes");

  /* ---------------------------------------------------------------- */
  section("Autonomous runs — completion is gated on stored text and a stored verdict");
  /* ---------------------------------------------------------------- */

  // Everything drafted but never verified: NOT complete.
  const unverified = { ...fullyDrafted(), final_verification: null };
  assert(canClaimCompletion(unverified).allowed === false, "drafted sections without a verdict are not complete");
  const gateReason = canClaimCompletion(unverified);
  assert(gateReason.allowed === false && /verification/i.test(gateReason.reason), "and the refusal says verification is missing");
  assert(completionClaim(unverified) === null, "no completion sentence exists before verification");

  // A missing section: NOT complete, and the refusal names it.
  const missingOne = { ...fullyDrafted(), sections: fullyDrafted().sections.map((s, i) => (i === 1 ? { ...s, draft: null } : s)) };
  const missingReason = canClaimCompletion(missingOne);
  assert(missingReason.allowed === false && /s2/.test(missingReason.reason), "the refusal names the section with no text");

  // The complete run is complete — and says what the check actually found.
  const verified = fullyDrafted();
  const done: RunRecord = {
    ...verified,
    state: "completed",
    completion_claim: completionClaim(verified),
    finished_at: new Date(NOW).toISOString(),
  };
  assert(canClaimCompletion(done).allowed === true, "a fully drafted and verified run may be called complete");
  const claim = completionClaim(done)!;
  assert(/3 of 3 sections/.test(claim), "the claim states how many sections exist");
  assert(/VERIFIED/.test(claim), "the claim repeats the verdict rather than smoothing it over");
  assert(/draft/i.test(claim), "the claim says it is a draft for the student");

  // NEEDS REVIEW is a real result, and it is reported as one, not hidden.
  const needsReview = { ...fullyDrafted(), final_verification: { status: "NEEDS REVIEW" as const, note: "the second source is not quoted" } };
  assert(canClaimCompletion(needsReview).allowed === true, "a NEEDS REVIEW run still produced a real document");
  const reviewClaim = completionClaim(needsReview)!;
  assert(/NEEDS REVIEW/.test(reviewClaim), "the NEEDS REVIEW verdict is stated plainly");
  assert(/second source is not quoted/.test(reviewClaim), "and the verifier's own note is carried through");

  // A "complete" step with missing data cannot write completed.
  const forced = applyStep({ ...planned, sections: [] }, { kind: "complete", state: "completed" }, {}, NOW);
  assert(forced.state !== "completed", "the machine refuses to complete a run with no stored sections");
  assert(forced.state === "blocked", "it blocks with a reason instead");
  assert(forced.last_error !== null, "and the reason is recorded");

  /* ---------------------------------------------------------------- */
  section("Autonomous runs — one writer, safe retries, resumable steps");
  /* ---------------------------------------------------------------- */

  const held = { ...planned, lease_token: "worker-a", lease_expires_at: new Date(NOW + 60_000).toISOString() };
  assert(leaseDecision(held, NOW, "worker-b").allowed === false, "a held lease refuses a second worker");
  assert(/right now/.test(leaseDecision(held, NOW, "worker-b").reason), "and says why, in plain words");
  assert(leaseDecision(held, NOW, "worker-a").allowed === true, "the holder may continue");

  const expired = { ...planned, lease_token: "worker-a", lease_expires_at: new Date(NOW - 1000).toISOString() };
  assert(leaseDecision(expired, NOW, "worker-b").allowed === true, "an expired lease may be taken over");
  assert(/resumed/.test(leaseDecision(expired, NOW, "worker-b").reason), "the takeover is described as a resume");

  const free = { ...planned, lease_token: null, lease_expires_at: null };
  assert(leaseDecision(free, NOW, "worker-b").allowed === true, "an unheld run may be advanced");
  assert(Date.parse(leaseExpiry(NOW)) === NOW + 120_000, "a lease lasts two minutes, not forever");

  // Idempotency: a step that already produced output is skipped, never repeated.
  const halfway = applyStep(planned, nextAction(planned), { sections: [{ id: "s1", title: "One", draft: "Text.", audits: AUDITS }] }, NOW);
  const resumed = applyStep(halfway, nextAction(halfway), { sections: [{ id: "s2", title: "Two", draft: "More.", audits: AUDITS }] }, NOW);
  assert(draftedSections(resumed).length === 2, "resuming continues from the first missing section");
  assert(resumed.sections[0].draft === "Text.", "a resumed step never overwrites an earlier section");
  assert(nextAction(fullyDrafted()).kind === "complete", "a fully drafted run's next action is to complete, not to draft again");

  // Retry resumes the same record instead of creating a second one.
  const failed = failRun(planned, "provider timed out", NOW);
  assert(failed.state === "failed" && failed.lease_token === null, "a failed run releases its lease");
  assert(canRetry(failed), "a failed run can be retried");
  const retried = retryRun(failed, NOW + 5000);
  assert(retried.id === planned.id, "the retry is the SAME run, so no duplicate artifact is created");
  assert(retried.state === "queued" && retried.attempt === 0, "the retry is queued with a fresh attempt budget");

  // Cancelling keeps completed sections.
  const partial = applyStep(planned, nextAction(planned), { sections: [{ id: "s1", title: "One", draft: "Kept.", audits: AUDITS }] }, NOW);
  const cancelled = cancelRun(partial, NOW);
  assert(cancelled.state === "cancelled" && cancelled.cancelled_at !== null, "cancelling records when it happened");
  assert(draftedSections(cancelled).length === 1, "cancelling does not erase a section the student already has");
  assert(nextAction(cancelled).kind === "none", "a cancelled run has nothing left to do");
  assert(cancelRun(cancelled, NOW) === cancelled, "cancelling twice is a no-op");

  // Blocking is honest and single-reason.
  const blocked = blockRun(planned, "No approved, verified sources are attached.", NOW);
  assert(blocked.state === "blocked", "a run can be blocked");
  assert(/approved, verified sources/.test(blocked.last_error ?? ""), "the block reason is the real one, not a generic error");

  /* ---------------------------------------------------------------- */
  section("Autonomous runs — deadline feasibility is an estimate, labelled as one");
  /* ---------------------------------------------------------------- */

  const noDeadline = feasibility(planned, NOW);
  assert(noDeadline.feasible === true && noDeadline.secondsUntilDeadline === null, "no deadline means nothing to be late for");

  const tight = feasibility({ ...planned, deadline: new Date(NOW + 30_000).toISOString() }, NOW);
  assert(tight.feasible === false, "a deadline closer than the work is honestly infeasible");
  assert(/cannot be finished in time/.test(tight.verdict), "and it says so in words");
  assert(tight.remainingSteps > 0, "the estimate names how much work remains");

  const roomy = feasibility({ ...planned, deadline: new Date(NOW + 3_600_000).toISOString() }, NOW);
  assert(roomy.feasible === true, "an hour is enough for this run");

  const unreadable = feasibility({ ...planned, deadline: "not a date" }, NOW);
  assert(unreadable.feasible === false, "an unreadable deadline is not treated as no deadline");
  assert(/could not be read/.test(unreadable.verdict), "and the student is told why");

  /* ---------------------------------------------------------------- */
  section("Autonomous runs — continuation is reported, never invented");
  /* ---------------------------------------------------------------- */

  const open = continuationMode({});
  assert(open.mode === "on_open", "with no scheduler configured, the mode is on_open");
  assert(/does not keep generating while the application is closed/.test(open.detail), "and it says exactly that");
  const scheduled = continuationMode({ SOPHIRA_AUTONOMOUS_SCHEDULE: "1", CRON_SECRET: "0123456789abcdef0123" });
  assert(scheduled.mode === "scheduled", "a configured scheduler and secret report scheduled");
  const halfConfigured = continuationMode({ SOPHIRA_AUTONOMOUS_SCHEDULE: "1" });
  assert(halfConfigured.mode === "on_open", "a schedule flag without a secret is NOT scheduled, because nothing could authenticate");
  const shortSecret = continuationMode({ SOPHIRA_AUTONOMOUS_SCHEDULE: "1", CRON_SECRET: "short" });
  assert(shortSecret.mode === "on_open", "a too-short secret is not a configured worker");

  /* ---------------------------------------------------------------- */
  section("Autonomous runs — progress and the client view");
  /* ---------------------------------------------------------------- */

  const queuedProgress = runProgress(baseRun());
  assert(queuedProgress.percent === 0 && queuedProgress.measured === false, "a queued run shows 0% and admits it is not measured");
  const halfProgress = runProgress(halfway);
  assert(halfProgress.percent > 0 && halfProgress.percent < 100, "a half-drafted run is between 0 and 100");
  assert(halfProgress.drafted === 1 && halfProgress.total === halfway.outline.length, "progress counts stored drafts against the outline");
  const doneProgress = runProgress({ ...done, state: "completed", completion_claim: claim });
  assert(doneProgress.percent === 100, "a completed run reads 100%");
  assert(runProgress({ ...done, state: "verifying", final_verification: null }).percent <= 99, "an unfinished run never reads 100%");

  const view = runView(done, NOW, {});
  assert(view.state === "completed", "the view carries the state");
  assert(view.completionClaim !== null, "the view carries the completion sentence when it exists");
  assert(view.continuation.mode === "on_open", "the view tells the student the continuation mode");
  assert(view.feasibility !== null, "the view carries feasibility");
  const blockedView = runView({ ...planned, state: "blocked", last_error: "no sources" }, NOW, {});
  assert(blockedView.completionClaim === null, "a blocked run's view has no completion sentence");
  assert(blockedView.canRetry === true, "and it offers a retry");

  /* ---------------------------------------------------------------- */
  section("Autonomous runs — prompts keep the integrity rules");
  /* ---------------------------------------------------------------- */

  const planMessages = buildPlanMessages({
    title: "T", question: "Q", genre: "Essay", academicLevel: "High school",
    sources: [{ label: "S1", title: "Source", url: "https://example.com" }],
    teacherRequirements: ["Use MLA"], rubric: [{ criterion: "Thesis", points: 10 }],
    academicContext: ["ORDER OF AUTHORITY: teacher beats student habit"],
  });
  const planText = planMessages.map((m) => m.content).join("\n");
  assert(/planning ONLY/.test(planText), "the planner is told not to draft");
  assert(/ORDER OF AUTHORITY/.test(planText), "the precedent order reaches the planner");
  assert(/S1/.test(planText), "attached sources reach the planner");
  assert(/Use MLA/.test(planText), "teacher requirements reach the planner");

  const sectionMessages = buildSectionMessages({
    section: { id: "s1", title: "Introduction", points: ["frame"], evidenceLabels: [], targetWords: 100 },
    plan: { ...plannedRun().plan! },
    priorDrafts: [{ id: "s0", draft: "Earlier text" }],
    academicContext: [],
    wrap: (label, body) => `<<${label}>>${body}<</${label}>>`,
  });
  const sectionText = sectionMessages.map((m) => m.content).join("\n");
  assert(/ONE section/.test(sectionText), "the drafter writes one section only");
  assert(/Never invent quotations/.test(sectionText), "the no-fabrication rule is stated");
  assert(/after the section text, output JSON/i.test(sectionText), "the audit notes are requested with the text");
  assert(/Earlier text/.test(sectionText), "prior sections are supplied as context");

  const evidenceSection = buildSectionMessages({
    section: { id: "s2", title: "Body", points: [], evidenceLabels: ["S1"], targetWords: 100 },
    plan: {
      ...plannedRun().plan!,
      sources: [{ label: "S1", title: "Source", url: "", approved: true }],
      evidenceMap: [{ label: "S1", claim: "a claim", sourceTitle: "Source", sourceUrl: "", passage: "the passage" }],
    },
    priorDrafts: [], academicContext: [], wrap: (l, b) => `<<${l}>>${b}<</${l}>>`,
  }).map((m) => m.content).join("\n");
  assert(/the passage/.test(evidenceSection), "attached evidence reaches the section prompt");
  assert(/untrusted source content/.test(evidenceSection), "and evidence is marked as untrusted data");

  const verification = buildVerificationMessages({ plan: plannedRun().plan, outline: plannedRun().outline, assembled: "Essay text" }).map((m) => m.content).join("\n");
  assert(/verifier, not an editor/.test(verification), "the final check is a verifier, not an editor");
  assert(/NEEDS REVIEW/.test(verification), "and it is told to be strict");
  assert(/Essay text/.test(verification), "the assembled document is what gets checked");

  // Evidence is filtered to the section's own labels — never the whole map.
  const mapped = sectionEvidence(
    { ...plannedRun().plan!, evidenceMap: [
      { label: "S1", claim: "c1", sourceTitle: "A", sourceUrl: "", passage: "p1" },
      { label: "S2", claim: "c2", sourceTitle: "B", sourceUrl: "", passage: "p2" },
    ] },
    { id: "s1", title: "One", points: [], evidenceLabels: ["S1"], targetWords: 100 },
  );
  assert(mapped.length === 1 && mapped[0].label === "S1", "a section only receives the evidence mapped to it");

  // A draft with an unparseable audit tail keeps its text.
  const split = splitDraftAndAudits('Real prose here.\n{"citation":"none","rubric":"covers","style":"consistent"}');
  assert(split.text === "Real prose here.", "the section text is separated from the audit JSON");
  assert(split.audits.citation === "none", "the audit notes are read when present");
  const broken = splitDraftAndAudits("Prose with no JSON at all.");
  assert(broken.text === "Prose with no JSON at all.", "text without audit JSON is kept as text");
  assert(/No citation note/.test(broken.audits.citation), "and a missing note is admitted, not invented");

  assert(MAX_OUTLINE_SECTIONS === 8, "the outline cap matches the manual planner");
  assert(estimateTotalSteps(plannedRun()) === 2 + 3 + 1 + 1, "the step estimate counts context, plan, sections, audits and verification");

  const findings = planFindings({ hasRubric: false, teacherRequirements: 0, approvedSources: 0, wantsResearch: true });
  assert(findings.length === 3, "an unrubriced, teacher-less, source-less research run records three limitations");
  assert(findings.some((f) => f.severity === "limitation"), "an unresearched research essay is a limitation, not a note");
  assert(planFindings({ hasRubric: true, teacherRequirements: 2, approvedSources: 3, wantsResearch: true }).length === 0, "a fully specified run adds no noise");

  // Duplicate-run prevention is deterministic and request-specific.
  const keyA = idempotencyKey({ question: "Was the New Deal successful?", assignmentId: "a1" });
  const keyB = idempotencyKey({ question: "  was the  new deal successful? ", assignmentId: "a1" });
  const keyC = idempotencyKey({ question: "Was the New Deal successful?", assignmentId: "a2" });
  assert(keyA === keyB, "the same request produces the same key, so a second click cannot start a second run");
  assert(keyA !== keyC, "a different assignment produces a different key");

  /* ---------------------------------------------------------------- */
  section("Autonomous runs — the routes enforce security and the flag");
  /* ---------------------------------------------------------------- */

  const startRoute = readFileSync(join(ROOT, "src/app/api/essay/autonomous/route.ts"), "utf8");
  const advanceRoute = readFileSync(join(ROOT, "src/app/api/essay/autonomous/[id]/advance/route.ts"), "utf8");
  const statusRoute = readFileSync(join(ROOT, "src/app/api/essay/autonomous/[id]/route.ts"), "utf8");
  const cancelRoute = readFileSync(join(ROOT, "src/app/api/essay/autonomous/[id]/cancel/route.ts"), "utf8");
  const tickRoute = readFileSync(join(ROOT, "src/app/api/essay/autonomous/tick/route.ts"), "utf8");

  for (const [name, source] of Object.entries({ startRoute, advanceRoute, statusRoute, cancelRoute })) {
    assert(/requireUser\(supabase\)/.test(source), `${name} uses the existing authentication guard`);
    assert(/guard\.ok/.test(source), `${name} refuses an unauthenticated caller`);
    assert(!/createAdminClient/.test(source), `${name} does NOT use the service-role client`);
    assert(/user\.id|guard\.data\.user\.id/.test(source), `${name} scopes work to the signed-in user`);
  }
  assert(/flagEnabled\("autonomous_essay"\)/.test(startRoute), "starting a run requires the feature flag");
  assert(/flagEnabled\("autonomous_essay"\)/.test(advanceRoute), "advancing a run requires the feature flag");
  assert(/flagDisabledMessage\("autonomous_essay"\)/.test(startRoute), "and a disabled flag returns the plain message, not a crash");
  assert(/not in your list/.test(startRoute), "a course or teacher that is not the student's is refused before a run exists");
  assert(/Not authorized/.test(tickRoute), "the scheduled sweep refuses an unauthenticated caller");
  assert(/CRON_SECRET/.test(tickRoute), "the sweep is authenticated by a secret");
  assert(/resumableRuns/.test(tickRoute), "the sweep only advances runs that are live and unheld");
  assert(/candidate\.user_id/.test(tickRoute), "the sweep passes the run's own owner, so ownership is checked again inside");
  assert(/status: 201/.test(startRoute), "a new run is a 201");
  assert(/duplicate: true/.test(startRoute), "a repeat request reports the existing run instead of starting a second");

  /* ---------------------------------------------------------------- */
  section("Autonomous runs — the migration is additive, owned and indexed");
  /* ---------------------------------------------------------------- */

  const migration = readFileSync(join(ROOT, "supabase/migrations/0059_assignment_runs.sql"), "utf8");
  assert(/create table if not exists public\.assignment_runs/.test(migration), "the new table is created additively");
  assert(/enable row level security/.test(migration), "row level security is enabled on the new table");
  assert(/for select using \(auth\.uid\(\) = user_id\)/.test(migration), "members read only their own runs");
  assert(/for insert with check \(auth\.uid\(\) = user_id\)/.test(migration), "members insert only their own runs");
  assert(/for update using \(auth\.uid\(\) = user_id\)/.test(migration), "members update only their own runs");
  assert(/assignment_runs_one_live_per_key/.test(migration), "a duplicate live run is prevented by a unique index");
  assert(/where state <> 'cancelled' and state <> 'failed'/.test(migration), "a cancelled or failed run does not block a legitimate retry");
  assert(/assignment_runs_resumable/.test(migration), "the sweep has an index for what it looks for");
  assert(!/drop table/i.test(migration), "the migration drops no table");
  assert(!/alter table .* drop column/i.test(migration), "the migration drops no column");
  assert(!/drop policy/i.test(migration.replace(/drop policy if exists "[^"]+" on public\.assignment_runs;/g, "")), "no policy outside the new table is touched");
  assert(/check \(state in \(/.test(migration), "the state column is constrained to the machine's states");

  const migrationFiles = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
  assert(migrationFiles[migrationFiles.length - 1] === "0059_assignment_runs.sql", "0059 is the newest migration");
  assert(migrationFiles.length === 59, `the chain is 59 migrations (found ${migrationFiles.length})`);
  assert(migrationFiles.includes("0058_writing_profile_contexts.sql"), "the previous chain end is untouched");

  const markers = readFileSync(join(ROOT, "scripts/migration-markers.mjs"), "utf8");
  assert(/"0059_assignment_runs\.sql"/.test(markers), "the mandatory marker for 0059 exists, so CI can prove it applied");

  /* ---------------------------------------------------------------- */
  section("Autonomous runs — zero regression on the manual workflow");
  /* ---------------------------------------------------------------- */

  const planRoute = readFileSync(join(ROOT, "src/app/api/essay/plan/route.ts"), "utf8");
  const draftRoute = readFileSync(join(ROOT, "src/app/api/essay/draft-section/route.ts"), "utf8");
  const sectionsRoute = readFileSync(join(ROOT, "src/app/api/essay/sections/route.ts"), "utf8");

  assert(existsSync(join(ROOT, "src/app/api/essay/plan/route.ts")), "the manual plan route still exists at its original path");
  assert(existsSync(join(ROOT, "src/app/api/essay/draft-section/route.ts")), "the manual drafting route still exists at its original path");
  assert(existsSync(join(ROOT, "src/app/api/essay/sections/route.ts")), "the sections route still exists");
  assert(/export async function POST/.test(planRoute) && /export async function GET/.test(planRoute), "the plan route keeps POST and GET");
  assert(/awaiting_outline_approval/.test(planRoute), "the plan route still parks a session awaiting outline approval");
  assert(/canDraft\(state\)/.test(draftRoute), "the drafting route still enforces the outline gate");
  assert(/nextSectionToDraft\(state\)/.test(draftRoute), "and still drafts exactly one section per call");
  assert(/outline_approved === true/.test(draftRoute), "the gate still reads the stored approval, not a client claim");
  assert(!/assignment_runs/.test(planRoute) && !/assignment_runs/.test(draftRoute), "the manual routes were not rewired onto the new table");
  assert(!/autonomous/.test(planRoute) && !/autonomous/.test(draftRoute), "the manual routes do not depend on the new mode");
  assert(/requireUser\(supabase\)/.test(sectionsRoute), "the sections route keeps its guard");

  /* ---------------------------------------------------------------- */
  section("Product governance — the Owner's specification is the source of truth");
  /* ---------------------------------------------------------------- */

  const doc = readFileSync(join(ROOT, "docs/PRODUCT_REQUIREMENTS.md"), "utf8");
  assert(/This document is the authoritative product specification/i.test(doc), "the specification says it is authoritative");
  assert(/The Owner is the authority/i.test(doc), "and names the Owner as the authority");
  assert(PRODUCT_REQUIREMENTS.length >= 16, `the requirement registry is populated (${PRODUCT_REQUIREMENTS.length})`);
  for (const req of PRODUCT_REQUIREMENTS) {
    assert(doc.includes(`${req.id} —`), `${req.id} appears in the document, so code and document cannot drift`);
    assert((REQUIREMENT_STATUSES as readonly string[]).includes(req.status), `${req.id} uses an agreed status word (${req.status})`);
    assert(hasEvidence(req), `${req.id} carries named evidence, not a claim`);
  }
  for (const d of HISTORICAL_DECISIONS) {
    assert(d.madeBy.length > 0, `${d.id} records who actually made the decision`);
    assert(d.recordedIn.length > 0, `${d.id} records where the reasoning is kept`);
  }
  assert(agentDecisions().length >= 2, "the earlier agent decisions are kept as history rather than deleted");
  assert(agentDecisions().every((d) => d.reclassified !== null), "and each is marked as reclassified, with the date");
  assert(/integrity boundary/i.test(doc), "the specification separates an integrity boundary from a product decision");
  const writingDoc = readFileSync(join(ROOT, "docs/WRITING_PROFILE_LEARNING.md"), "utf8");
  assert(!/Do not rebuild it\./.test(writingDoc), "the standing 'do not rebuild it' instruction is gone");
  assert(/Reclassified 2026-11-15/.test(writingDoc), "the reclassification is dated in the historical record");
  assert(/What was declined, and why/.test(writingDoc) || /historical implementation decision/i.test(writingDoc), "the reasoning is still preserved");
  const profileModule = readFileSync(join(ROOT, "src/lib/ai/writing-profile-learning.ts"), "utf8");
  assert(/GOVERNANCE \(2026-11-15\)/.test(profileModule), "the source comment points at the governance rule instead of asserting authority");

  /* ---------------------------------------------------------------- */
  section("Feature flags — default off, honest, reversible");
  /* ---------------------------------------------------------------- */

  assert(FLAG_KEYS.includes("autonomous_essay"), "the autonomous mode has its own flag");
  assert(flagEnabled("autonomous_essay", {}) === false, "the flag is OFF when nothing is set");
  assert(flagEnabled("autonomous_essay", { SOPHIRA_AUTONOMOUS_ESSAY: "0" }) === false, "0 means off");
  assert(flagEnabled("autonomous_essay", { SOPHIRA_AUTONOMOUS_ESSAY: "yes" }) === false, "a value that is not 1/true means off");
  assert(flagEnabled("autonomous_essay", { SOPHIRA_AUTONOMOUS_ESSAY: "1" }) === true, "1 turns it on");
  assert(flagEnabled("autonomous_essay", { SOPHIRA_AUTONOMOUS_ESSAY: "true" }) === true, "true turns it on");
  const states = flagStates({});
  assert(states.length === FLAG_KEYS.length, "every flag reports its state");
  assert(states[0].enabled === false && /not set/.test(states[0].detail), "and states that it is not set");
  assert(/manual essay workflow is unchanged/.test(flagDisabledMessage("autonomous_essay")), "the disabled message says what still works");
  assert(FLAGS.autonomous_essay.rollback.length > 20, "the flag documents its own rollback");

  /* ---------------------------------------------------------------- */
  section("Delivery to a file - a finished run exports, an unfinished one refuses");
  /* ---------------------------------------------------------------- */

  assert(EXPORT_FORMATS.join() === "md,txt", "export: two formats, both readable without extra software");
  assert(isExportFormat("md") && isExportFormat("txt") && !isExportFormat("docx"), "export: the format is validated, never trusted");

  const refused = renderExport(plannedRun(), "md");
  assert(refused.ok === false, "export: an unfinished run cannot be handed back as a finished document");
  assert(/section|verification/i.test(refused.reason ?? ""), "export: the refusal names what is actually missing");

  const completeRun: RunRecord = { ...fullyDrafted(), state: "completed" };
  const md = renderExport(completeRun, "md");
  assert(md.ok === true && typeof md.body === "string", "export: a complete run exports");
  const body = md.body as string;
  assert(body.includes("# New Deal"), "export: the document carries its own title");
  assert(/## Introduction/.test(body), "export: every section keeps its heading");
  assert(/Text for s1/.test(body), "export: the text is the stored draft, not a fresh generation");
  assert(/About this draft/.test(body), "export: a provenance block is included");
  assert(/Final check: VERIFIED/.test(body), "export: the file states what the final check said");
  assert(/No research sources were used/.test(body), "export: the absence of sources is stated, not glossed over");
  assert(/draft to read, edit and submit as your own work/i.test(body), "export: the file is honest about what it is");
  assert(!/written by hand|human-authored|no AI/i.test(body), "export: the file never claims human authorship");

  const txt = renderExport(completeRun, "txt");
  assert(txt.ok === true && /NEW DEAL/.test(txt.body ?? ""), "export: the plain-text version is readable too");
  assert(/Final check: VERIFIED/.test(txt.body ?? ""), "export: and carries the same provenance, so choosing a format hides nothing");

  const withFindings = renderExport(
    { ...completeRun, findings: [{ stage: "planning" as const, severity: "limitation" as const, text: "No approved sources were attached." }] },
    "md",
  );
  assert(/Limitations recorded/.test(withFindings.body ?? ""), "export: recorded limitations reach the file, not only the screen");
  assert(/No approved sources were attached/.test(withFindings.body ?? ""), "export: and the limitation text is the real one");

  assert(exportFilename(completeRun, "md").endsWith(".md"), "export: the download has a .md extension");
  assert(exportFilename(completeRun, "txt").endsWith(".txt"), "export: and a .txt extension for plain text");
  assert(/^[a-z0-9-]+\.(md|txt)$/.test(exportFilename(completeRun, "md")), "export: the filename is safe for a downloads folder");
  assert(exportFilename({ ...completeRun, request: { question: "!!!" } }, "md").startsWith("assignment-"), "export: an untitled run still gets a usable filename");

  const exportRoute = readFileSync(join(ROOT, "src/app/api/essay/autonomous/[id]/export/route.ts"), "utf8");
  assert(/requireUser\(supabase\)/.test(exportRoute), "export: the route uses the shared authentication guard");
  assert(/guard\.data\.user\.id/.test(exportRoute), "export: and scopes the read to the signed-in student");
  assert(/status: 409/.test(exportRoute), "export: an unfinished run answers 409 rather than a half document");
  assert(/content-disposition/.test(exportRoute), "export: the file is delivered as a download, not rendered inline");
  assert(!/createAdminClient/.test(exportRoute), "export: and never touches the service-role client");

  /* ---------------------------------------------------------------- */
  section("The change record - every kind recorded or declared empty");
  /* ---------------------------------------------------------------- */

  const log = recentChanges(50);
  assert(log.length >= 6, `change log: it holds real entries (${log.length})`);
  assert(log.every((e) => e.evidence.length > 0), "change log: every entry names where it can be verified");
  assert(log.every((e) => e.decidedBy.length > 0), "change log: every entry names who decided it");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(log[0].date), "change log: entries are dated");
  assert(log[0].date >= log[log.length - 1].date, "change log: newest first");
  for (const category of CHANGE_CATEGORIES) {
    assert(changesIn(category).length > 0, `change log: the ${category} change is recorded, not silent`);
  }
  const summary = changeSummary();
  assert(summary.total === log.length, "change log: the summary counts the same entries the list shows");
  assert(summary.silent === silentCategories().length, "change log: empty kinds are counted, never hidden");
  assert(silentCategories().length === 0, "change log: no kind of change is left unrecorded");
  assert(CHANGE_CATEGORIES.length === 6, "change log: all six kinds the directive names exist");
  assert(Object.keys(CHANGE_CATEGORY_LABELS).length === CHANGE_CATEGORIES.length, "change log: every kind has a plain-English label");

  /* ---------------------------------------------------------------- */
  section("The Owner's requirements screen - the record the suite pins, rendered");
  /* ---------------------------------------------------------------- */

  const reqPage = readFileSync(join(ROOT, "src/app/owner/requirements/page.tsx"), "utf8");
  assert(/requireOwnerPage\(\)/.test(reqPage), "requirements page: it authorises on the server, so a member cannot open it");
  assert(!/createAdminClient/.test(reqPage), "requirements page: it never uses the service-role client");
  assert(!/"use client"/.test(reqPage), "requirements page: it stays a server component");
  assert(/PRODUCT_REQUIREMENTS/.test(reqPage) && /REQUIREMENT_STATUSES/.test(reqPage), "requirements page: it renders the same statuses the suite pins");
  assert(/recentChanges\(/.test(reqPage) && /silentCategories\(/.test(reqPage), "requirements page: it renders the change record rather than restating it");
  assert(/Nothing is recorded yet for/.test(reqPage), "requirements page: an unrecorded kind is shown as unrecorded");
  assert(/What is still missing/.test(reqPage) && /What you need to do/.test(reqPage), "requirements page: each row says what is missing and what the Owner must do");
  assert(/IMPLEMENTED, LIVE VERIFICATION REQUIRED/.test(reqPage) || /STATUS_MEANING/.test(reqPage), "requirements page: it explains the status words instead of assuming they are understood");
  assert(/aria-labelledby="req-changes"/.test(reqPage), "requirements page: the change section is announced to a screen reader");

  const nav = readFileSync(join(ROOT, "src/lib/navigation/owner-nav.ts"), "utf8");
  assert(nav.includes('href: "/owner/requirements"'), "requirements page: it is reachable from the Owner menu");
  assert(!/textarea|input/.test(reqPage), "requirements page: it takes no input, so it cannot be used to change a requirement");

  // The citation is now true: the page the specification names exists.
  const r16 = PRODUCT_REQUIREMENTS.find((r) => r.id === "R16");
  assert(Boolean(r16) && (r16!.evidence.join(" ").includes("src/app/owner/requirements/page.tsx")), "requirements record: R16 cites the screen");
  assert(existsSync(join(ROOT, "src/app/owner/requirements/page.tsx")), "requirements record: and that screen exists, so the citation is not a promise");
}
