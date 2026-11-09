import { readFileSync } from "fs";
import path from "path";
import {
  CircuitRegistry,
  BreakerOpenError,
  breakerKey,
  describeBreaker,
  errorCodeOf,
  withBreaker,
} from "../src/lib/ai/reliability";
import { EVAL_CASES, compareReports, runEvalSuite, scoreAnswer, verdictFor } from "../src/lib/ai/eval";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

export async function runAiReliabilityTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) {
      passed++;
      console.log("  ✓ " + name);
    } else {
      failed++;
      console.log("  ✗ " + name);
    }
  };
  const section = (name: string) => console.log("\n" + name);

  section("ai reliability: breaker opens on repeated failure");

  let clock = 1_000_000;
  const registry = new CircuitRegistry({ failureThreshold: 3, cooldownMs: 60_000, resetAfterMs: 600_000 }, () => clock);

  assert(registry.canAttempt("local").allowed, "reliability: a fresh breaker allows the first attempt");
  assert(registry.canAttempt("local").state === "closed", "reliability: a fresh breaker is closed");
  registry.recordFailure("local", "timeout");
  registry.recordFailure("local", "timeout");
  assert(registry.canAttempt("local").allowed, "reliability: two failures do not open a three-strike breaker");
  registry.recordFailure("local", "timeout");
  const opened = registry.canAttempt("local");
  assert(!opened.allowed && opened.state === "open", "reliability: the third consecutive failure opens the breaker");
  assert((opened.msUntilTrial ?? 0) > 0, "reliability: an open breaker reports the real wait before retrial");

  section("ai reliability: half-open is a single trial");

  clock += 61_000;
  const gated = registry.canAttempt("local");
  assert(gated.allowed && gated.trial && gated.state === "half-open",
    "reliability: after the cooldown exactly one trial request is allowed");
  registry.markTrialStarted("local");
  const during = registry.canAttempt("local");
  assert(!during.allowed && during.state === "half-open",
    "reliability: while the trial is in flight no second request reaches a dead server");
  registry.recordFailure("local", "unreachable");
  const afterFail = registry.canAttempt("local");
  assert(!afterFail.allowed && afterFail.state === "open", "reliability: a failed trial re-opens the breaker");

  clock += 61_000;
  registry.markTrialStarted("local");
  registry.recordSuccess("local");
  const healed = registry.canAttempt("local");
  assert(healed.allowed && healed.state === "closed" && !healed.trial,
    "reliability: a successful trial closes the breaker fully");

  section("ai reliability: failures spread over time are not consecutive");

  let t2 = 0;
  const slow = new CircuitRegistry({ failureThreshold: 2, cooldownMs: 1000, resetAfterMs: 5000 }, () => t2);
  slow.recordFailure("x");
  t2 += 10_000; // far longer than resetAfterMs
  slow.recordFailure("x");
  assert(slow.canAttempt("x").allowed,
    "reliability: a failure ten minutes after the last one does not count as consecutive");
  t2 += 10;
  slow.recordFailure("x");
  assert(!slow.canAttempt("x").allowed, "reliability: two failures close together do open the breaker");

  section("ai reliability: withBreaker accounting");

  let t3 = 0;
  const reg2 = new CircuitRegistry({ failureThreshold: 2, cooldownMs: 30_000 }, () => t3);
  const okValue = await withBreaker(reg2, "p", async () => "answer");
  assert(okValue === "answer", "reliability: a successful call returns its value unchanged");
  assert(reg2.snapshot("p").totalSuccesses === 1, "reliability: the success is counted");
  await withBreaker(reg2, "p", async () => {
    throw new Error("ECONNREFUSED");
  }).catch(() => undefined);
  assert(reg2.snapshot("p").lastErrorCode === "unreachable", "reliability: a connection refusal is classified as unreachable");
  await withBreaker(reg2, "p", async () => {
    throw new Error("boom");
  }).catch(() => undefined);
  let threw: unknown = null;
  try {
    await withBreaker(reg2, "p", async () => "should not run");
  } catch (e) {
    threw = e;
  }
  assert(threw instanceof BreakerOpenError, "reliability: an open breaker throws instead of attempting the call");
  const skipped = await withBreaker(reg2, "other", async () => "separate");
  assert(skipped === "separate", "reliability: one provider's breaker never blocks another provider");

  section("ai reliability: health wording is honest");

  const fresh = describeBreaker(new CircuitRegistry().snapshot("local"));
  assert(fresh.plainEnglish.includes("nothing has been sent"), "reliability: an untried provider is not called healthy");
  assert(fresh.ok, "reliability: an untried provider is still usable");

  const openReg = new CircuitRegistry({ failureThreshold: 1, cooldownMs: 120_000 }, () => 0);
  openReg.recordFailure("local", "timeout");
  const openHealth = describeBreaker(openReg.snapshot("local"));
  assert(!openHealth.ok && openHealth.plainEnglish.includes("Not responding"),
    "reliability: an open breaker is described as not responding");
  assert(openHealth.plainEnglish.includes("seconds"), "reliability: the owner is told when it will retry");

  const flaky = new CircuitRegistry({ failureThreshold: 5 }, () => 0);
  flaky.recordFailure("g", "rate_limited");
  flaky.recordSuccess("g");
  const flakyHealth = describeBreaker(flaky.snapshot("g"));
  assert(flakyHealth.ok && flakyHealth.plainEnglish.includes("earlier failure"),
    "reliability: a provider working again is described as answering, with the recent failure noted");

  section("ai reliability: error classification");

  assert(errorCodeOf(new Error("The operation was aborted")) === "timeout", "reliability: an abort is a timeout");
  assert(errorCodeOf(new Error("fetch failed")) === "unreachable", "reliability: a failed fetch is unreachable");
  assert(errorCodeOf(new Error("429 Too Many Requests")) === "rate_limited", "reliability: a quota reply is rate_limited");
  assert(errorCodeOf(new Error("401 unauthorised")) === "unauthorized", "reliability: an auth failure is distinguished");
  assert(errorCodeOf(new Error("503 Service Unavailable")) === "server_error", "reliability: a 5xx is a server error");
  assert(errorCodeOf("something odd") === "unknown", "reliability: an unrecognised error stays unknown instead of being guessed");

  section("ai reliability: breaker keys are per endpoint");

  assert(breakerKey("selfhost", "http://127.0.0.1:11434") === "selfhost@127.0.0.1:11434",
    "reliability: the breaker key includes the endpoint host");
  assert(breakerKey("selfhost", null) === "selfhost", "reliability: a provider without an endpoint uses the bare key");
  assert(breakerKey("selfhost", "not a url") === "selfhost", "reliability: an unparseable endpoint degrades safely");

  section("ai reliability: provider chain is wired, policy untouched");

  const providerSrc = read("src/lib/ai/provider.ts");
  assert(providerSrc.includes("withBreaker(aiBreakers"), "reliability: the real provider calls run through the breaker");
  assert(providerSrc.includes("const plan = resolveProviders(env)"),
    "reliability: the candidate list still comes from the existing policy resolver");
  assert(!providerSrc.includes("aiBreakers.recordSuccess(\"openai\")"),
    "reliability: the breaker never forces a paid provider into the chain");

  section("model eval: scoring is mechanical, not self-graded");

  const grounded = EVAL_CASES.find((c) => c.kind === "grounded")!;
  assert(scoreAnswer(grounded, "It has four phases: prophase, metaphase, anaphase, telophase.").passed,
    "eval: a correct grounded answer passes");
  assert(!scoreAnswer(grounded, "It has several phases.").passed, "eval: a vague grounded answer fails");

  const refusal = EVAL_CASES.find((c) => c.kind === "refusal")!;
  assert(scoreAnswer(refusal, "The source does not say anything about that.").passed,
    "eval: a refusal to invent passes");
  const fabricated = scoreAnswer(refusal, "Students are expelled immediately for plagiarism.");
  assert(!fabricated.passed && fabricated.reason.includes("fabrication"),
    "eval: answering an unsupported question fails and is named as fabrication risk");

  const json = EVAL_CASES.find((c) => c.kind === "json")!;
  assert(scoreAnswer(json, '{"topic":"mitosis","phases":4}').passed, "eval: valid JSON with the keys passes");
  assert(scoreAnswer(json, '```json\n{"topic":"mitosis","phases":4}\n```').passed, "eval: a fenced JSON answer is accepted");
  assert(!scoreAnswer(json, '{"topic":"mitosis"}').passed, "eval: missing required keys fails");
  assert(!scoreAnswer(json, "Mitosis has four phases.").passed, "eval: prose where JSON was required fails");

  const citation = EVAL_CASES.find((c) => c.kind === "citation")!;
  assert(scoreAnswer(citation, "Checkpoints prevent damaged cells dividing [source].").passed,
    "eval: a real citation passes");
  assert(!scoreAnswer(citation, "Checkpoints prevent damage [textbook p.42].").passed,
    "eval: an invented citation fails");
  assert(!scoreAnswer(citation, "Checkpoints exist.").passed, "eval: a missing citation fails");
  assert(!scoreAnswer(grounded, "   ").empty === false, "eval: an empty answer is flagged as empty");

  section("model eval: reports and comparison");

  const goodModel = async (prompt: string) => {
    if (prompt.includes("academic dishonesty")) return "The source does not say.";
    if (prompt.includes("Return ONLY JSON")) return '{"topic":"mitosis","phases":4}';
    if (prompt.includes("Quote the sentence")) return "Checkpoints prevent damaged cells from dividing [source].";
    return "Mitosis has four phases: prophase, metaphase, anaphase, telophase.";
  };
  const report = await runEvalSuite("test-model", goodModel);
  assert(report.total === EVAL_CASES.length, "eval: the whole fixed suite runs");
  assert(report.score === 1 && report.passed === report.total, "eval: a correct model scores 100%");
  assert(report.verdict.includes("Passed every check"), "eval: a perfect score gets a plain-English verdict");

  const badModel = async (prompt: string) => {
    if (prompt.includes("academic dishonesty")) return "Students are expelled for plagiarism.";
    return "";
  };
  const bad = await runEvalSuite("bad-model", badModel);
  assert(bad.score < 0.5, "eval: a model that fabricates and returns nothing scores badly");
  assert(bad.outcomes.some((o) => o.emptyAnswer), "eval: empty answers are recorded as empty");
  const thrown = await runEvalSuite("throwing-model", async () => {
    throw new Error("ECONNREFUSED");
  });
  assert(thrown.score === 0 && thrown.outcomes[0].reason.includes("threw"),
    "eval: a provider that cannot be reached is recorded as a failure, not a pass");

  const comparison = compareReports([report, bad]);
  assert(comparison.rows.length === 2, "eval: comparison covers every candidate");
  assert(comparison.recommendation.includes("test-model"), "eval: the better model is recommended");
  assert(comparison.recommendation.includes("could not support"),
    "eval: a fabrication failure is called out ahead of the score");
  assert(compareReports([]).recommendation.includes("no candidate"),
    "eval: comparing nothing says so instead of inventing a winner");
  assert(verdictFor({ score: 1, meanLatencyMs: 9000, total: 4 }).includes("slowly"),
    "eval: a slow but correct model is described honestly");

  section("model eval: owner health route");

  const routeSrc = read("src/app/api/owner/ai-health/route.ts");
  assert(routeSrc.includes('profile?.role !== "owner"'), "health: the AI health route is owner-only");
  assert(routeSrc.includes("describeBreaker("), "health: the route reports real breaker state, not an assumption");
  assert(!routeSrc.includes("apiKey") && !routeSrc.includes("API_KEY"), "health: no key material is ever returned");
  assert(routeSrc.includes("plan.candidates"), "health: the route reports the real provider policy, not a guess");
  assert(!routeSrc.includes("aiChat("), "health: opening the health page never spends a token");

  return { passed, failed };
}
