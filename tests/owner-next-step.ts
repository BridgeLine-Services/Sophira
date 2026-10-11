/**
 * OWNER NEXT-STEP GUIDE (phase 15 deliverable, 2026-10-11): the nontechnical
 * owner gets a plain-English list of ONLY the actions that need them. It
 * names real variables and documents, keeps the honest framing (attorney
 * review required, app currently NOT READY), contains no credential values,
 * and System Health summarizes the same next steps from real gate data.
 */
import { existsSync, readFileSync } from "fs";

export function runOwnerNextStepTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("owner next-step guide (phase 15 deliverable)");

  const docPath = "docs/WHAT_I_NEED_TO_DO_NEXT.md";
  assert(existsSync(docPath), "next: the beginner guide 'What I Need to Do Next' exists");
  const doc = readFileSync(docPath, "utf8");
  const tokens = [
    "SOPHIRA_APP_URL",
    "GEMINI_API_KEY",
    "SEARCH_API_KEY",
    "SUPABASE_TEST_URL",
    "DEVICE_ACCEPTANCE.md",
    "LEGAL_CONFIGURATION.md",
    "ENVIRONMENT_VARIABLES.md",
  ];
  for (const token of tokens) {
    assert(doc.includes(token), `next: the guide covers ${token} with the real variable or document name`);
  }
  assert(doc.includes("attorney") && doc.includes("NOT READY"),
    "next: the guide keeps the honest framing (legal review required; the app is currently NOT READY)");
  assert(!/(sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,})/.test(doc),
    "next: the guide contains no credential values (variable names only)");
  assert(doc.includes("Never paste a key into a chat"),
    "next: the guide teaches the secret-handling golden rule");

  const panel = readFileSync("src/components/app/SystemHealthPanel.tsx", "utf8");
  assert(panel.includes("What you can do next"),
    "next: System Health surfaces a plain-English next-step summary");
  assert(panel.includes('g !== "Completed checks"') && panel.includes('displayState !== "Ready"'),
    "next: the summary lists ONLY unresolved groups (completed work is never re-asked)");
}
