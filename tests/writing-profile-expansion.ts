/**
 * PHASE 2B-2E — writing-profile learning expansion (2026-11-09).
 *
 * Proves, against the REAL analyser:
 *   - all 17 dimensions of the phase directive are reachable;
 *   - every observation is descriptive, hedged and approval-gated (never an
 *     authorship or detector claim);
 *   - the four preference KINDS (assignment / course / subject / general)
 *     are distinguished, and a single assignment correction can never
 *     overwrite the whole profile (mayOverrideProfile);
 *   - learning stays inside the member's own samples (RLS pins);
 *   - the approval path is additive and reversible (proposals, not overwrites).
 */
import { readFileSync } from "fs";
import {
  mayOverrideProfile,
  proposeStyleSuggestions,
  type StyleSuggestion,
} from "../src/lib/ai/writing-profile-learning";

export function runWritingProfileExpansionTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); }
  };

  const flat =
    "The study was good. The data was clear. The result was useful. The method was fair. The end was near. The work was done. The report was long. The point was made.";
  const para = (n: number) =>
    Array.from({ length: n }, () => "The sample was small").join(". ") + ".";
  const multiShort = `${para(1)}\n\n${para(1)}\n\n${para(1)}`;
  const withCitation =
    "Smith (2019) argues that urban trees cool streets. " +
    "The measurements support this (Smith, 2019). ".repeat(12) +
    "A second study (Jones, 2021) agrees.";
  const noReasons = "The data was collected. The table was drawn.\n\nThe result was shown. The paper ended.";
  const explanatory = "The cost fell. For example, the 2019 trial halved it.";

  // ---- all 17 dimensions reachable -------------------------------------
  const big = proposeStyleSuggestions(
    [flat, multiShort, withCitation, noReasons, explanatory],
    "undergraduate",
    "essay",
    {
      subject: "history",
      courseId: "course-1",
      corrections: [
        { before: "The study that was done was good.", after: "The study was good." },
        { before: "It was clear to see that the data was clear.", after: "The data was clear." },
      ],
    }
  );
  // Two dimensions need their own fixture shapes (a corpus that mixes
  // paragraph lengths averages the signal away - which is correct behaviour
  // for a descriptive analyser).
  const paraFixture = proposeStyleSuggestions([multiShort], "undergraduate", "essay");
  const complexityFixture = proposeStyleSuggestions([flat, flat, flat], "undergraduate", "essay");
  const cats = new Set([
    ...big.map((s: StyleSuggestion) => s.category),
    ...paraFixture.map((s: StyleSuggestion) => s.category),
    ...complexityFixture.map((s: StyleSuggestion) => s.category),
  ]);
  const required = [
    "sentence_variation", "vocabulary", "transition", "opening", "closing",
    "sentence_length", "paragraph_organization", "word_complexity", "tone",
    "formality", "argument_development", "explanatory_depth", "citation",
    "formatting", "subject_convention", "corrections", "explanation_style",
  ];
  for (const c of required) {
    assert(cats.has(c as StyleSuggestion["category"]), `2B: dimension reachable - ${c}`);
  }
  assert(required.length === 17, "2B: the directive's 17 dimensions are all enumerated");

  // ---- honesty: descriptive, never an authorship/detector claim --------
  const text = JSON.stringify(big);
  assert(!/human|authorship|detect|turnitin|AI[- ]generated|typed by/i.test(text),
    "2B: no authorship or detection claim in any observation");
  assert(!/100%|certainty|guarantee/i.test(text),
    "2B: no certainty or guarantee language in observations");
  assert(big.every((s) => s.requiresApproval === true), "2B: every observation remains approval-gated");
  assert(big.every((s) => s.confidence > 0 && s.confidence <= 1), "2B: confidence stays within 0-1");
  assert(big.every((s) => typeof s.description === "string" && s.description.length > 20),
    "2B: every observation explains itself in a sentence");
  assert(new Set(big.map((s) => s.id)).size === big.length, "2B: observation ids stay unique");

  // ---- four preference KINDS, evidence-linked --------------------------
  const one = proposeStyleSuggestions([flat], "high-school", "essay");
  assert(one.every((s) => s.scope === "temporary" && s.scopeKind === "assignment"),
    "2B: one sample can only ever be an ASSIGNMENT-scoped observation");
  const two = proposeStyleSuggestions([flat, explanatory], "graduate", "essay");
  assert(two.every((s) => s.scope === "course" && s.scopeKind === "course"),
    "2B: two samples scope to the COURSE");
  const subject2 = proposeStyleSuggestions([flat, explanatory], "graduate", "essay", { subject: "biology" });
  assert(subject2.every((s) => s.scopeKind === "subject" || s.category === "corrections"),
    "2B: with a subject supplied, observations are SUBJECT-scoped (keyed to the subject)");
  assert(subject2.filter((s) => s.category === "subject_convention").every((s) => s.scopeKey === "biology"),
    "2B: subject observations carry the subject key");
  const five = proposeStyleSuggestions([flat, explanatory, flat, explanatory, flat], "doctoral", "essay");
  assert(five.every((s) => s.scope === "global" && s.scopeKind === "general"),
    "2B: five consistent samples may propose a GENERAL observation (still approval-gated)");
  assert(five.every((s) => s.evidence === 5), "2B: every observation records how many samples support it");

  // ---- a single correction can never rewrite the profile ---------------
  const correctionsOnly = proposeStyleSuggestions([flat], "undergraduate", "essay", {
    corrections: [{ before: "This is a very long sentence that could be shorter.", after: "Short sentence." }],
  });
  const corr = correctionsOnly.find((s) => s.category === "corrections");
  assert(!!corr && corr.scope === "temporary" && corr.scopeKind === "assignment",
    "2B: corrections are always assignment-scoped, never global");
  assert(mayOverrideProfile({ scope: "global", evidence: 12 }, { scope: "temporary", evidence: 1 }) === false,
    "2B: an assignment correction NEVER overrides a global preference");
  assert(mayOverrideProfile({ scope: "course", evidence: 3 }, { scope: "temporary", evidence: 9 }) === false,
    "2B: a narrower scope never overrides a broader one, regardless of evidence");
  assert(mayOverrideProfile({ scope: "temporary", evidence: 1 }, { scope: "course", evidence: 2 }) === true,
    "2B: course evidence (2+ samples) may replace an assignment-scoped note");
  assert(mayOverrideProfile({ scope: "course", evidence: 2 }, { scope: "global", evidence: 2 }) === false,
    "2B: global claims need the full sample threshold");
  assert(mayOverrideProfile({ scope: "course", evidence: 2 }, { scope: "global", evidence: 5 }) === true,
    "2B: global claims with 5+ samples may replace course scope");

  // ---- determinism -----------------------------------------------------
  const a = JSON.stringify(proposeStyleSuggestions([flat, explanatory], "graduate", "essay"));
  const b = JSON.stringify(proposeStyleSuggestions([flat, explanatory], "graduate", "essay"));
  assert(a === b, "2B: identical samples always produce identical observations");
  assert(proposeStyleSuggestions([], "graduate", "essay").length === 0,
    "2B: no samples means no invented observations");

  // ---- isolation, approval and reversibility (source pins) -------------
  const route = readFileSync("src/app/api/ai/style-suggestions/route.ts", "utf8");
  assert(route.includes('from("writing_samples")') && !/service[_-]?role/i.test(route),
    "2C: samples are read with the member's own request-scoped client (never service role)");
  assert(route.includes("profile_update_proposals") && !/from\("writing_profiles"\)\s*\n?\s*\.update/.test(route),
    "2C: accepted observations become ADDITIVE proposals - the profile is never overwritten in place");
  assert(route.includes("pickAccepted") && route.includes("accept"),
    "2C: only member-selected observations are proposed (explicit approval)");

  const mig = readFileSync("supabase/migrations/0001_init.sql", "utf8");
  assert(/writing_samples[\s\S]{0,400}enable row level security/.test(mig),
    "2C: writing_samples is RLS-protected (one member's samples never train another's profile)");
  assert(/writing_samples_own[\s\S]{0,200}user_id = auth\.uid\(\)/.test(mig),
    "2C: the writing_samples policy keys on user_id = auth.uid()");

  const lib = readFileSync("src/lib/ai/writing-profile-learning.ts", "utf8");
  assert(lib.includes("export function mayOverrideProfile"),
    "2B: the overwrite guard is exported for the route to enforce");
  assert(!/fetch\(|XMLHttpRequest|localStorage/.test(lib),
    "2C: the analyser is pure - no network, no browser storage");

  return { passed, failed };
}
