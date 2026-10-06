/**
 * Offline subsystem — transformers.js loader.
 *
 * Why a custom loader: onnxruntime-web (transformers.js' engine) references
 * WASM/WebGPU assets in ways webpack cannot statically analyze, so bundling
 * it into a Next.js client build fails. The two environments therefore load
 * the SAME pinned library through two channels:
 *
 *   Node (test suite, native runtimes):
 *     plain require of the pinned npm package — no bundler involved.
 *     `eval("require")` keeps any bundler from tracing the import.
 *
 *   Browser:
 *     native dynamic import of the pinned jsdelivr ESM build, with
 *     /* webpackIgnore: true * / so webpack leaves the import alone and the
 *     app bundle stays small.
 *
 * Honest limitation (documented in docs/OFFLINE_ARCHITECTURE.md): the first
 * use of offline AI in a browser session needs the network ONCE to fetch the
 * inference library from the CDN (models themselves are cached on-device
 * after their consented download). After that first load, inference runs
 * entirely on-device; with no network at all, a fresh browser session
 * reports this honestly instead of failing silently.
 */

export interface TransformersApi {
  pipeline: (task: string, model: string, options?: unknown) => Promise<unknown>;
  env: Record<string, unknown>;
}

/** Pinned in package.json; kept in sync so Node and browser run identical code. */
const TRANSFORMERS_VERSION = "4.3.0";
const CDN_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_VERSION}`;

export async function loadTransformers(): Promise<TransformersApi> {
  if (typeof window === "undefined") {
    // Node: eval keeps webpack from tracing onnxruntime-node's binaries
    const req = eval("require") as (id: string) => unknown;
    return req("@huggingface/transformers") as TransformersApi;
  }
  try {
    const mod = (await import(/* webpackIgnore: true */ CDN_URL)) as unknown as TransformersApi;
    return mod;
  } catch (e) {
    // A fresh browser session that has never been online cannot fetch the
    // library. Fail with an honest, actionable message — never a fake result.
    throw new Error(
      `offline AI needs a one-time online initialization to fetch the inference ` +
      `library (~a few MB, from ${CDN_URL}); after that it runs on-device. ` +
      `Original error: ${(e as Error).message}`
    );
  }
}
