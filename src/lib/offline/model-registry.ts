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
      "Better quality than 135M at the cost of a ~400 MB download and more RAM. Recommended for laptops/desktops.",
  },
];

export function findModel(id: string): LocalModelSpec | null {
  return LOCAL_MODELS.find((m) => m.id === id) ?? null;
}

/** A tiny test model for pipeline verification (tests only, ~2 MB). */
export const PIPELINE_PROBE_MODEL = "hf-internal-testing/tiny-random-LlamaForCausalLM";
