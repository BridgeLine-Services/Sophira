/**
 * Offline subsystem — local model registry v2 (TIERS, 2026-10-06).
 *
 * Every entry is a REAL quantized instruct model served ONNX through
 * @huggingface/transformers (WASM in the browser, WASM/CPU in Node; WebGPU
 * where the device supports it). Everything below was VERIFIED against the
 * HF hub on 2026-10-06 (repo exists, ungated, ONNX weights present, sizes
 * summed from the file manifest):
 *
 *   TIER 1 — PHONE / LIGHTWEIGHT
 *     SmolLM2 135M Instruct  (apache-2.0, ~139 MB)
 *     SmolLM2 360M Instruct  (apache-2.0, ~395 MB)
 *   TIER 2 — PHONE/PERFORMANCE + LAPTOP (1B–4B where device resources permit)
 *     Qwen2.5 0.5B Instruct  (apache-2.0, ~519 MB)
 *     Qwen2.5 1.5B Instruct  (apache-2.0, ~1.6 GB)
 *     Qwen3 1.7B             (apache-2.0, ~2.2 GB q4)
 *   TIER 3 — LAPTOP/DESKTOP (4B–12B quantized where hardware permits)
 *     Qwen3 4B Instruct 2507 (apache-2.0, ~4.0 GB q4, sharded)
 *
 * Honesty rules (unchanged):
 *  - `revision` is an IMMUTABLE commit SHA — never "main", never "latest".
 *    A model update is a new registry entry with a new SHA (rollback-safe).
 *  - approxSizeMB/minRAMMB are shown BEFORE any download; the manager
 *    refuses to start one without explicit confirmation.
 *  - A model is only "ready" after weights are downloaded AND a real local
 *    inference probe succeeds (see ModelManager).
 *  - Gemma-family candidates (incl. onnx-community/gemma-3-270m-it-ONNX,
 *    verified ungated on the hub) are NOT in the default registry: their
 *    license is the Gemma Terms of Use, not a standard OSS license — an
 *    owner decision, not an agent one. Documented in docs/OFFLINE_MODELS.md.
 */

export type DeviceTier = "phone" | "laptop" | "desktop";

export interface LocalModelSpec {
  id: string;
  label: string;
  /** registry version of this entry (bumped when the entry changes) */
  version: string;
  /** transformers.js model id (ONNX-ready repo on the HF hub) */
  hfRepo: string;
  /** IMMUTABLE pinned commit SHA — updates are a new entry, never "main" */
  revision: string;
  license: string;
  params: string;
  quantization: string;
  /** approximate download size in MB (shown to the user BEFORE download) */
  approxSizeMB: number;
  /** minimum free RAM for usable inference (shown BEFORE download) */
  minRAMMB: number;
  /** model's documented context window (tokens) — display data, not load-bearing */
  contextSize: number;
  /** platforms this entry has been verified for */
  platforms: string[];
  /** runtime used for inference */
  runtime: string;
  /** honest capability notes */
  capabilities: string[];
  /** honest limitations, shown before download */
  limitations: string;
  notes: string;
  /** device tier this model is intended for (shown in the recommendation UI) */
  tier: DeviceTier;
  /** 2026-06 tier system label */
  tierLabel: "TIER 1: PHONE/LIGHTWEIGHT" | "TIER 2: PHONE/PERFORMANCE + LAPTOP" | "TIER 3: LAPTOP/DESKTOP";
}

