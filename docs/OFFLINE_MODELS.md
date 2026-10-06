# Offline models — tiered registry (2026-10-06)

Sophira's offline subsystem (`src/lib/offline/`) keeps all existing
architecture: encrypted offline storage, synchronization, conflict
resolution, local inference, model management, explicit downloads, and
integrity checks. This round adds TIERED model quality on top of it.

## The tier system

| Tier | Intended device | Models (verified 2026-10-06) | License | Quantization | Download | RAM floor |
|---|---|---|---|---|---|---|
| TIER 1 — phone/lightweight | any phone/laptop | SmolLM2 135M Instruct | apache-2.0 | ONNX int8 | ~139 MB | 800 MB |
| TIER 1 — phone/lightweight | any phone/laptop | SmolLM2 360M Instruct | apache-2.0 | ONNX q4 | ~395 MB | 1.5 GB |
| TIER 1 — phone/lightweight | phones 2 GB+ | Qwen2.5 0.5B Instruct | apache-2.0 | ONNX int8 | ~519 MB | 2.2 GB |
| TIER 2 — phone/performance + laptop | phones 4 GB+, laptops | Qwen2.5 1.5B Instruct | apache-2.0 | ONNX int8 | ~1.6 GB | 4.5 GB |
| TIER 2 — phone/performance + laptop | stronger devices | Qwen3 1.7B | apache-2.0 | ONNX q4 | ~2.2 GB | 6 GB |
| TIER 3 — laptop/desktop | strong laptops/desktops | Qwen3 4B Instruct 2507 | apache-2.0 | ONNX q4 (sharded) | ~4.0 GB | 10 GB |

Every registry entry records: id, version, immutable revision SHA,
license, parameter count, quantization, download size, RAM recommendation,
context size, supported platforms, runtime, capabilities, limitations.

## Model evaluation (what was checked, and what was rejected)

Candidates were verified against the HF hub on 2026-10-06 — repo exists,
ungated, ONNX weights present, sizes summed from the file manifest,
immutable commit SHA recorded:

- **Registered (all apache-2.0, ungated):** SmolLM2 135M/360M, Qwen2.5
  0.5B/1.5B, Qwen3 1.7B, Qwen3 4B-Instruct-2507 (sharded q4 external data).
- **Gemma family — NOT registered by default.** `onnx-community/gemma-3-270m-it-ONNX`
  and `gemma-3n-E2B-it-ONNX` are ungated on the hub and would be strong
  candidates, but their license is the **Gemma Terms of Use** (usage
  restrictions, acceptance required), not a standard OSS license. Shipping
  them is an owner decision, not an agent one; documented here instead of
  being silently included or silently ignored.
- **Llama family — rejected:** Llama-license repos are gated/restricted.
- **Phi-3.5-mini (MIT)** — viable q4f16 web build exists
  (`onnx-community/Phi-3.5-mini-instruct-onnx-web`); not registered this
  round in favor of Qwen3 (newer, comparable tier coverage). Candidate for a
  future entry.
- **No "latest"/"main" pins exist.** Every model pins a 40-character commit
  SHA; a model update is a new registry entry with a new SHA (rollback-safe).

## Per-model verification (runtime)

A model is marked READY only after ALL of these succeed
(`src/lib/offline/model-manager.ts`):

1. **Manifest verification** — HF tree manifest fetched and ONNX weights confirmed.
2. **File size verification** — manifest sizes cross-checked against the spec.
3. **Hash verification when available** — the manifest's LFS sha256 oids are
   recorded; `verifyBlobHash()` checks downloaded blobs via WebCrypto when
   the platform supports it. (Full multi-GB local re-hash is deliberately
   optional — documented as a limitation, not pretended.)
4. **Model loads** — the real transformers.js pipeline must load.
5. **Real local inference probe** — a tiny generation must succeed. A model
   that downloads but cannot generate is marked FAILED, never ready.

The UI also never claims a model is available offline before its weights
are downloaded: state starts at "not downloaded" and becomes "ready" only
via the pipeline above.

## Device capability detection and recommendation

`src/lib/offline/device-capabilities.ts` detects: `navigator.gpu` / WebGPU
availability, `hardwareConcurrency`, `deviceMemory` (with its ~8 GB cap
honestly noted), storage quota/usage estimate, platform, and CPU
architecture (high-entropy UA data). The recommendation is:

- **LOW RESOURCE → Use lightweight model.** (SmolLM2 135M)
- **MEDIUM RESOURCE → Use medium model.** (0.5B / 1.5B tier)
- **HIGH RESOURCE → Use strongest supported model.** (Qwen3 4B, only with
  WebGPU + ≥8 GB RAM + enough free storage)

The user can ALWAYS override the recommendation in the model picker, and
nothing downloads without explicit confirmation of the full disclosure
(size, RAM, license, quantization, capabilities, limitations, estimated
performance).

## Offline routing (network denial)

When the device is offline — or the user turns on offline mode — the client
guard (`src/lib/ai/offline-guard.ts`) refuses to even attempt:

- `fetch()` to any AI endpoint
- Gemini, OpenAI, remote search, remote source verification

All client AI call sites go through `guardedAiFetch()`, which throws before
touching the network and points to the local engine. Automated tests prove
zero fetch attempts under the offline decision, and that the local engine
still generates with `fetch()` hard-blocked. Leaving offline mode is an
explicit user action (the toggle on the Offline page).

## Native inference on Android/iOS (investigation)

For stronger-than-WASM local models on native builds, the realistic path is
Google's **AI Edge / MediaPipe LLM Inference API** (used by the AI Edge
Gallery app), which runs 1B–4B-class models on-device via GPU/NPU delegates
with `.task`/TFLite bundles — including Gemma 3n, Qwen, and Llama-class
models that browser WASM cannot reasonably run. Verified status as of
2026-10-06: the runtime is Android/iOS-native (Kotlin/Swift, LiteRT), NOT a
browser API — integrating it requires a Capacitor plugin bridging
MediaPipe tasks to the webview, plus a native build pipeline. That is a
separate engineering round (documented, not half-built here):
`transformers.js` browser/WASM inference remains the PWA/desktop fallback
exactly as required, and nothing existing was removed.

## Honest quality disclosure

The Offline page states it directly: LOCAL MODEL QUALITY (135M–4B
quantized, short/shallow answers possible) is BELOW REMOTE MODEL QUALITY
(Gemini free tier, only when online). Local answers are always stamped
LOCAL MODEL. The UI never pretends otherwise.
