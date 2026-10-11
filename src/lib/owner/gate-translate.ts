/**
 * OWNER SYSTEM HEALTH TRANSLATIONS (2026-10-11, phase 6).
 *
 * Pure module: turns the release gate's real check results into plain
 * English for the nontechnical owner — what each check means, why it
 * matters, the single prerequisite group it belongs to, and the exact
 * owner action. This module NEVER changes a check's status: a BLOCKED
 * check stays BLOCKED, and the verdict is READY only when every check
 * genuinely passed. It contains no credential values, only variable
 * NAMES, which are already public in docs/ENVIRONMENT_VARIABLES.md.
 */

export type GateStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT RUN";

export interface GateCheck {
  id: number;
  name: string;
  status: GateStatus;
  detail: string;
}

export interface TranslatedCheck extends GateCheck {
  /** Plain-English meaning of this check. */
  plain: string;
  /** Why this check matters for the release. */
  why: string;
  /** Prerequisite group (several checks often share ONE owner action). */
  group: string;
  /** The exact owner action, or "" when nothing is needed. */
  ownerAction: string;
  /** Beginner-facing state label (never a fake "Ready"). */
  displayState: "Ready" | "Needs attention" | "Failed" | "Not verified";
}

interface Rule {
  match: RegExp;
  group: string;
  plain: string;
  why: string;
  ownerAction: string;
}

const RULES: Rule[] = [
  {
    match: /SUPABASE_TEST_URL|SUPABASE_TEST_ANON_KEY|SUPABASE_TEST_SERVICE_ROLE_KEY|test environment|live matrices/i,
    group: "One-time test environment",
    plain: "Sophira's live security drills need a private, throwaway copy of the database to practice on. That copy is not connected yet.",
    why: "These drills prove that one member can never see another member's private work. Until they run, the security checks stay blocked and are never reported as passed.",
    ownerAction: "Add the three test-database values once, in the secure location shown in docs/ENVIRONMENT_VARIABLES.md. Sophira then runs the security drills automatically; no SQL or terminal work is needed from you.",
  },
  {
    match: /SUPABASE_URL|SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY|database credentials|Database migrations applied|migrations 0001/i,
    group: "Production database connection",
    plain: "Sophira's database is not connected yet, so it cannot confirm that your data is stored and protected.",
    why: "Every assignment, memory, and preference lives in this database, and the safety rules that keep members' work private live there too. Nothing can be verified until it is connected.",
    ownerAction: "Connect the Supabase integration for this project in your hosting dashboard; it fills in the database settings automatically. Never share these values in chat, files, or messages.",
  },
  {
    match: /GEMINI_API_KEY|OPENAI_API_KEY|AI provider/i,
    group: "AI connection",
    plain: "Sophira's AI helpers are not connected yet.",
    why: "Essay feedback, planning help, and tutoring need an AI provider. Your offline tools keep working, but AI-powered features stay unavailable and honestly say so until this is connected.",
    ownerAction: "Connect the free Google AI key (GEMINI_API_KEY) through your hosting provider's environment settings; docs/ENVIRONMENT_VARIABLES.md shows the exact screen. No paid service is ever enabled without your explicit approval.",
  },
  {
    match: /SEARCH_API_KEY|Search provider/i,
    group: "Research and web search",
    plain: "Sophira's live web research is not connected yet.",
    why: "The research tools search the real web and verify every source. Without a search provider they stay switched off; they never invent sources.",
    ownerAction: "Add the free search key (SEARCH_API_KEY) in your hosting provider's environment settings, following docs/ENVIRONMENT_VARIABLES.md.",
  },
  {
    match: /SOPHIRA_APP_URL|Production URL|native URL/i,
    group: "Your app's web address",
    plain: "Sophira does not yet know the public web address of your deployment.",
    why: "Phone and tablet apps, email links, and live health checks all need this address to point at the right place.",
    ownerAction: "Set SOPHIRA_APP_URL to your deployment's address (for example https://your-app.vercel.app) in your hosting provider's environment settings.",
  },
  {
    match: /APK|physical (Android )?device|DEVICE_ACCEPTANCE|emulator/i,
    group: "Phone and tablet testing",
    plain: "The app has not yet been tried on a real phone or tablet.",
    why: "Some things (touch, on-screen keyboards, offline use) can only be proven on a real device. Automated tests cover everything they can, but this step stays open until you test it yourself.",
    ownerAction: "Follow the beginner checklist in docs/DEVICE_ACCEPTANCE.md on your own phone or tablet; it tells you exactly what to tap and what to look for.",
  },
  {
    match: /legal|Legal|privacy notice|terms/i,
    group: "Legal information (needs qualified review)",
    plain: "Some legal pages still contain placeholders for facts only you can provide.",
    why: "Privacy and terms documents must accurately describe what Sophira actually does before publication. Sophira will not invent legal facts, addresses, or approval.",
    ownerAction: "Fill in the owner facts in docs/legal/LEGAL_CONFIGURATION.md, then have a qualified legal professional review the documents. An automated check can never replace that review.",
  },
];

