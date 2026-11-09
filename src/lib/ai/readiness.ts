/**
 * Phase 1 — self-hosted AI readiness (pure sizing and verdict logic).
 *
 * The question this answers is the one that decides whether Sophira can run
 * with no cloud bill: "is the machine we have actually able to serve this
 * model, and how will it feel?" It answers from MEASURED numbers only. When
 * nothing has been measured it says "unknown" rather than guessing.
 *
 * Sizing rules used below are the standard practical ones for 4-bit and 8-bit
 * quantized inference: roughly 0.6 GB per billion parameters at 4-bit and
 * 1.1 GB at 8-bit, plus a fixed context/runtime overhead. They are estimates and
 * are labelled as estimates everywhere they appear.
 */

export interface ModelSize {
  paramsBillions: number;
  /** 4 = Q4_K_M style, 8 = Q8/FP8 style, 16 = FP16. */
  bits: 4 | 8 | 16;
}

export interface HardwareFacts {
  /** GB of RAM the inference process may use. */
  availableRamGb: number | null;
  /** True when a GPU is present and visible to the server. */
  hasGpu: boolean | null;
  /** Measured generation speed, tokens per second, from a real request. */
  tokensPerSecond: number | null;
  /** Measured first-token latency in ms. */
  firstTokenMs: number | null;
}

export function estimateMemoryGb(model: ModelSize): number {
  const bytesPerParam = (model.bits / 8) * 1.0;
  const weights = model.paramsBillions * bytesPerParam;
  // KV cache + runtime overhead; grows with size but never below ~1 GB.
  const overhead = Math.max(1, model.paramsBillions * 0.15);
  return Math.round((weights + overhead) * 10) / 10;
}

/** Parses "llama3.1:8b", "qwen2.5:14b", "mistral:7b-instruct-q4_K_M" into a size. */
export function parseModelSize(modelName: string): ModelSize | null {
  const lower = modelName.toLowerCase();
  const match = lower.match(/(\d+(?:\.\d+)?)\s*b(?![a-z0-9])/);
  if (!match) return null;
  const params = Number(match[1]);
  if (!Number.isFinite(params) || params <= 0 || params > 2000) return null;
  let bits: ModelSize["bits"] = 4;
  if (/q8|fp8|int8/.test(lower)) bits = 8;
  else if (/fp16|f16/.test(lower)) bits = 16;
  return { paramsBillions: params, bits };
}

export type ReadinessLevel = "ready" | "usable" | "too-slow" | "insufficient-memory" | "unknown";

export interface ReadinessVerdict {
  level: ReadinessLevel;
  headline: string;
  detail: string;
  estimatedMemoryGb: number | null;
  /** What to do next, or null when nothing is needed. */
  action: string | null;
}

/**
 * Verdict from measurements. Ordering matters: memory that cannot hold the
 * model is a hard stop, speed is a comfort issue, and no measurements means
 * unknown - never "ready".
 */