export const LOCAL_MODELS: LocalModelSpec[] = [
  {
    id: "smollm2-135m-instruct",
    label: "SmolLM2 135M Instruct (quantized)",
    version: "SmolLM2-135M-Instruct @ hub commit 12fd25f",
    hfRepo: "HuggingFaceTB/SmolLM2-135M-Instruct",
    revision: "12fd25f77366fa6b3b4b768ec3050bf629380bac",
    license: "apache-2.0",
    params: "135M",
    quantization: "ONNX int8 (model_quantized.onnx)",
    approxSizeMB: 139,
    minRAMMB: 800,
    contextSize: 8192,
    platforms: ["browser-PWA (WASM)", "Android-PWA", "iOS-PWA", "desktop (Node/WASM)"],
    runtime: "transformers.js + onnxruntime (WASM; WebGPU when available)",
    capabilities: ["short writing assistance", "rewrites", "basic generation", "short explanations"],
    limitations:
      "Small-model quality: short, sometimes shallow or repetitive answers; weakest math and reasoning of all tiers. English-focused training.",
    notes:
      "The honest minimum tier — usable on almost any phone or laptop. A real model, but far below remote-model quality.",
    tier: "phone",
    tierLabel: "TIER 1: PHONE/LIGHTWEIGHT",
  },
  {
    id: "smollm2-360m-instruct",
    label: "SmolLM2 360M Instruct (quantized)",
    version: "SmolLM2-360M-Instruct @ hub commit fe7c7db",
    hfRepo: "onnx-community/SmolLM2-360M-Instruct-ONNX",
    revision: "fe7c7db4c8921c9e3fa1c65cfd296fb3b1b1a8f9",
    license: "apache-2.0",
    params: "360M",
    quantization: "ONNX q4 (onnx/model_q4.onnx)",
    approxSizeMB: 395,
    minRAMMB: 1500,
    contextSize: 8192,
    platforms: ["browser-PWA (WASM)", "Android-PWA", "iOS-PWA", "desktop (Node/WASM)"],
    runtime: "transformers.js + onnxruntime (WASM; WebGPU when available)",
    capabilities: ["writing assistance", "rewrites", "generation", "short structured explanations"],
    limitations:
      "Meaningfully better than 135M but still small-model quality; math and long reasoning remain weak. English-focused training.",
    notes:
      "Verified ungated on the hub (2026-10-06). A good lightweight-plus option when the 135M tier feels too weak but the device is modest.",
    tier: "phone",
    tierLabel: "TIER 1: PHONE/LIGHTWEIGHT",
  },
  {
    id: "qwen25-05b-instruct",
    label: "Qwen2.5 0.5B Instruct (quantized)",
    version: "Qwen2.5-0.5B-Instruct @ hub commit cc5cc01",
    hfRepo: "onnx-community/Qwen2.5-0.5B-Instruct",
    revision: "cc5cc01a65cc3ff17bdb73a7de33d879f62599b0",
    license: "apache-2.0",
    params: "0.5B",
    quantization: "ONNX int8 (onnx/model_quantized.onnx)",
    approxSizeMB: 519,
    minRAMMB: 2200,
    contextSize: 32768,
    platforms: ["browser-PWA (WASM)", "Android-PWA", "desktop (Node/WASM)"],
    runtime: "transformers.js + onnxruntime (WASM; WebGPU when available)",
    capabilities: ["writing assistance", "rewrites", "generation", "math word-problem setup", "longer context"],
    limitations:
      "Small-model quality; multi-step math and factual accuracy are unreliable. Slower than the SmolLM2 tier on weak phones.",
    notes:
      "Better quality than the SmolLM2 tier at the cost of a larger download and more RAM. Recommended for phones with 2+ GB free RAM.",
    tier: "phone",
    tierLabel: "TIER 1: PHONE/LIGHTWEIGHT",
  },
  {
    id: "qwen25-15b-instruct",
    label: "Qwen2.5 1.5B Instruct (quantized)",
    version: "Qwen2.5-1.5B-Instruct @ hub commit 6287331",
    hfRepo: "onnx-community/Qwen2.5-1.5B-Instruct",
    revision: "6287331f475a3e20e8c879be8fd4bf3551ad9d34",
    license: "apache-2.0",
    params: "1.5B",
    quantization: "ONNX int8 (onnx/model_quantized.onnx)",
    approxSizeMB: 1586,
    minRAMMB: 4500,
    contextSize: 32768,
    platforms: ["browser-PWA (WASM)", "desktop (Node/WASM)", "high-end phones (WebGPU)"],
    runtime: "transformers.js + onnxruntime (WASM; WebGPU when available)",
    capabilities: [
      "meaningful writing assistance",
      "rewriting and drafting",
      "longer structured explanations",
      "math word-problem setup",
      "study-guide style generation",
    ],
    limitations:
      "Small-model quality: expect clear drafts but shallow analysis and occasional factual errors. Answers are always stamped LOCAL MODEL.",
    notes:
      "The tier-2 workhorse: substantially better writing and reasoning than the 0.5B tier. ~1.6 GB download, ~4.5 GB RAM.",
    tier: "laptop",
    tierLabel: "TIER 2: PHONE/PERFORMANCE + LAPTOP",
  },
  {
    // Verified 2026-10-06: ungated, q4 ONNX present, apache-2.0 base license
    // (Qwen/Qwen3-1.7B). Newer generation than Qwen2.5 at the same size.
    id: "qwen3-17b",
    label: "Qwen3 1.7B (q4)",
    version: "Qwen3-1.7B @ hub commit cc6a06a",
    hfRepo: "onnx-community/Qwen3-1.7B-ONNX",
    revision: "cc6a06a21d614e9b8e92a6adfab1074d4e7d2438",
    license: "apache-2.0",
    params: "1.7B",
    quantization: "ONNX q4 (onnx/model_q4.onnx)",
    approxSizeMB: 2156,
    minRAMMB: 6000,
    contextSize: 32768,
    platforms: ["browser-PWA (WASM)", "desktop (Node/WASM)", "high-end phones (WebGPU)"],
    runtime: "transformers.js + onnxruntime (WASM; WebGPU when available)",
    capabilities: [
      "strongest tier-2 writing assistance",
      "structured explanations",
      "math word-problem setup",
      "study-guide style generation",
    ],
    limitations:
      "Qwen3 thinking mode may emit <think> sections on some prompts (the engine strips them but generation is slower); small-model quality still applies — shallow analysis and occasional factual errors.",
    notes:
      "The newest 1–4B-class model verified on the hub: better quality than Qwen2.5 1.5B. ~2.2 GB download, ~6 GB RAM.",
    tier: "laptop",
    tierLabel: "TIER 2: PHONE/PERFORMANCE + LAPTOP",
  },
  {
    // Verified 2026-10-06: ungated, q4 ONNX present (sharded external-data
    // files), apache-2.0 base license (Qwen/Qwen3-4B-Instruct-2507).
    id: "qwen3-4b-2507",
    label: "Qwen3 4B Instruct 2507 (q4)",
    version: "Qwen3-4B-Instruct-2507 @ hub commit 41a4dd4",
    hfRepo: "onnx-community/Qwen3-4B-Instruct-2507-ONNX",
    revision: "41a4dd4d147229f83043afb98a4d4c803b8bfcbb",
    license: "apache-2.0",
    params: "4B",
    quantization: "ONNX q4, sharded (onnx/model_q4.onnx + external data)",
    approxSizeMB: 3971,
    minRAMMB: 10000,
    contextSize: 262144,
    platforms: ["desktop (Node/WASM)", "browser-PWA (WASM; WebGPU strongly recommended)"],
    runtime: "transformers.js + onnxruntime (WASM; WebGPU when available)",
    capabilities: [
      "strongest local model verified for Sophira",
      "genuine multi-step drafting",
      "structured explanations",
      "long-context material handling (documented 262k window; practical local use is far shorter)",
    ],
    limitations:
      "Desktop-class hardware only: ~4 GB download, ~10 GB RAM recommended. Slow on WASM without WebGPU; small-model caveats still apply versus remote frontier models. The 2507 release does not emit <think> sections.",
    notes:
      "The strongest offline model Sophira can honestly offer today (4B–12B class, q4). Intended for laptops/desktops with strong hardware; the UI never recommends it for low-RAM devices.",
    tier: "desktop",
    tierLabel: "TIER 3: LAPTOP/DESKTOP",
  },
];

