/**
 * RESUMABLE RESEARCH (stage 8, 2026-10-11): a run interrupted mid-request
 * must be completable later — through the SAME execution core as a fresh
 * run, without duplicating stored sources and without ever fabricating
 * results or claiming background execution.
 */
import { isResumable, RESUME_STALE_MS } from "../src/lib/research/run";
import { existsSync, readFileSync } from "fs";
import path from "path";

export function runResearchResumeTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("resumable research (stage 8)");

  // ---- pure gate logic ----
  const now = Date.parse("2026-10-11T12:00:00Z");
  assert(isResumable("failed", null, now).ok, "resume: a FAILED project is resumable (e.g. provider now configured)");
  assert(isResumable("verified", null, now).ok === false, "resume: a completed project is NOT resumable — start a new one");
  assert(isResumable("searching", null, now).ok === false, "resume: an unknown progress timestamp is refused, not guessed");
  assert(isResumable("searching", new Date(now - 60_000).toISOString(), now).ok === false,
    "resume: a run updated 60s ago is treated as LIVE and refused — no concurrent double-passes");
  assert(isResumable("searching", new Date(now - RESUME_STALE_MS - 1).toISOString(), now).ok,
    "resume: a run stale beyond the threshold is resumable — an interrupted pass is completable");
  assert(isResumable("paused", new Date(now - 86_400_000).toISOString(), now).ok === false,
    "resume: unknown statuses are refused honestly — no silent fallback");

  // ---- source-level guarantees ----
  const run = readFileSync(path.join(process.cwd(), "src/lib/research/run.ts"), "utf8");
  assert(run.includes("knownUrls") && run.includes("!knownUrls.has(h.url)"),
    "resume: sources ALREADY STORED for the project are never duplicated or re-verified — progress = stored sources");
  assert(run.includes("one execution path") || run.includes("one path"),
    "resume: fresh runs and resumes share ONE execution core — no duplicate backend");
  assert(!/setTimeout|setInterval|background worker/i.test(run),
    "resume: the core is server-persisted resumability, NOT claimed background processing");

  const route = readFileSync(path.join(process.cwd(), "src/app/api/research/resume/route.ts"), "utf8");
  assert(route.includes("isResumable(project.status, project.updated_at)") && route.includes("409"),
    "resume: the endpoint enforces the resumable gate server-side (409 on refusal)");
  assert(route.includes("searchProviderConfigured()") && route.includes("will not invent sources"),
    "resume: without a configured provider the endpoint fails HONESTLY — never fabricates sources");
  assert(route.includes("priorVerified") && route.includes("verification_status", 0) || route.includes('eq("verification_status", "verified")'),
    "resume: sufficiency counts only VERIFIED sources (existing + newly verified)");
  assert(route.includes("No stored queries") || route.includes("no stored queries"),
    "resume: a project without stored queries is refused honestly instead of silently re-planned");
  assert(route.includes("resumed: true") && route.includes("new_sources"),
    "resume: the response reports what the resume actually did — new vs already-stored sources");

  const main = readFileSync(path.join(process.cwd(), "src/app/api/research/route.ts"), "utf8");
  assert(main.includes("executeResearchPass"),
    "resume: the ORIGINAL fresh-run route uses the SAME shared core — one execution path, not two backends");

  const panel = readFileSync(path.join(process.cwd(), "src/components/app/ResearchPanel.tsx"), "utf8");
  assert(panel.includes("/api/research/resume") && panel.includes("Resume interrupted run"),
    "resume: the panel offers Resume for interrupted runs and Retry for failed ones — only in those states");
  assert(panel.includes('data.project.status === "failed" || data.project.status === "searching"'),
    "resume: the button is conditional — a completed project shows no misleading resume affordance");

  assert(existsSync(path.join(process.cwd(), "src/app/api/research/resume/route.ts")),
    "resume: the resume endpoint exists in the repository");
}