function displayStateFor(status: GateStatus): TranslatedCheck["displayState"] {
  if (status === "PASS") return "Ready";
  if (status === "FAIL") return "Failed";
  if (status === "BLOCKED") return "Needs attention";
  return "Not verified";
}

const FALLBACK: Record<Exclude<GateStatus, "PASS">, Omit<Rule, "match">> = {
  FAIL: {
    group: "Other checks",
    plain: "This check ran and failed.",
    why: "A failed check means the release cannot go out until the problem is fixed.",
    ownerAction: "The technical detail below shows exactly what failed. If it mentions a missing connection, fix that first; otherwise this needs a developer's attention.",
  },
  BLOCKED: {
    group: "Other checks",
    plain: "This check is waiting on something that is not set up yet.",
    why: "Blocked checks are never treated as passed; the release stays closed until they run for real.",
    ownerAction: "The technical detail below names exactly what is missing.",
  },
  "NOT RUN": {
    group: "Other checks",
    plain: "This check has not been run yet.",
    why: "A check that has not run is never treated as passed.",
    ownerAction: "",
  },
};

/** Translate every real gate check into plain English. Statuses are never altered. */
export function translateChecks(checks: GateCheck[]): TranslatedCheck[] {
  return checks.map((c) => {
    if (c.status === "PASS") {
      return {
        ...c,
        plain: "This check passed when it was last run.",
        why: "It is verified evidence from a real run, not an assumption.",
        group: "Completed checks",
        ownerAction: "",
        displayState: displayStateFor(c.status),
      };
    }
    const rule = RULES.find((r) => r.match.test(c.name) || r.match.test(c.detail));
    const fb = rule ?? FALLBACK[c.status];
    return { ...c, ...fb, displayState: displayStateFor(c.status) };
  });
}

export interface HealthVerdict {
  verdict: "READY FOR RELEASE" | "NOT READY";
  counts: { total: number; pass: number; fail: number; blocked: number; notRun: number };
  reason: string;
  disclaimer: string;
}

/**
 * The final honest verdict: READY only when EVERY check genuinely passed.
 * Blocked and unrun checks are never promoted; zero evidence is never READY.
 */
export function verdictFor(checks: TranslatedCheck[]): HealthVerdict {
  const counts = { total: checks.length, pass: 0, fail: 0, blocked: 0, notRun: 0 };
  for (const c of checks) {
    if (c.status === "PASS") counts.pass += 1;
    else if (c.status === "FAIL") counts.fail += 1;
    else if (c.status === "BLOCKED") counts.blocked += 1;
    else counts.notRun += 1;
  }
  const ready = counts.total > 0 && counts.fail === 0 && counts.blocked === 0 && counts.notRun === 0;
  return {
    verdict: ready ? "READY FOR RELEASE" : "NOT READY",
    counts,
    reason: ready
      ? `All ${counts.total} checks genuinely passed in the latest run.`
      : `${counts.blocked} check(s) are waiting on a missing prerequisite, ${counts.notRun} have not run yet, and ${counts.fail} failed. A blocked or unrun check is never treated as passed.`,
    disclaimer:
      "This is a technical readiness result. It is not a guarantee of legal compliance, perfect security, or freedom from defects.",
  };
}
