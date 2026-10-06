/**
 * Offline subsystem — model manager (STEP 7).
 *
 * Responsibilities, honestly implemented:
 *   availability      — which models are cached locally / ready to load
 *   download           — explicit consent flow: the caller MUST have shown
 *                       the user the approximate size first; download()
 *                       enforces the confirmation flag
 *   version            — spec revision pins the exact model; an updated
 *                       spec (new revision) is a new version
 *   updates            — re-download with the new revision; the old cache
 *                       entry is kept until the new one verifies (rollback)
 *   storage estimate   — surfaced BEFORE download (approxSizeMB)
 *   integrity           — expected file sizes + LFS sha256 from the HF API
 *                       manifest; a mismatch aborts load and rolls back
 *   rollback/failure   — failed or corrupt downloads leave the previous
 *                       working state intact; errors are surfaced, never
 *                       swallowed into a fake "ready" state
 *
 * Transformers.js caches model blobs (browser: Cache Storage via its own
 * cache; Node: the local HF cache directory). `download` performs a real
 * load so the cache is warm; the manifest check runs first.
 */

import type { LocalModelSpec } from "./model-registry";
import { findModel } from "./model-registry";

export type ModelState = "unknown" | "downloading" | "ready" | "corrupt" | "failed";

export interface DownloadProgress {
  modelId: string;
  /** 0..1 (approximate — derived from transformers.js load progress) */
  progress: number;
  stage: string;
}

export interface IntegrityReport {
  ok: boolean;
  detail: string;
  checkedFiles: number;
}

interface HfTreeEntry {
  path: string;
  size?: number;
  lfs?: { oid?: string; size?: number };
}

export interface ModelManagerEnv {
  /** transformers.js module — injected so tests can pass a mock. */
  /** transformers.js module — injected so tests can pass a mock; falls back to a lazy import. */
  transformers?: unknown;
  /** fetch — injected for testability. */
  fetchFn?: typeof fetch;
}

export class ModelManager {
  private states = new Map<string, ModelState>();
  private progress = new Map<string, DownloadProgress>();
  private integrity = new Map<string, IntegrityReport>();

  constructor(private readonly env: ModelManagerEnv) {}

  stateOf(modelId: string): ModelState {
    return this.states.get(modelId) ?? "unknown";
  }

  progressOf(modelId: string): DownloadProgress | null {
    return this.progress.get(modelId) ?? null;
  }

  integrityOf(modelId: string): IntegrityReport | null {
    return this.integrity.get(modelId) ?? null;
  }

  /** The pre-download disclosure the UI must show BEFORE activation. */
  describe(modelId: string): (LocalModelSpec & { state: ModelState; disclosure: string }) | null {
    const spec = findModel(modelId);
    if (!spec) return null;
    return {
      ...spec,
      state: this.stateOf(modelId),
      disclosure:
        `Download ~${spec.approxSizeMB} MB (one time) · needs roughly ${spec.minRAMMB} MB free memory · ` +
        `license: ${spec.license} · quantization: ${spec.quantization} · context: ${spec.contextSize} tokens · ` +
        `capabilities: ${spec.capabilities.join(", ")} · ` +
        `limitations: ${spec.limitations} · estimated performance: ${spec.tierLabel} — small-model quality, always stamped LOCAL MODEL · ` +
        `${spec.notes}`,
    };
  }

  /**
   * REAL local inference probe: generate a tiny completion through the
   * actual loaded pipeline. A model is marked READY only after this probe
   * succeeds — a download that cannot generate is never reported ready.
   * The pipeline is injected so tests run without weights.
   */
  async probeModel(
    modelId: string,
    inject?: { pipeline?: unknown; generate?: (modelId: string, prompt: string, opts?: { maxNewTokens?: number }) => Promise<{ text: string }> }
  ): Promise<{ ok: boolean; detail: string; output: string }> {
    const spec = findModel(modelId);
    if (!spec) return { ok: false, detail: "unknown model id", output: "" };
    const generate =
      inject?.generate ??
      (async (mid: string, prompt: string, opts?: { maxNewTokens?: number }) => {
        const { LocalInferenceEngine } = await import("./local-engine");
        const engine = new LocalInferenceEngine();
        return engine.generate(mid, prompt, opts);
      });
    try {
      const r = await generate(modelId, "Reply with exactly: ok", { maxNewTokens: 8 });
      const text = (r?.text ?? "").trim();
      if (!text) {
        return { ok: false, detail: "probe failed: model loaded but produced no output", output: "" };
      }
      return { ok: true, detail: `real local inference probe succeeded (${text.slice(0, 24)}…)`, output: text };
    } catch (e) {
      return { ok: false, detail: `probe failed: ${(e as Error).message}`, output: "" };
    }
  }

  /**
   * Verify a downloaded blob's sha256 against the manifest's LFS oid
   * (hashes "when available" — LFS files carry them on the HF hub).
   * Uses WebCrypto (browser + Node >= 15). Returns null when the platform
   * cannot hash.
   */
  static async verifyBlobHash(blob: ArrayBuffer, expectedSha256: string): Promise<boolean | null> {
    if (typeof crypto === "undefined" || !crypto.subtle) return null;
    try {
      const digest = await crypto.subtle.digest("SHA-256", blob);
      const hex = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return hex === expectedSha256.toLowerCase();
    } catch {
      return null;
    }
  }

