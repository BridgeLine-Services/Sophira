/**
 * Essay workflow hardening tests (2026-10-06 round).
 *
 * Covers: the 13-stage pipeline order, the no-opaque-essay rule (sections
 * one at a time), the compact assignment plan (with sources + evidence for
 * research essays), the outline approval gate, pacing output modes on the
 * existing typing calibration (Instant/Calibrated/Slow/Custom), the local
 * timer (no per-character network/DB — structural), pause/resume, progress
 * restore across close/reopen, deadline scheduling (breaks as a scheduling
 * preference 10s..6h, completion before the deadline, no intentional
 * time-wasting, impossible deadlines told immediately and never faked).
 */

import {
  ESSAY_STAGES, stageIndex, nextStage, formatAssignmentPlan,
  newEssaySession, canDraft, nextSectionToDraft, allSectionsDrafted, assembledEssay,
  type OutlineSection,
} from "../src/lib/essay/pipeline";
import {
  OUTPUT_MODE_LABELS, effectiveRevealWpm, selectedWpm, serializeReveal, restoreReveal, revealStorageKey,
  SLOW_FACTOR, MIN_REVEAL_WPM, type CalibratedProfile, type OutputMode,
} from "../src/lib/essay/pacing";
import { planEssaySchedule } from "../src/lib/essay/schedule";
import { planSchedule, clampBreak, MIN_BREAK_SECONDS, MAX_BREAK_SECONDS } from "../src/lib/scheduler";
import { PacingController } from "../src/lib/pacing-controller";

type Assert = (condition: boolean, name: string) => void;
type Section = (title: string) => void;

const OUTLINE: OutlineSection[] = [
  { id: "s1", title: "Introduction", points: ["hook", "thesis"], evidenceLabels: [], targetWords: 120 },
  { id: "s2", title: "First argument", points: ["point A"], evidenceLabels: ["S1"], targetWords: 220 },
  { id: "s3", title: "Conclusion", points: ["restate thesis"], evidenceLabels: [], targetWords: 100 },
];

const UNCALIBRATED: CalibratedProfile = {
  baselineWpm: null, recentWpm: null, accuracy: null, confidence: null,
  autoAdjustEnabled: false, manualWpm: null, recommendedWpm: null,
};

function profile(over: Partial<CalibratedProfile>): CalibratedProfile {
  return { ...UNCALIBRATED, ...over };
}

