/**
 * SELF-HOSTED MODEL BENCHMARK (Phase 2, 2026-11-13).
 *
 * The architecture says the local model is the primary engine. Until now the only thing
 * checked was that a server was listening (provider.ts selfhostRuntime) — which says nothing
 * about whether the model can explain, show working, return parseable structure, or refuse to
 * invent a fact. These tests pin the scoring, because a benchmark that passes a wrong answer is
 * worse than no benchmark: it would tell the owner their model is fine when it is not.
 *
 * Every check is exercised from both sides: a correct answer passes, and the specific failure
 * the check exists to catch fails.
 */
import { readFileSync } from "fs";
import {
  BENCH_TASKS,
  NOT_CONFIGURED_DETAIL,
  scoreAnswer,
  summariseBenchmark,
  type BenchRun,
} from "../src/lib/ai/benchmark";

type Assert = (cond: boolean, msg: string) => void;

export function runModelBenchmarkTests(assert: Assert, section: (name: string) => void) {
  const route = readFileSync("src/app/api/owner/ai-benchmark/route.ts", "utf8");
  const ui = readFileSync("src/components/app/ModelCheck.tsx", "utf8");
  const page = readFileSync("src/app/owner/ai-providers/page.tsx", "utf8");

  section("model benchmark: four capabilities, no overlap");

  assert(BENCH_TASKS.length === 4, "there are four checks");
  const ids = BENCH_TASKS.map((t) => t.id);
  assert(new Set(ids).size === ids.length, "each check has its own id");
  assert(ids.join(",") === "explain,worked,structured,honesty",
    "the four checks are explaining, working, structure and honesty");
  for (const t of BENCH_TASKS) {
    assert(t.prompt.length > 20 && t.system.length > 10, `${t.id} has a real system prompt and question`);
    assert(t.maxTokens > 0 && t.maxTokens <= 400, `${t.id} keeps a small token budget`);
    assert(t.proves.length > 20, `${t.id} says what it proves`);
  }
  assert(BENCH_TASKS.every((t) => !/\b(grade|email|course|coursework)\b/i.test(t.prompt) || t.id === "honesty"),
    "no check sends a member's own work to the model");

  section("model benchmark: a right answer passes");

  const goodExplain = scoreAnswer("explain",
    "A derivative measures how fast something changes at one exact moment. Imagine a car's speedometer: the position changes over time, and the derivative is the reading at that instant. It turns a curve into the slope at a single point.");
  assert(goodExplain.passed, "a real explanation passes");

  const goodWorked = scoreAnswer("worked",
    "3x + 5 = 20. Subtract 5 from both sides: 3x = 15. Divide both sides by 3: x = 5.");
  assert(goodWorked.passed, "correct working and answer pass");

  const goodJson = scoreAnswer("structured", '{"difficulty": "medium", "minutes": 45}');
  assert(goodJson.passed, "valid JSON with both keys passes");
  const fencedJson = scoreAnswer("structured", '```json\n{"difficulty":"easy","minutes":20}\n```');
  assert(fencedJson.passed, "a fenced reply is tolerated, because real models add fences");

  const goodHonesty = scoreAnswer("honesty",
    "I cannot know your grade in advance. It depends on the exam itself and how your teacher marks it, so nobody can give you a percentage before you sit it.");
  assert(goodHonesty.passed, "saying the grade cannot be known passes");

  section("model benchmark: a plausible wrong answer fails");

  // THE point of this file: these read fine but are wrong, and must not pass.
  const shortExplain = scoreAnswer("explain", "It measures change.");
  assert(!shortExplain.passed, "a five-word fragment is not an explanation that mentions change");
  const offTopicExplain = scoreAnswer("explain",
    "Integrals are the area under a curve and they are used in physics to find distance travelled when you know speed over time, which is a very common exam question you should practise before Friday.");
  assert(!offTopicExplain.passed, "a long answer about integrals is not an explanation of a derivative");

  const wrongAnswer = scoreAnswer("worked", "Subtract 5: 3x = 15, then add 3: x = 18.");
  assert(!wrongAnswer.passed, "a wrong final answer fails");
  const answerWithoutWork = scoreAnswer("worked", "The answer is x = 5.");
  assert(!answerWithoutWork.passed, "the right answer with no working fails");

  const proseJson = scoreAnswer("structured", "The problem set is medium difficulty and should take around 45 minutes.");
  assert(!proseJson.passed, "prose that describes the data is not usable structure");
  const badEnum = scoreAnswer("structured", '{"difficulty": "quite hard", "minutes": 45}');
  assert(!badEnum.passed, "an invented difficulty value fails");
  const badMinutes = scoreAnswer("structured", '{"difficulty": "easy", "minutes": "about an hour"}');
  assert(!badMinutes.passed, "a non-numeric minutes value fails");
  const extraKeys = scoreAnswer("structured",
    '{"difficulty":"easy","minutes":30,"reasoning":"because","confidence":0.9}');
  assert(!extraKeys.passed, "extra keys beyond the two asked for fail");

  const invented = scoreAnswer("honesty", "You will get 87% on tomorrow's exam.");
  assert(!invented.passed, "an invented grade percentage fails, even though it reads well");
  const inventedWithHedge = scoreAnswer("honesty", "I cannot know, but realistically you will get around 80%.");
  assert(!inventedWithHedge.passed, "a hedge followed by an invented number still fails");
  const evasive = scoreAnswer("honesty", "Study hard and you will do well. Good luck with it!");
  assert(!evasive.passed, "changing the subject is not the honesty we need");

  const empty = scoreAnswer("explain", "   ");
  assert(!empty.passed && empty.note.includes("nothing"), "an empty answer fails with a plain reason");
  assert(!scoreAnswer("nonsense-task", "hello").passed, "an unknown task fails instead of silently passing");

  section("model benchmark: the summary tells the truth about a half-working model");

  const runs = (specs: { id: string; pass: boolean | null; ms: number }[]): BenchRun[] =>
    specs.map((s) => ({
      id: s.id,
      ms: s.ms,
      check: s.pass === null ? null : { id: s.id, passed: s.pass, note: s.pass ? "ok" : "failed the check" },
      ...(s.pass === null ? { failure: "The local inference server unreachable." } : {}),
    }));

  const allGood = summariseBenchmark(runs([
    { id: "explain", pass: true, ms: 1200 },
    { id: "worked", pass: true, ms: 1400 },
    { id: "structured", pass: true, ms: 800 },
    { id: "honesty", pass: true, ms: 1000 },
  ]));
  assert(allGood.state === "working", "all passing reads as working");
  assert(allGood.measured && allGood.medianMs === 1100, "the median answer time is reported, not the mean");
  assert(allGood.headline.includes("4"), "the headline says how many checks passed");

  const halfWorking = summariseBenchmark(runs([
    { id: "explain", pass: true, ms: 900 },
    { id: "worked", pass: false, ms: 900 },
    { id: "structured", pass: true, ms: 900 },
    { id: "honesty", pass: true, ms: 900 },
  ]));
  assert(halfWorking.state === "problems", "one failure reads as problems, never as working");
  assert(halfWorking.headline.includes("1 of 4"), "the headline names the count that failed");
  assert(halfWorking.detail.includes("failed the check"), "the detail says which check failed");

  const nobodyAnswered = summariseBenchmark(runs([
    { id: "explain", pass: null, ms: 30 },
  ]));
  assert(nobodyAnswered.state === "unavailable", "a dead server reads as unavailable");
  assert(!nobodyAnswered.measured && nobodyAnswered.medianMs === null,
    "nothing measured means null, never a fake 0 ms");
  assert(nobodyAnswered.detail.includes("unreachable"), "the reason is passed through in plain words");

  const nothingRan = summariseBenchmark([]);
  assert(nothingRan.state === "not-implemented", "no runs reads as nothing measured, not as working");
  assert(!nothingRan.measured, "no runs is never reported as measured");

  const partial = summariseBenchmark(runs([
    { id: "explain", pass: true, ms: 500 },
    { id: "worked", pass: null, ms: 40 },
  ]));
  assert(partial.state === "problems" && partial.answered === 1 && partial.tasks === 2,
    "a partial run counts what answered, and still reads as problems");

  section("model benchmark: the owner's button is honest and safe");

  assert(route.includes("requireOwner"), "the check is owner-only");
  assert(route.includes("selfhostChat") && !route.includes("geminiChat") && !route.includes("openaiChat"),
    "it calls the self-hosted model only, never a cloud provider");
  assert(NOT_CONFIGURED_DETAIL.length > 40 && route.includes("NOT_CONFIGURED_DETAIL"),
    "a missing model server is answered with the shared plain-language reason");
  assert(route.includes('state: "not-configured"'), "unconfigured is its own state, not an error");
  assert(!/console\.(log|error)/.test(route), "no answer or prompt is written to the logs");
  assert(route.includes("if (/unreachable|ECONNREFUSED|abort|timed out|fetch failed/i.test(failure)) break"),
    "one dead server stops the run instead of four timeouts");
  assert(route.includes("maxDuration"), "the route declares its own time budget");
  assert(/raw\.split\("\\n"\)\[0\]\.slice\(0, 240\)/.test(route),
    "a failure is trimmed to one plain sentence, with no stack trace");

  assert(page.includes("ModelCheck") && page.includes("Can your own model do the work?"),
    "the button is on the AI Providers page under a plain heading");
  assert(ui.includes("/api/owner/ai-benchmark"), "the screen calls the benchmark route");
  assert(ui.includes("Not measured yet."), "before any run the screen says so instead of showing zero");
  assert(ui.replace(/\s+/g, " ").includes("never spends money or sends a member&apos;s work anywhere"),
    "the screen says what the check does not do");
  assert(ui.includes("stateLabel(result.state)") && ui.includes("stateTone(result.state)"),
    "the result uses the same six words and colours as every other readiness row");
  assert(ui.includes("r.passed === true") && ui.includes("r.passed === false") && ui.includes("No answer"),
    "a request that failed renders as no answer, never as a tick");
}
