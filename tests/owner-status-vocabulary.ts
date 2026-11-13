/**
 * ONE VOCABULARY FOR EVERY READINESS ROW (2026-11-13, directive Part 13).
 *
 * Before this, three owner pages described the same services in three different sets of
 * words: System Status said "working / needs attention / not set up", Feature Health said six
 * things, and AI Providers said "working" whenever a key merely existed. The owner had to
 * translate between pages, and one page over-claimed. These tests pin the single vocabulary,
 * the honest mapping, and the fact that "not set up" can never make the system unhealthy.
 */
import { readFileSync } from "fs";
import { buildStatusRows, statusIsHealthy } from "../src/lib/owner-status";
import {
  FEATURE_STATE_ORDER,
  stateExplanation,
  stateLabel,
  stateTone,
  type FeatureState,
} from "../src/lib/owner/feature-catalog";

type Assert = (ok: boolean, message: string) => void;

const ALL_ENTERED = { aiReady: true, microsoft: true, google: true, search: true, membersLoaded: true, email: true };
const NOTHING_OPTIONAL = { aiReady: true, microsoft: false, google: false, search: false, membersLoaded: true, email: false };

export async function runOwnerStatusVocabularyTests(assert: Assert, section: (name: string) => void) {
  section("owner vocabulary: one closed set of states, in one order");

  const known = new Set<FeatureState>(FEATURE_STATE_ORDER);
  assert(FEATURE_STATE_ORDER.length === 6, "vocabulary: six states exist and the list is the source of truth");
  for (const state of FEATURE_STATE_ORDER) {
    assert(stateLabel(state).trim().length > 0, `vocabulary: ${state} has a plain label`);
    assert(stateExplanation(state).trim().length > 20, `vocabulary: ${state} has a real explanation, not a stub`);
    assert(/^(success|accent|neutral|warn|danger)$/.test(stateTone(state)), `vocabulary: ${state} has a chip colour`);
  }
  const labels = FEATURE_STATE_ORDER.map(stateLabel);
  assert(new Set(labels).size === labels.length, "vocabulary: no two states share a label");
  assert(!labels.some((l) => /unknown|n\/a/i.test(l)), "vocabulary: no state falls back to 'unknown'");

  section("owner vocabulary: every System Status row speaks it");

  for (const input of [ALL_ENTERED, NOTHING_OPTIONAL, { ...NOTHING_OPTIONAL, membersLoaded: false }, { ...NOTHING_OPTIONAL, aiReady: false }]) {
    for (const row of buildStatusRows(input)) {
      assert(known.has(row.stage),
        `rows: ${row.key} reports a state from the shared set (${row.stage})`);
    }
  }

  const everythingOn = buildStatusRows(ALL_ENTERED);
  assert(everythingOn.every((r) => r.stage === "working" || r.stage === "available"),
    "rows: with everything configured no row claims a problem");
  assert(everythingOn.filter((r) => r.key !== "members").every((r) => r.stage === "available"),
    "rows: a configured extra is 'available', never 'working' - no live request was made here");

  const optionalOff = buildStatusRows(NOTHING_OPTIONAL);
  for (const key of ["microsoft", "google", "search", "email"]) {
    const row = optionalOff.find((r) => r.key === key);
    assert(row?.stage === "not-configured", `rows: ${key} is 'not set up', which is the truth`);
    assert(row?.state === "optional_off", `rows: ${key} stays optional, so it never fails the health check`);
  }
  assert(statusIsHealthy(optionalOff), "health: four unconnected extras still mean a healthy system");

  const noMembers = buildStatusRows({ ...NOTHING_OPTIONAL, membersLoaded: false });
  assert(noMembers.find((r) => r.key === "members")?.stage === "problems",
    "rows: a failed member read is a real problem, not a configuration gap");
  assert(!statusIsHealthy(noMembers), "health: a failed member read is unhealthy");
  assert(noMembers.find((r) => r.key === "ai")?.stage === "available",
    "rows: one problem does not change what the other rows report");

  const noAi = buildStatusRows({ ...NOTHING_OPTIONAL, aiReady: false });
  const aiRow = noAi.find((r) => r.key === "ai");
  assert(aiRow?.stage === "unavailable", "rows: a missing AI provider is 'temporarily unavailable', not 'not set up'");
  assert(aiRow?.state === "attention" && !statusIsHealthy(noAi),
    "rows: a missing AI provider IS a member-facing problem, so it stays unhealthy");

  section("owner vocabulary: the screens render the shared words, not their own");

  const statusPage = readFileSync("src/app/owner/status/page.tsx", "utf8");
  assert(/stateLabel\(/.test(statusPage) && /stateTone\(/.test(statusPage) && /stateExplanation\(/.test(statusPage),
    "status page: labels, colours and explanations all come from the shared vocabulary");
  assert(!/"needs attention"|"not set up"|: "working"/.test(statusPage.replace(/^\s*\*.*$/gm, "")),
    "status page: no hand-written state words left in the rendered markup");
  assert(/What these words mean/.test(statusPage),
    "status page: the states are explained on the page, so a state is never a bare colour");
  assert(/row\.stage/.test(statusPage) && !/row\.state ===/.test(statusPage),
    "status page: the row renders the shared state, not the old three-way ternary");

  const aiPage = readFileSync("src/app/owner/ai-providers/page.tsx", "utf8");
  assert(/stateLabel\(/.test(aiPage) && /stateTone\(/.test(aiPage),
    "AI providers page: uses the same words as the other pages");
  assert(!/\{row\.on \? "working" : "not set up"\}/.test(aiPage),
    "AI providers page: no longer calls a configured key 'working'");

  const catalog = readFileSync("src/lib/owner/feature-catalog.ts", "utf8");
  assert(/export const FEATURE_STATE_ORDER/.test(catalog) && /export function stateTone/.test(catalog),
    "vocabulary: the order and the tone live in one module, so a second page cannot invent its own");

  const statusLib = readFileSync("src/lib/owner-status.ts", "utf8");
  assert(/stage: FeatureState/.test(statusLib),
    "status rows: the shared state is a typed field, not a string a page formats itself");
  assert(/state: StatusState/.test(statusLib),
    "status rows: the existing health arithmetic is preserved alongside it");
}
