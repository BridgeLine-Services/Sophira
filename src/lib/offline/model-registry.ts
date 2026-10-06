/**
 * Offline subsystem — local model registry (STEP 5 + STEP 7).
 *
 * Every entry is a REAL quantized small language model served ONNX through
 * @huggingface/transformers (WASM in the browser, WASM/CPU in Node; WebGPU
 * where the device supports it). Sizes are approximate download figures
 * that MUST be shown to the user BEFORE a download starts — the manager
 * refuses to start one without an explicit confirmation.
 */

export interface LocalModelSpec {
  id: string;
  label: string;
  /** transformers.js model id (ONNX-ready repo on the HF hub) */
  hfRepo: string;
  /** pinned revision — updates change this, enabling version/rollback */
  revision: string;
  params: string;
  /** approximate download size in MB (shown to the user BEFORE download) */
  approxSizeMB: number;
  /** minimum free RAM the device should have for usable inference */
  minRAMMB: number;
  /** what this model can reasonably do (honest capability notes) */
  capabilities: string[];
  notes: string;
  /** device tier this model is intended for (shown in the recommendation UI) */
  tier: "phone" | "laptop" | "desktop";
}

export const LOCAL_MODELS: LocalModelSpec[] = [
  {
    id: "smollm2-135m-instruct",
    label: "SmolLM2 135M Instruct (quantized)",
    hfRepo: "HuggingFaceTB/SmolLM2-135M-Instruct",
    revision: "main",
    params: "135M",
    approxSizeMB: 120,
    minRAMMB: 800,
    capabilities: ["short writing assistance", "rewrites", "basic generation", "short explanations"],
    notes:
      "Very small — usable on mid-range phones and any laptop. Expect short, sometimes shallow answers; it is a real model, not a full online-class model.",
    tier: "phone",
  },
  {
    id: "qwen25-05b-instruct",
    label: "Qwen2.5 0.5B Instruct (quantized)",
    hfRepo: "onnx-community/Qwen2.5-0.5B-Instruct",
    revision: "main",
    params: "0.5B",
    approxSizeMB: 400,
    minRAMMB: 2200,
    capabilities: ["writing assistance", "rewrites", "generation", "math word-problem setup", "longer context"],
    notes:
      "Better quality than 135M at the cost of a ~400 MB download and more RAM. Recommended for phones with 2+ GB free RAM or modest laptops.",
    tier: "phone",
  },
  {
    // Verified 2026-10-06: onnx-community/Qwen2.5-1.5B-Instruct exists on the
    // HF hub with a q8-quantized ONNX build (onnx/model_quantized.onnx) and is
    // NOT license-gated. Gemma-family candidates (e.g. gemma-2-2b-it) were
    // investigated and are NOT registered: their repos are license-gated on
    // the hub (HTTP 401 without per-user license acceptance), so Sophira
    // cannot ship them until the owner accepts the license and provides a
    // gated-download token. No ungated 3B+ ONNX instruct model could be
    // verified today, so the desktop tier deliberately has NO entry rather
    // than a fabricated one.
    id: "qwen25-15b-instruct",
    label: "Qwen2.5 1.5B Instruct (quantized)",
    hfRepo: "onnx-community/Qwen2.5-1.5B-Instruct",
    revision: "main",
    params: "1.5B",
    approxSizeMB: 1000,
    minRAMMB: 4500,
    capabilities: [
      "meaningful writing assistance",
      "rewriting and drafting",
      "longer structured explanations",
      "math word-problem setup",
      "study-guide style generation",
    ],
    notes:
      "The strongest local model Sophira can honestly offer today: substantially better writing and reasoning than the 0.5B tier. ~1 GB download, ~4.5 GB RAM; intended for laptops/desktops. Answers are still small-model quality and are always stamped LOCAL MODEL.",
    tier: "laptop",
  },
];

/**
 * Pure device-profile → recommended model (tested). The UI may call this
 * with live browser capabilities; tests pass explicit values. RAM detection
 * in browsers is coarse (deviceMemory caps at 8) — the recommendation is a
 * STARTING POINT with honest caveats, never an automatic download.
 */
export function recommendModelForDevice(device: {
  ramGB: number;
  webgpu: boolean;
  freeDiskGB?: number;
}): { modelId: string; reason: string } {
  const ram = device.ramGB;
  if (ram >= 4 && (device.freeDiskGB === undefined || device.freeDiskGB >= 1.2)) {
    return {
      modelId: "qwen25-15b-instruct",
      reason:
        "This device reports enough RAM (>= 4 GB) for the 1.5B tier — the strongest model Sophira can currently verify and offer offline.",
    };
  }
  if (ram >= 2.2) {
    return {
      modelId: "qwen25-05b-instruct",
      reason: "This device reports enough RAM (>= 2.2 GB) for the 0.5B tier, but not enough for the 1.5B tier.",
    };
  }
  return {
    modelId: "smollm2-135m-instruct",
    reason:
      "This device reports limited RAM (< 2.2 GB) — the 135M tier is the honest fit; expect short, shallow answers.",
  };
}

export function findModel(id: string): LocalModelSpec | null {
  return LOCAL_MODELS.find((m) => m.id === id) ?? null;
}

/** A tiny test model for pipeline verification (tests only, ~2 MB). */
export const PIPELINE_PROBE_MODEL = "hf-internal-testing/tiny-random-LlamaForCausalLM";
