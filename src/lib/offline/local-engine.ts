/**
 * Offline subsystem — local inference engine (STEP 5).
 *
 * Runs a REAL quantized small language model on-device through
 * @huggingface/transformers. Requests are NEVER sent to any server while
 * in offline mode — the engine only touches the locally cached model
 * blobs. Every response carries a provenance stamp:
 *
 *   { origin: "local", model: "<repo>", latencyMs }
 *
 * so the UI can always show WHERE an answer came from. The online AI path
 * (src/lib/ai/client.ts) is untouched; offline responses come only from
 * here.
 */

import type { LocalModelSpec } from "./model-registry";
import { findModel } from "./model-registry";

export interface AiProvenance {
  origin: "local" | "remote";
  model: string;
  /** ms spent generating (local) or round-trip (remote) */
  latencyMs: number;
  generatedOffline: boolean;
}

export interface LocalInferenceResult {
  text: string;
  provenance: AiProvenance;
}

interface PipelineApi {
  __call(args: unknown, options?: unknown): Promise<unknown>;
}

interface TransformersApi {
  pipeline: (task: string, model: string, options?: unknown) => Promise<unknown>;
  env: Record<string, unknown>;
}

/** Lazily load transformers.js only when a local model is actually used. */
async function getTransformers(): Promise<TransformersApi> {
  const mod = (await import("@huggingface/transformers")) as unknown as TransformersApi;
  return mod;
}

export class LocalInferenceEngine {
  private pipelines = new Map<string, PipelineApi>();

  async loadPipeline(spec: LocalModelSpec): Promise<PipelineApi> {
    const cached = this.pipelines.get(spec.id);
    if (cached) return cached;
    const t = await getTransformers();
    const pipe = (await t.pipeline("text-generation", spec.hfRepo, {
      dtype: "q8",
    })) as PipelineApi;
    this.pipelines.set(spec.id, pipe);
    return pipe;
  }

  /** Is a model loaded and generating entirely on-device? */
  isLoaded(modelId: string): boolean {
    return this.pipelines.has(modelId);
  }

  async generate(modelId: string, prompt: string, opts?: { maxNewTokens?: number }): Promise<LocalInferenceResult> {
    const spec = findModel(modelId);
    if (!spec) throw new Error(`local-engine: unknown model ${modelId}`);
    const pipe = await this.loadPipeline(spec);
    const started = Date.now();
    const out = (await pipe.__call([
      { role: "system", content: "You are Sophira's offline writing and study assistant. Be concise and helpful." },
      { role: "user", content: prompt },
    ],
    { max_new_tokens: opts?.maxNewTokens ?? 256, do_sample: false }
    )) as Array<{ generated_text: string | Array<{ role: string; content: string }> }>;
    const first = out?.[0];
    let text = "";
    if (typeof first?.generated_text === "string") {
      text = first.generated_text;
    } else if (Array.isArray(first?.generated_text)) {
      // chat format: take the final assistant turn
      const turns = first.generated_text as Array<{ role: string; content: string }>;
      text = [...turns].reverse().find((t) => t.role === "assistant")?.content ?? "";
    }
    // strip the echoed prompt if a base-style model echoed it
    const echoed = text.indexOf(prompt.trim());
    if (echoed === 0) text = text.slice(prompt.trim().length).trim();
    return {
      text: text.trim(),
      provenance: {
        origin: "local",
        model: spec.hfRepo,
        latencyMs: Date.now() - started,
        generatedOffline: true,
      },
    };
  }

  unloadAll(): void {
    this.pipelines.clear();
  }
}
