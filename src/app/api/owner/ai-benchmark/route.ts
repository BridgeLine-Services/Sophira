import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/supabase/guard";
import { readAiEnv, resolveProviders, selfhostChat } from "@/lib/ai/provider";
import {
  BENCH_TASKS,
  NOT_CONFIGURED_DETAIL,
  scoreAnswer,
  summariseBenchmark,
  type BenchRun,
} from "@/lib/ai/benchmark";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/owner/ai-benchmark — measures the SELF-HOSTED model (Phase 2, 2026-11-13).
 *
 * Why this exists: "the server is reachable" is not "the model is any good". This runs the
 * four checks in lib/ai/benchmark.ts against the configured self-hosted model and reports
 * what happened in the same six states the rest of the owner's dashboard uses.
 *
 * Deliberate limits:
 *  - OWNER ONLY, and it never touches a member's data: the four prompts are fixed and
 *    contain no one's coursework.
 *  - It only ever calls the SELF-HOSTED model. A cloud provider is never called to
 *    "check" the local one, so pressing this cannot spend money or leak a member's work
 *    to a third party.
 *  - Unconfigured is an ANSWER, not an error: no model server means "not configured",
 *    with the reason, and a 200 so the screen can say so calmly.
 *  - A failure is reported per task in plain language. No stack trace, no URL, no key.
 */
export async function POST() {
  const supabase = createClient();
  const guard = await requireOwner(supabase);
  if (!guard.ok) return guard.response;

  const env = readAiEnv();
  const plan = resolveProviders(env);

  if (!plan.candidates.includes("selfhost")) {
    return NextResponse.json({
      state: "not-configured",
      headline: "No local model to measure",
      detail: NOT_CONFIGURED_DETAIL,
      reason: plan.reasons.selfhost || plan.reasons.local || "",
      runs: [],
    });
  }

  const runs: BenchRun[] = [];
  for (const task of BENCH_TASKS) {
    const started = Date.now();
    try {
      const res = await selfhostChat(
        env,
        [
          { role: "system", content: task.system },
          { role: "user", content: task.prompt },
        ],
        { maxTokens: task.maxTokens, temperature: 0.2 },
      );
      const ms = Date.now() - started;
      runs.push({
        id: task.id,
        ms,
        check: scoreAnswer(task.id, res.text),
        tokens: typeof res.tokensOut === "number" ? res.tokensOut : null,
      });
    } catch (err) {
      const ms = Date.now() - started;
      // The provider layer already writes plain, credential-free messages; trim any
      // stray newlines so a screen renders one sentence.
      const raw = err instanceof Error ? err.message : "The request failed.";
      const failure = raw.split("\n")[0].slice(0, 240);
      runs.push({ id: task.id, ms, check: null, failure });
      // One dead server should not cost four timeouts: stop asking.
      if (/unreachable|ECONNREFUSED|abort|timed out|fetch failed/i.test(failure)) break;
    }
  }

  const summary = summariseBenchmark(runs);
  return NextResponse.json({
    state: summary.state,
    headline: summary.headline,
    detail: summary.detail,
    measured: summary.measured,
    passed: summary.passed,
    tasks: summary.tasks,
    median_ms: summary.medianMs,
    slowest_ms: summary.slowestMs,
    runs: runs.map((r) => ({
      id: r.id,
      label: BENCH_TASKS.find((t) => t.id === r.id)?.label ?? r.id,
      ms: r.ms,
      passed: r.check ? r.check.passed : null,
      note: r.check ? r.check.note : r.failure || "No answer.",
    })),
  });
}
