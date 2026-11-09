import { readFileSync } from "fs";
import path from "path";
import {
  assessReadiness,
  estimateMemoryGb,
  parseModelSize,
  probeFailureReason,
  suggestModel,
} from "../src/lib/ai/readiness";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

export async function runAiReadinessTests(): Promise<{ passed: number; failed: number }> {
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

  section("ai readiness: model size parsing");

  assert(parseModelSize("llama3.1:8b")?.paramsBillions === 8, "readiness: an 8b tag is read as 8 billion parameters");
  assert(parseModelSize("qwen2.5:14b-instruct")?.paramsBillions === 14, "readiness: a suffix after the size is tolerated");
  assert(parseModelSize("mistral:7b-instruct-q4_K_M")?.bits === 4, "readiness: a q4 tag is 4-bit");
  assert(parseModelSize("llama3.1:8b-q8_0")?.bits === 8, "readiness: a q8 tag is 8-bit");
  assert(parseModelSize("llama3.1:8b-fp16")?.bits === 16, "readiness: an fp16 tag is 16-bit");
  assert(parseModelSize("some-model-fp16") === null, "readiness: a precision tag without a size is not a size");
  assert(parseModelSize("llama3.1:8b")?.bits === 4, "readiness: an untagged model is assumed 4-bit, the common default");
  assert(parseModelSize("gpt-4o") === null, "readiness: a name with no size is not guessed at");
  assert(parseModelSize("model:9999b") === null, "readiness: an absurd size is refused rather than used");
  assert(parseModelSize("model:0b") === null, "readiness: a zero size is refused");

  section("ai readiness: memory estimates");

  const small = estimateMemoryGb({ paramsBillions: 8, bits: 4 });
  const large = estimateMemoryGb({ paramsBillions: 70, bits: 4 });
  assert(small > 4 && small < 8, "readiness: an 8B 4-bit model lands in the expected 4-8 GB range");
  assert(large > small, "readiness: a bigger model needs more memory");
  assert(estimateMemoryGb({ paramsBillions: 8, bits: 8 }) > small, "readiness: 8-bit needs more than 4-bit for the same model");
  assert(estimateMemoryGb({ paramsBillions: 8, bits: 16 }) > estimateMemoryGb({ paramsBillions: 8, bits: 8 }),
    "readiness: 16-bit needs the most");

  section("ai readiness: verdicts never overstate");

  const unknown = assessReadiness({ modelName: "llama3.1:8b", hardware: { availableRamGb: 16, hasGpu: false, tokensPerSecond: null, firstTokenMs: null } });
  assert(unknown.level === "unknown", "readiness: an unmeasured machine is 'unknown', never 'ready'");
  assert(unknown.action !== null, "readiness: an unknown verdict tells the owner what to do next");

  const tooSmall = assessReadiness({ modelName: "llama3.3:70b", hardware: { availableRamGb: 8, hasGpu: false, tokensPerSecond: 20, firstTokenMs: 500 } });
  assert(tooSmall.level === "insufficient-memory", "readiness: a model that cannot fit is a hard stop even if speed looks fine");
  assert(tooSmall.detail.includes("GB") && tooSmall.action !== null, "readiness: the memory verdict gives real numbers and a next step");
  assert(tooSmall.detail.includes("estimate"), "readiness: the memory figure is labelled an estimate");

  const slow = assessReadiness({ modelName: "llama3.1:8b", hardware: { availableRamGb: 16, hasGpu: false, tokensPerSecond: 2.4, firstTokenMs: 9000 } });
  assert(slow.level === "too-slow", "readiness: under 4 tokens per second is called too slow");
  assert(slow.headline.includes("Too slow"), "readiness: the slow verdict is stated plainly");

  const usable = assessReadiness({ modelName: "llama3.1:8b", hardware: { availableRamGb: 16, hasGpu: false, tokensPerSecond: 8, firstTokenMs: 1200 } });
  assert(usable.level === "usable", "readiness: 8 tokens per second is usable but not fast");

  const slowStart = assessReadiness({ modelName: "llama3.1:8b", hardware: { availableRamGb: 16, hasGpu: true, tokensPerSecond: 30, firstTokenMs: 9000 } });
  assert(slowStart.level === "usable", "readiness: a very slow first word downgrades a fast model");

  const ready = assessReadiness({ modelName: "llama3.1:8b", hardware: { availableRamGb: 16, hasGpu: true, tokensPerSecond: 42, firstTokenMs: 300 } });
  assert(ready.level === "ready", "readiness: a fast, fitting model is 'ready'");
  assert(ready.action === null, "readiness: a ready verdict does not invent an action");
  assert(ready.detail.includes("42.0"), "readiness: the measured speed is quoted back exactly");

  const noName = assessReadiness({ modelName: null, hardware: { availableRamGb: 8, hasGpu: null, tokensPerSecond: 15, firstTokenMs: 800 } });
  assert(noName.level === "ready" && noName.estimatedMemoryGb === null,
    "readiness: an unnamed model is judged on speed alone, with no invented memory figure");

  section("ai readiness: model suggestion");

  const modest = suggestModel(8, false);
  assert(modest.model === "llama3.1:8b", "readiness: 8 GB is matched with an 8B model");
  assert(modest.reason.includes("No GPU"), "readiness: the suggestion says what the machine is missing");
  const tiny = suggestModel(4, false);
  assert(tiny.model === "llama3.2:3b", "readiness: 4 GB is matched with a 3B model");
  const beefy = suggestModel(64, true);
  assert(beefy.model === "llama3.3:70b" || beefy.model === "qwen2.5:32b",
    "readiness: a large machine is offered a large model");
  assert(beefy.reason.includes("GPU"), "readiness: a GPU changes the advice and says so");

  section("ai readiness: failure wording");

  assert(probeFailureReason({ status: 401 }).includes("LOCAL_LLM_API_KEY"), "readiness: an auth rejection names the key variable");
  assert(probeFailureReason({ status: 404 }).includes("LOCAL_LLM_BASE_URL"), "readiness: a wrong path names the URL variable");
  assert(probeFailureReason({ message: "fetch failed" }).includes("not running"), "readiness: a refused connection says the server is not running");
  assert(probeFailureReason({ message: "aborted" }).includes("loading"), "readiness: a timeout mentions model loading");
  assert(probeFailureReason({ status: 500 }).includes("logs"), "readiness: a server error points at its own logs");
  assert(probeFailureReason({}).includes("unknown"), "readiness: an unexplained failure stays unexplained");

  section("ai readiness: routes are honest and cost-aware");

  const readinessSrc = read("src/app/api/owner/ai-readiness/route.ts");
  assert(readinessSrc.includes('profile?.role !== "owner"'), "readiness: the readiness route is owner-only");
  assert(readinessSrc.includes("maxTokens: 24"), "readiness: the timing probe is capped at a tiny generation");
  assert(readinessSrc.includes("nothing to measure") || readinessSrc.includes("No local model server is configured"),
    "readiness: an unconfigured server is reported instead of probed");
  assert(readinessSrc.includes("treat it as approximate"), "readiness: measured speed is labelled approximate");
  assert(!readinessSrc.includes("LOCAL_LLM_BASE_URL!”"), "readiness: the full endpoint is not echoed back");
  assert(readinessSrc.includes("safeHost("), "readiness: only the endpoint host is reported");
  assert(readinessSrc.includes("export async function GET"), "readiness: there is a zero-cost way to ask first");

  const evalSrc = read("src/app/api/owner/ai-eval/route.ts");
  assert(evalSrc.includes('profile?.role !== "owner"'), "eval route: owner-only");
  assert(evalSrc.includes("maxTokens: 300"), "eval route: each case is capped so a check cannot run up a bill");
  assert(evalSrc.includes("temperature: 0"), "eval route: runs are comparable because temperature is zero");
  assert(evalSrc.includes("runEvalSuite("), "eval route: the same fixed suite from the tested module is used");
  assert(evalSrc.includes("aiConfigured()"), "eval route: it refuses honestly when no provider is configured");
  assert(evalSrc.includes("providerProblem"), "eval route: a provider failure is reported, not hidden");
  assert(!evalSrc.includes("console.log("), "eval route: model output is never logged");

  return { passed, failed };
}