/**
 * Device profile → LOW/MEDIUM/HIGH resource class + recommended model.
 * The recommendation is a STARTING POINT, never an automatic download,
 * and the user can always override it (the model picker is the override).
 */
export type ResourceClass = "LOW RESOURCE" | "MEDIUM RESOURCE" | "HIGH RESOURCE";

export interface DeviceRecommendation {
  modelId: string;
  reason: string;
  resourceClass: ResourceClass;
  /** LOW → lightweight, MEDIUM → medium, HIGH → strongest supported */
  policy: "Use lightweight model." | "Use medium model." | "Use strongest supported model.";
}

export function recommendModelForDevice(device: {
  ramGB: number;
  webgpu: boolean;
  freeDiskGB?: number;
}): DeviceRecommendation {
  const ram = device.ramGB;
  if (ram >= 8 && (device.freeDiskGB === undefined || device.freeDiskGB >= 4.2) && device.webgpu) {
    return {
      modelId: "qwen3-4b-2507",
      resourceClass: "HIGH RESOURCE",
      policy: "Use strongest supported model.",
      reason: `This device reports ~${ram} GB RAM and WebGPU — enough for the 4B tier (${LOCAL_MODELS.find((m) => m.id === "qwen3-4b-2507")?.label}). Still small-model quality; nothing downloads without your consent.`,
    };
  }
  if (ram >= 4 && (device.freeDiskGB === undefined || device.freeDiskGB >= 2.3)) {
    return {
      modelId: "qwen25-15b-instruct",
      resourceClass: "MEDIUM RESOURCE",
      policy: "Use medium model.",
      reason: `This device reports ~${ram} GB RAM — comfortable for the 1.5B tier. WebGPU or ${device.webgpu ? "" : "more RAM"} would be needed for the 4B tier.`,
    };
  }
  if (ram >= 2.2) {
    return {
      modelId: "qwen25-05b-instruct",
      resourceClass: "MEDIUM RESOURCE",
      policy: "Use medium model.",
      reason: "This device reports enough RAM for the 0.5B tier, but not the 1.5B tier.",
    };
  }
  return {
    modelId: "smollm2-135m-instruct",
    resourceClass: "LOW RESOURCE",
    policy: "Use lightweight model.",
    reason: `This device reports limited RAM (~${ram} GB) — the 135M tier is the honest fit; expect short, shallow answers.`,
  };
}

export function findModel(id: string): LocalModelSpec | null {
  return LOCAL_MODELS.find((m) => m.id === id) ?? null;
}

/** Registry invariants, machine-checked by the test suite. */
export function registryInvariants(): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  for (const m of LOCAL_MODELS) {
    if (!/^[0-9a-f]{40}$/.test(m.revision)) problems.push(`${m.id}: revision is not a 40-char immutable SHA`);
    if (!m.license) problems.push(`${m.id}: license not recorded`);
    if (!m.quantization) problems.push(`${m.id}: quantization not recorded`);
    if (!m.contextSize) problems.push(`${m.id}: context size not recorded`);
    if (!m.limitations) problems.push(`${m.id}: limitations not recorded`);
    if (!m.approxSizeMB || !m.minRAMMB) problems.push(`${m.id}: size/RAM estimate missing`);
    if (m.platforms.length === 0 || !m.runtime) problems.push(`${m.id}: platforms/runtime missing`);
  }
  return { ok: problems.length === 0, problems };
}