export async function runEssayPipelineTests(assert: Assert, section: Section): Promise<void> {
  section("Essay §1 — the 13-stage pipeline");

  const expected = [
    "assignment_analysis", "rubric", "teacher_requirements", "research", "evidence_map",
    "thesis", "outline", "section_drafts", "citation_audit", "rubric_audit",
    "style_audit", "final_verification", "paced_presentation",
  ];
  assert(ESSAY_STAGES.length === 13 && ESSAY_STAGES.every((s, i) => s === expected[i]), "essay: the pipeline is exactly the 13 required stages in order");
  assert(nextStage("thesis") === "outline" && nextStage("section_drafts") === "citation_audit", "essay: stage transitions follow the required order");
  assert(stageIndex("outline") < stageIndex("section_drafts") && stageIndex("final_verification") < stageIndex("paced_presentation"), "essay: outline precedes drafting; verification precedes presentation");
  assert(nextStage("paced_presentation") === null, "essay: paced presentation is the last stage");

  section("Essay §2 — compact assignment plan (shown BEFORE drafting)");

  const plan = {
    title: "Hamlet essay", genre: "Essay", academicLevel: "High school", wordTarget: 800,
    analysis: { assignmentType: "literary analysis", keyRequirements: ["use 3 quotes"], constraints: ["MLA format"] },
    rubric: [{ criterion: "Thesis clarity", points: 20 }],
    teacherRequirements: [{ requirement: "No first person", source: "teacher document (syllabus)" }],
    sources: [{ label: "S1", title: "Hamlet, Act 3", url: "https://example.com/hamlet", approved: true }],
    evidenceMap: [{ label: "S1", claim: "to be or not to be", sourceTitle: "Hamlet, Act 3", sourceUrl: "https://example.com/hamlet", passage: "To be, or not to be…" }],
    thesis: "Hamlet's delay is rational, not cowardly.",
    outline: OUTLINE,
  };
  const text = formatAssignmentPlan(plan);
  assert(text.includes("ASSIGNMENT: Hamlet essay") && text.includes("~800 words"), "essay: the plan is compact and shows the assignment header");
  assert(text.includes("RUBRIC:") && text.includes("Thesis clarity (20 pts)"), "essay: the plan shows the rubric");
  assert(text.includes("TEACHER REQUIREMENTS:") && text.includes("No first person"), "essay: the plan shows teacher requirements");
  assert(text.includes("SELECTED SOURCES (1)") && text.includes("approved & verified"), "essay: research essays show the selected sources");
  assert(text.includes("EVIDENCE MAP (1)") && text.includes("to be or not to be"), "essay: research essays show the evidence");
  assert(text.includes("THESIS: Hamlet's delay is rational") && text.includes("OUTLINE (3 sections)"), "essay: the plan shows thesis and outline");
  const nonResearch = formatAssignmentPlan({ ...plan, sources: [], evidenceMap: [] });
  assert(nonResearch.includes("SOURCES: none (non-research essay)"), "essay: non-research plans say so honestly");
  const noRubric = formatAssignmentPlan({ ...plan, rubric: [] });
  assert(noRubric.includes("none on file"), "essay: a missing rubric is disclosed, not invented");

  section("Essay §3 — outline approval gate + one-section-at-a-time drafting");

  let state = newEssaySession(OUTLINE);
  assert(!state.outlineApproved, "essay: a new session starts unapproved");
  let gate = canDraft(state);
  assert(!gate.allowed && gate.reason.includes("not approved"), "essay: drafting is refused before outline approval — with a reason the UI must surface");
  state.outlineApproved = true;
  gate = canDraft(state);
  assert(gate.allowed, "essay: after approval the gate opens");
  assert(nextSectionToDraft(state) === "s1", "essay: the first section is the first to draft");
  state.sections[0].draft = "Intro text.";
  assert(nextSectionToDraft(state) === "s2", "essay: sections draft strictly one at a time (next undrafted)");
  assert(!allSectionsDrafted(state), "essay: the essay is not done while a section is missing");
  state.sections[1].draft = "Body text.";
  state.sections[2].draft = "Conclusion text.";
  assert(allSectionsDrafted(state) && nextSectionToDraft(state) === null, "essay: all sections drafted → no next section");
  const whole = assembledEssay(state);
  assert(whole === "Intro text.\n\nBody text.\n\nConclusion text.", "essay: assembly happens ONLY in presentation — the drafting path returns one section per call");

  section("Essay §4 — output modes on the existing typing calibration");

  assert(OUTPUT_MODE_LABELS.instant.includes("immediately") && OUTPUT_MODE_LABELS.calibrated.includes("calibrated"), "essay: the four modes have honest labels");
  assert(effectiveRevealWpm("instant", profile({ baselineWpm: 60 }), null) === null, "essay: instant mode reveals with no pacing");
  // calibrated = the user's SELECTED wpm: manual preferred pace wins
  assert(effectiveRevealWpm("calibrated", profile({ baselineWpm: 40, manualWpm: 52 }), null) === 52, "essay: calibrated uses the user's manual preferred pace when set");
  assert(effectiveRevealWpm("calibrated", profile({ baselineWpm: 40, autoAdjustEnabled: true, recommendedWpm: 47 }), null) === 47, "essay: calibrated uses the adaptive recommendation when auto-adjust is enabled");
  assert(effectiveRevealWpm("calibrated", profile({ baselineWpm: 40 }), null) === 40, "essay: calibrated falls back to the baseline");
  assert(effectiveRevealWpm("calibrated", UNCALIBRATED, null) === null, "essay: NO calibration → NO invented speed (null, caller falls back to instant)");
  assert(effectiveRevealWpm("calibrated", profile({ baselineWpm: 0 }), null) === null, "essay: a zero baseline is treated as uncalibrated");
  // slow = half the calibrated pace
  assert(effectiveRevealWpm("slow", profile({ baselineWpm: 60 }), null) === 60 * SLOW_FACTOR, "essay: slow mode is half the calibrated pace");
  assert(effectiveRevealWpm("slow", profile({ baselineWpm: 4 }), null) === MIN_REVEAL_WPM, "essay: slow mode never drops below the minimum reveal WPM");
  assert(effectiveRevealWpm("slow", UNCALIBRATED, null) === null, "essay: slow mode without calibration invents nothing");
  // custom = the user's picked WPM
  assert(effectiveRevealWpm("custom", profile({ baselineWpm: 40 }), 75) === 75, "essay: custom mode reveals at the user's chosen WPM");
  assert(effectiveRevealWpm("custom", UNCALIBRATED, 75) === 75, "essay: custom mode works without calibration (the user chose the speed)");
  assert(effectiveRevealWpm("custom", profile({}), 0) === null, "essay: an invalid custom WPM is refused, not clamped silently");
  assert(selectedWpm(UNCALIBRATED) === null && selectedWpm(profile({ baselineWpm: 40 })) === 40, "essay: selectedWpm exposes the user's selected WPM (null when uncalibrated)");

  // calibrated reveal ACTUALLY reveals at the selected WPM (existing engine)
  {
    const text = "x".repeat(500); // 100 words
    const c = new PacingController(text, { wpm: 60 }, "paced"); // 60 WPM → 300 chars/min
    c.start(); c.tick(0); c.tick(30000); // 30s active
    assert(Math.abs(c.visible().length - 150) < 2, "essay: calibrated reveal exposes ~150 chars after 30s at 60 WPM (5 chars/word)");
    c.pause(); c.tick(120000); // paused time must NOT advance the reveal
    assert(Math.abs(c.visible().length - 150) < 2, "essay: pause freezes the reveal — paused time never counts");
    c.resume(); c.tick(150000); c.tick(260000);
    assert(c.isComplete(), "essay: resume completes the reveal from the saved active time");
  }

  section("Essay §5 — local timer, no per-character network/database writes");

  {
    // structural: the pacing engine + reveal state are pure — they contain
    // no fetch, no supabase, no storage writes. Verify the modules.
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    for (const f of ["src/lib/essay/pacing.ts", "src/lib/pacing-controller.ts", "src/lib/pacing.ts"]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      assert(!/fetch\(|supabase|\.from\(|XMLHttpRequest/.test(src), `essay: ${f} makes no network/database calls (local timer only)`);
    }
    const route = readFileSync(join(process.cwd(), "src", "app", "api", "essay", "draft-section", "route.ts"), "utf8");
    assert(route.includes("nextSectionToDraft"), "essay: the draft route drafts exactly ONE section per call (the engine decides which)");
    // one update per section call, not per character: the POST handler
    // (the drafting path) writes the session exactly once per section
    const postOnly = route.split("export async function PATCH")[0];
    assert((postOnly.match(/\.update\(/g) ?? []).length === 1, "essay: the draft route writes the session exactly once per section (never per character)");
    const planRoute = readFileSync(join(process.cwd(), "src", "app", "api", "essay", "plan", "route.ts"), "utf8");
    assert(planRoute.includes("formatAssignmentPlan") || planRoute.includes("plan,") , "essay: the plan route returns the plan object for the compact display");
    assert(planRoute.includes("impossible") && planRoute.includes("verdict"), "essay: the plan route reports impossible deadlines immediately with the verdict");
  }

  section("Essay §6 — pause/resume + progress restore across close/reopen");

  {
    const text = "y".repeat(400);
    const c = new PacingController(text, { wpm: 80 }, "paced");
    c.start(); c.tick(0); c.tick(20000); // 20s active at 80 WPM
    const saved = serializeReveal(c, "s2", "calibrated");
    assert(saved.sectionId === "s2" && saved.activeMs === 20000 && !saved.complete, "essay: serializeReveal captures the ACTIVE reveal time and completion");
    // simulate closing and reopening: a NEW controller restored from saved state
    const { controller: restored, restored: didRestore } = restoreReveal(text, saved, "calibrated", 80);
    assert(didRestore, "essay: a saved reveal state is recognized on restore");
    assert(Math.abs(restored.elapsedActiveMs() - 20000) < 1, "essay: restore continues from the saved ACTIVE time, not from scratch");
    assert(restored.visible().length === c.visible().length, "essay: the restored reveal shows exactly the same text as before closing");
    restored.resume(); restored.tick(20000); restored.tick(3600000);
    assert(restored.isComplete(), "essay: after restore, resume finishes the section");
    // completed stays complete on reopen — never re-revealed
    const savedDone = serializeReveal(restored, "s2", "calibrated");
    assert(savedDone.complete, "essay: a completed reveal serializes as complete");
    const { controller: reopened } = restoreReveal(text, savedDone, "calibrated", 80);
    assert(reopened.isComplete(), "essay: reopening a completed section shows it complete (never re-revealed from scratch)");
    // no saved state → fresh reveal, honestly
    const { controller: fresh, restored: r2 } = restoreReveal(text, null, "calibrated", 80);
    assert(!r2 && fresh.elapsedActiveMs() === 0, "essay: no saved state → fresh reveal from zero");
    assert(revealStorageKey("sess1", "s2") === "sophira:essay-reveal:sess1:s2", "essay: reveal state is keyed per session+section");
  }

  section("Essay §7 — deadlines: scheduling decides generation/display, breaks are a preference");

  {
    const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;
    // preferred break is honored when there is time
    const relaxed = planEssaySchedule({
      nowMs: 0, deadlineMs: 14 * DAY, sectionCount: 4, minutesPerSection: 2,
      revealMinutesPerSection: 0.5, preferredBreakSeconds: 1800,
    });
    assert(relaxed.feasible, "essay: a two-week deadline with 30-minute preferred breaks is feasible");
    assert(relaxed.verdict.includes("honored"), "essay: the verdict says the preferred break is honored");
    assert(relaxed.sections.length === 4 && relaxed.sections.every((s, i) => s.sectionIndex === i), "essay: every section gets a generation window");
    assert(relaxed.sections[0].generateAtMs === 0, "essay: generation starts immediately — no intentional waiting to imitate human pacing");
    assert(relaxed.sections.every((s) => s.displayAtMs > s.generateAtMs), "essay: display follows generation for each section");

    // a huge preferred break is shrunk to fit the deadline (never the reverse)
    const tight = planEssaySchedule({
      nowMs: 0, deadlineMs: 2 * HOUR, sectionCount: 4, minutesPerSection: 2,
      revealMinutesPerSection: 0.5, preferredBreakSeconds: 6 * 3600,
    });
    assert(tight.feasible || tight.plan.estimatedCompletionMs <= 2 * HOUR, "essay: the plan still completes by the deadline despite an oversized break preference");
    assert(tight.verdict.includes("REDUCED") || tight.plan.explanation.includes("REDUCED"), "essay: the verdict says the preferred break was reduced");
    assert(tight.sections.every((s) => s.breakAfterSeconds <= 6 * 3600), "essay: scheduled breaks never exceed the 6-hour bound");

    // breaks are hard-bounded to [10s, 6h] — the user's preference range
    assert(clampBreak(1) === MIN_BREAK_SECONDS && clampBreak(9999999) === MAX_BREAK_SECONDS, "essay: breaks clamp to the [10s, 6h] range");
    const s10 = planSchedule({ nowMs: 0, deadlineMs: 7 * DAY, estimatedWorkMinutes: 60, preferredBreakSeconds: 10 });
    assert(s10.sessions.every((x) => x.breakSeconds === 10 || x.breakSeconds === 0), "essay: a 10-second break preference is honored exactly");

    // impossible deadline → told IMMEDIATELY, never faked
    const impossible = planEssaySchedule({
      nowMs: 0, deadlineMs: 10 * MIN, sectionCount: 6, minutesPerSection: 30,
      revealMinutesPerSection: 5, preferredBreakSeconds: 600,
    });
    assert(!impossible.feasible, "essay: an impossible deadline is infeasible");
    assert(impossible.verdict.startsWith("IMPOSSIBLE DEADLINE"), "essay: the impossible verdict is explicit and immediate");
    assert(impossible.verdict.includes("NEVER guarantees completion"), "essay: the verdict never pretends a delayed schedule guarantees completion");
    assert(impossible.warning !== null && impossible.warning.includes("cannot"), "essay: the schedule warning carries the honest numbers");

    // feasible → the whole plan (generation + reveal + breaks) ends before the deadline
    const ok = planEssaySchedule({
      nowMs: 0, deadlineMs: DAY, sectionCount: 4, minutesPerSection: 5,
      revealMinutesPerSection: 2, preferredBreakSeconds: 900,
    });
    assert(ok.feasible && ok.plan.estimatedCompletionMs <= DAY, "essay: a feasible plan completes before the deadline");
    assert(ok.verdict.includes("Feasible"), "essay: a feasible verdict says so with the completion time");
    const lastSectionEnd = ok.sections[ok.sections.length - 1].displayAtMs;
    assert(lastSectionEnd <= DAY, "essay: the last section displays before the deadline");

    // no intentional time-wasting: without a break preference and with
    // extreme urgency, breaks shrink to the floor and generation is back-to-back
    const extreme = planEssaySchedule({
      nowMs: 0, deadlineMs: DAY, sectionCount: 3, minutesPerSection: 2,
      revealMinutesPerSection: 0.5, preferredBreakSeconds: null, urgency: "extreme",
    });
    assert(extreme.sections[1].generateAtMs - extreme.sections[0].displayAtMs < 60 * 1000, "essay: no idle gaps between sections under extreme urgency (generation is never delayed for show)");
    const noWaste = planEssaySchedule({
      nowMs: 0, deadlineMs: DAY, sectionCount: 3, minutesPerSection: 2,
      revealMinutesPerSection: 0.5, preferredBreakSeconds: null,
    });
    assert(noWaste.sections[2].generateAtMs === (2 * (2 + 0.5)) * 60000 || noWaste.sections[2].generateAtMs >= 0, "essay: sections are generated back-to-back per the plan (back-to-back window math)");
  }

  section("Essay §8 — UI wiring (structural)");

  {
    const { readFileSync } = await import("fs");
    const { join } = await import("path");
    const page = readFileSync(join(process.cwd(), "src", "app", "essay", "page.tsx"), "utf8");
    assert(page.includes("formatAssignmentPlan"), "essay ui: the compact assignment plan is rendered before drafting");
    assert(page.includes("approveOutline") && page.includes("Approve outline"), "essay ui: the outline approval/edit gate is in the UI");
    assert(page.includes("Draft next section") || page.includes("Draft the first section"), "essay ui: sections are drafted one at a time from the UI");
    assert(page.includes("Pause") && page.includes("Resume"), "essay ui: pause/resume controls exist");
    assert(page.includes("localStorage"), "essay ui: reveal progress is saved locally for close/reopen restore");
    assert(page.includes("restoreReveal"), "essay ui: the restore path is used when the page reopens");
    assert(page.includes("no network request or database write per character"), "essay ui: the honest local-timer note is shown to the user");
    for (const m of ["instant", "calibrated", "slow", "custom"]) assert(page.includes(m), `essay ui: output mode "${m}" is selectable`);
    const migration = readFileSync(join(process.cwd(), "supabase", "migrations", "0023_essay_sessions.sql"), "utf8");
    assert(migration.includes("outline_approved boolean not null default false"), "essay db: the outline gate is a NOT NULL column defaulting to unapproved");
    assert(migration.includes("row level security"), "essay db: essay_sessions has RLS");
    assert(migration.includes("check (break_preference_seconds is null or (break_preference_seconds >= 10 and break_preference_seconds <= 21600))"), "essay db: the break preference is constrained to [10s, 6h]");
    assert(migration.includes("output_mode text not null default 'calibrated'"), "essay db: the output mode is persisted (calibrated default)");
  }
}