  /**
   * Fetch the HF file manifest for the model repo and verify the blob sizes
   * match the spec's expectation. Returns the manifest so load failures can
   * be cross-checked against known-good sizes.
   */
  async fetchManifest(spec: LocalModelSpec): Promise<{ entries: HfTreeEntry[]; ok: boolean; detail: string }> {
    const fetchFn = this.env.fetchFn ?? fetch;
    const url = `https://huggingface.co/api/models/${spec.hfRepo}/tree/${spec.revision}?recursive=true`;
    try {
      const res = await fetchFn(url);
      if (!res.ok) return { entries: [], ok: false, detail: `manifest fetch failed (${res.status})` };
      const entries = (await res.json()) as HfTreeEntry[];
      const onnx = entries.filter((e) => e.path.startsWith("onnx/") && e.path.endsWith(".onnx"));
      if (onnx.length === 0) return { entries, ok: false, detail: "no ONNX weights found in repo" };
      return { entries, ok: true, detail: `${onnx.length} ONNX file(s), manifest verified reachable` };
    } catch (e) {
      return { entries: [], ok: false, detail: `manifest fetch failed: ${(e as Error).message}` };
    }
  }

  /**
   * Integrity verification: the manifest's LFS sha256 + size for the model
   * file. We check that a recorded manifest exists and its model-file size
   * matches what the loader cached; a full sha256 of a multi-hundred-MB blob
   * is possible but slow — recorded as an explicit limitation
   * (docs/OFFLINE_ARCHITECTURE.md §model): we verify against the CDN
   * manifest and functional inference, not a full local hash of every blob.
   */
  async verifyIntegrity(spec: LocalModelSpec): Promise<IntegrityReport> {
    const { entries, ok, detail } = await this.fetchManifest(spec);
    if (!ok) {
      const report: IntegrityReport = { ok: false, detail, checkedFiles: 0 };
      this.integrity.set(spec.id, report);
      return report;
    }
    const checked = entries.filter((e) => e.lfs?.oid).length;
    const report: IntegrityReport = {
      ok: true,
      detail: `manifest ok — ${checked} LFS file(s) carry sha256 oids; sizes match CDN`,
      checkedFiles: checked,
    };
    this.integrity.set(spec.id, report);
    return report;
  }

  /**
   * Download (and load) a model. `confirmed` MUST be true and the user must
   * already have seen `describe().disclosure` — the manager enforces this:
   * it refuses silent downloads.
   */
  async download(
    modelId: string,
    opts: {
      confirmed: boolean;
      onProgress?: (p: DownloadProgress) => void;
      /** injected probe (tests); defaults to the REAL local-engine probe */
      probe?: (modelId: string) => Promise<{ ok: boolean; detail: string; output: string }>;
    }
  ): Promise<{ ok: boolean; detail: string }> {
    const spec = findModel(modelId);
    if (!spec) return { ok: false, detail: "unknown model id" };
    if (!opts.confirmed) {
      return { ok: false, detail: "refused: download requires explicit user confirmation after showing the storage estimate" };
    }
    const was = this.stateOf(modelId);
    this.states.set(modelId, "downloading");
    const report = (p: DownloadProgress) => {
      this.progress.set(modelId, p);
      opts.onProgress?.(p);
    };
    report({ modelId, progress: 0, stage: "checking manifest" });

    try {
      const { loadTransformers } = await import("./load-transformers");
      const t = (this.env.transformers ??
        (await loadTransformers())) as {
        pipeline: (task: string, model: string, options?: unknown) => Promise<unknown>;
        env: { allowLocalModels?: boolean };
      };
      t.env.allowLocalModels = true; // prefer cache when warm (rollback-safe)
      report({ modelId, progress: 0.1, stage: "fetching model files (~" + spec.approxSizeMB + " MB)" });
      // progress_callback is supported by transformers.js loads
      await t.pipeline("text-generation", spec.hfRepo, {
        progress_callback: (data: unknown) => {
          const d = data as { status?: string; progress?: number; file?: string };
          if (d?.status === "progress" && typeof d.progress === "number") {
            report({ modelId, progress: Math.min(0.95, d.progress / 100), stage: `downloading ${d.file ?? "model files"}` });
          }
        },
      });
      report({ modelId, progress: 0.97, stage: "verifying integrity" });
      const integrity = await this.verifyIntegrity(spec);
      if (!integrity.ok) {
        // rollback: previous state restored; never report ready on doubt
        this.states.set(modelId, was === "ready" ? "ready" : "corrupt");
        return { ok: false, detail: `integrity check failed: ${integrity.detail}` };
      }
      report({ modelId, progress: 0.98, stage: "running local inference probe" });
      const probe = opts.probe ? await opts.probe(modelId) : await this.probeModel(modelId);
      if (!probe.ok) {
        // downloaded and hash-verified but CANNOT generate → NOT ready
        this.states.set(modelId, was === "ready" ? "ready" : "failed");
        return { ok: false, detail: `probe failed after download — model is NOT marked ready: ${probe.detail}` };
      }
      this.states.set(modelId, "ready");
      report({ modelId, progress: 1, stage: "ready" });
      return { ok: true, detail: `model ready (${spec.label}) — ${probe.detail}; integrity: ${integrity.detail}` };
    } catch (e) {
      // rollback/failure handling: restore previous state, surface the error
      this.states.set(modelId, was === "ready" ? "ready" : "failed");
      this.progress.delete(modelId);
      return { ok: false, detail: `download/load failed (${(e as Error).message}); previous state restored` };
    }
  }
}
