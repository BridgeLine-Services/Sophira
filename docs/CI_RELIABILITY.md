# CI reliability (2026-11-02)

## Original condition

CI failed on `d4c220f` — a **documentation-only commit** — at the *first* step,
`npm ci`. Runs on `f939c6b` and `3d39508` (same code) passed. Identical code
producing different outcomes is the signature of a flaky external dependency, not a
code defect.

Evidence from run `40939990299`, job `123680509474`:

```
npm warn EBADENGINE required: { node: '>=22.12.0' }
npm warn EBADENGINE   current: { node: 'v20.20.2', npm: '10.8.2' }
npm error path /home/runner/work/Sophira/Sophira/node_modules/onnxruntime-node
npm error command sh -c node ./script/install
npm error AggregateError [ETIMEDOUT]
npm error   Error: connect ETIMEDOUT 150.171.110.211:443
npm error   Error: connect ENETUNREACH 2603:1061:14:1d2::1:443
```

Steps 5-11 (lint, tests, tsc, build, native checks) were all **skipped**.

## Two independent causes

1. **Node version.** Transitive dependencies require Node 22 (`node_modules/katex/
   node_modules/commander` needs `>=22.12.0`; several others need `>=22.0.0`).
   CI pinned Node 20, so every install ran outside a supported range.
2. **onnxruntime-node has no retry.** On `linux/x64` its installer fetches the CUDA
   12 + TensorRT GPU providers from NuGet
   (`script/install-metadata.js`: `requirements['linux/x64'] = ['cuda12']` →
   `Microsoft.ML.OnnxRuntime.Gpu.Linux`, three `.so` files). A single `ETIMEDOUT`
   throws an unhandled `AggregateError` that fails `npm ci`. `script/install-utils.js`
   has no retry around `downloadFile`.

## Fix

- `actions/setup-node` now installs **Node 22** (satisfies every `engines` range).
- `package.json` declares `"engines": {"node": "22.x"}`; `.nvmrc` says `22`.
  `22.x` rather than a range because some hosts reject semver ranges in `engines`.
- `npm ci` runs in a **bounded retry loop** (3 attempts, 15/30/45s backoff) and
  fails the step if all attempts fail. No `continue-on-error`.
- The GPU-provider download is skipped **in CI only** via
  `ONNXRUNTIME_NODE_INSTALL=skip`, with npm fetch retries raised as belt-and-braces.
- No dependency added, removed, or downgraded. Lockfile unchanged (`npm ci` left it
  byte-identical). No install script disabled for real deployments: local, Vercel,
  Android, iOS and Tauri installs keep the default and still receive the CUDA
  providers if they ever want a GPU.

## Why skipping the GPU providers is safe (measured, not assumed)

The three files are CUDA/TensorRT execution providers. GitHub runners have no GPU.
Measured on 2026-11-02 with a real `onnxruntime-node` CPU inference (an `Add` model,
A=1,2 B=10,20):

| GPU providers | Result |
|---|---|
| present | `[11, 22]` |
| moved away | `[11, 22]` |
| restored | `[11, 22]` |
| after `npm ci` with skip | `[11, 22]` |

Identical results, so the CPU path does not depend on them. Side benefit: CI no
longer pulls ~274 MB of unusable GPU binaries.

## Local verification (Node 20 sandbox; CI itself runs Node 22)

| Command | Result |
|---|---|
| `npm ci` (with `ONNXRUNTIME_NODE_INSTALL=skip`) | **exit 0**, lockfile unchanged |
| `npm run lint` | **0 errors** (107 pinned warnings) |
| `npm test` | **PASS 4194/4194** |
| `npx tsc --noEmit -p tsconfig.json` | **PASS** |
| `npm run build` | **Compiled successfully** |
| `npm run verify` | **PASS** |
| `npm run scan:secrets` | **CLEAN** |

Local Node is 20.20.2, so install emits 45 `EBADENGINE` warnings here — that is the
condition CI no longer has, not a new problem.

## Verified in CI (not inferred)

Run `41425210752` on branch `fix/ci-node22-onnx-retry`, dispatched manually:

| Step | Previous run (40939990299) | This run (41425210752) |
|---|---|---|
| Install dependencies | **failure** | **success** (attempt 1 of 3) |
| Lint | skipped | **success** — 107 problems, 0 errors |
| Unit and integration tests | skipped | **success** — 4194 passed, 0 failed |
| TypeScript strict check | skipped | **success** |
| Production build | skipped | **success** — Compiled successfully |
| Native projects intact | skipped | **success** |

Log evidence: `EBADENGINE` occurrences **0** (was 45+ on Node 20), and the retry
wrapper logged `npm ci (attempt 1 of 3)`, i.e. the install succeeded first time and
no retry was needed.

Note: `npm run verify` and `npm run scan:secrets` are not CI steps; they were run
locally (PASS / CLEAN) and are recorded above.

## Files changed

| File | Why |
|---|---|
| `.github/workflows/ci.yml` | Node 22, retry loop, CI-only install skip, fetch retries |
| `package.json` | declare `engines.node`; no dependency or script changes |
| `.nvmrc` | new; tells contributors which Node to use |
| `docs/CI_RELIABILITY.md` | new; this record |

## Rollback

Revert the commit: `git revert <sha>`. CI returns to the previous workflow, and the
only lost change is the retry/skip configuration. `node_modules` can be restored with
`npm ci` (without the env var) if the GPU providers are wanted locally. No database
migration, no application code, no API contract, and no RLS policy is touched.

## Unresolved

- The NuGet edge that timed out is outside our control; the retry loop and the skip
  make it non-fatal rather than impossible.
- Local development still needs Node 22 for a warning-free install; the sandbox
  running this verification has Node 20.