export function assessReadiness(input: {
  modelName: string | null;
  hardware: HardwareFacts;
}): ReadinessVerdict {
  const size = input.modelName ? parseModelSize(input.modelName) : null;
  const estimated = size ? estimateMemoryGb(size) : null;
  const { availableRamGb, tokensPerSecond, firstTokenMs } = input.hardware;

  if (estimated !== null && availableRamGb !== null && estimated > availableRamGb) {
    return {
      level: "insufficient-memory",
      headline: "The machine cannot hold this model",
      detail: `${input.modelName} needs roughly ${estimated} GB of memory and about ${availableRamGb} GB is available. This is an estimate, but the gap is large enough to matter.`,
      estimatedMemoryGb: estimated,
      action:
        "Either run a smaller model (a 7-8B model at 4-bit usually fits in 8 GB), or give the inference server more memory. Until then Sophira will use the next configured provider.",
    };
  }

  if (tokensPerSecond === null) {
    return {
      level: "unknown",
      headline: "Not measured yet",
      detail:
        "No generation has been timed on this machine, so Sophira cannot say how it will feel. Run the readiness check to measure it.",
      estimatedMemoryGb: estimated,
      action: "Run the readiness check from the owner tools.",
    };
  }

  if (tokensPerSecond < 4) {
    return {
      level: "too-slow",
      headline: "Too slow to answer live",
      detail: `Measured ${tokensPerSecond.toFixed(1)} tokens per second. At that speed a paragraph takes over a minute, which is not usable for a chat answer.`,
      estimatedMemoryGb: estimated,
      action:
        "Use a smaller model, or keep this one for background work only (summaries, notes) and let a faster provider answer students directly.",
    };
  }

  if (tokensPerSecond < 12 || (firstTokenMs !== null && firstTokenMs > 6000)) {
    const latency = firstTokenMs !== null ? `, first word after ${Math.round(firstTokenMs / 1000)}s` : "";
    return {
      level: "usable",
      headline: "Works, but feels slow",
      detail: `Measured ${tokensPerSecond.toFixed(1)} tokens per second${latency}. Answers arrive, but a student will notice the wait.`,
      estimatedMemoryGb: estimated,
      action: "Fine for drafts and notes. Consider a smaller model if chatting feels sluggish.",
    };
  }

  return {
    level: "ready",
    headline: "Ready to answer",
    detail: `Measured ${tokensPerSecond.toFixed(1)} tokens per second${
      firstTokenMs !== null ? `, first word after ${Math.round(firstTokenMs)} ms` : ""
    }.${estimated !== null ? ` The model needs about ${estimated} GB of memory (estimate).` : ""}`,
    estimatedMemoryGb: estimated,
    action: null,
  };
}

/** Suggested model for a machine, when the owner asks what to run. */
export function suggestModel(availableRamGb: number, hasGpu = false): { model: string; reason: string } {
  const candidates: { params: number; name: string }[] = [
    { params: 3, name: "llama3.2:3b" },
    { params: 7, name: "llama3.1:8b" },
    { params: 14, name: "qwen2.5:14b" },
    { params: 32, name: "qwen2.5:32b" },
    { params: 70, name: "llama3.3:70b" },
  ];
  let chosen = candidates[0];
  for (const c of candidates) {
    const need = estimateMemoryGb({ paramsBillions: c.params, bits: 4 });
    if (need <= availableRamGb * 0.8) chosen = c;
  }
  const gpuNote = hasGpu ? "A GPU is available, so the larger option should keep up." : "No GPU was detected, so speed comes from the CPU; a smaller model feels better.";
  return {
    model: chosen.name,
    reason: `With about ${availableRamGb} GB to work with, ${chosen.name} at 4-bit needs roughly ${estimateMemoryGb({
      paramsBillions: chosen.params,
      bits: 4,
    })} GB. ${gpuNote}`,
  };
}

/** Turns a probe failure into words the owner can act on. */
export function probeFailureReason(raw: { status?: number; message?: string }): string {
  const status = raw.status ?? 0;
  const message = (raw.message ?? "").toLowerCase();
  if (status === 401 || status === 403) return "The local server rejected the request. If it needs an API key, check LOCAL_LLM_API_KEY.";
  if (status === 404) return "The local server answered but not at the expected path. Check that LOCAL_LLM_BASE_URL points at the server root (for example http://127.0.0.1:11434).";
  if (status === 429) return "The local server is rate-limiting requests. Wait a moment, or raise its concurrency limit.";
  if (message.includes("econnrefused") || message.includes("fetch failed")) {
    return "Nothing is listening at that address. The model server is probably not running.";
  }
  if (message.includes("abort") || message.includes("timeout")) return "The local server did not answer in time. It may be loading the model into memory.";
  if (status >= 500) return "The local server reported an internal error. Its own logs will say why.";
  return "The local server could not be reached for an unknown reason.";
}
