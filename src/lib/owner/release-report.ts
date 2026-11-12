/**
 * WHERE THE OWNER'S RELEASE RESULT COMES FROM (2026-11-11).
 *
 * One reader, used by the release-readiness page and by the overview's action list, so the two
 * cannot disagree about whether the release checks passed.
 *
 * Two sources, in order:
 *   1. SOPHIRA_RELEASE_REPORT, so a release process can hand a fresh report to a deployment
 *      without rebuilding it;
 *   2. docs/release-gate-report.json, written by `npm run release:report`.
 *
 * If neither exists the answer is "no report", which the caller must render as unknown. It is
 * never an empty pass.
 *
 * Server-only: reads a file from the deployment.
 */

import { readFileSync } from "fs";
import { join } from "path";

export const RELEASE_REPORT_ENV = "SOPHIRA_RELEASE_REPORT";
export const RELEASE_REPORT_PATH = ["docs", "release-gate-report.json"];

export interface ReleaseReportSource {
  text: string | null;
  /** Plain description of where the text came from, or why there is none. */
  source: string;
}

export function readReleaseReport(env: NodeJS.ProcessEnv = process.env): ReleaseReportSource {
  const fromEnv = (env[RELEASE_REPORT_ENV] ?? "").trim();
  if (fromEnv) return { text: fromEnv, source: "handed to this deployment by its release process" };
  try {
    const file = join(process.cwd(), ...RELEASE_REPORT_PATH);
    return { text: readFileSync(file, "utf8"), source: "stored with this deployment" };
  } catch {
    return { text: null, source: "not stored with this deployment" };
  }
}
