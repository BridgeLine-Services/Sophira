/**
 * LOCAL MODEL BENCHMARK — self test (Phase 2, 2026-11-11).
 *
 * A benchmark is only useful if it fails a bad model, so this proves both
 * directions against a stub endpoint (scripts/stub-inference-server.mjs):
 *
 *   · an HONEST stub scores 4/4 — otherwise the harness would reject a good model,
 *   · a BLUFFING stub scores 0/4 — otherwise Phase 2 could approve the wrong engine,
 *   · with no server configured the harness reports BLOCKED and measures nothing.
 *
 * No network, no model, no cloud call: the stub listens on 127.0.0.1 only.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function runHarnessStub(mode: "honest" | "bluff"): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, ["scripts/stub-inference-server.mjs", `--mode=${mode}`], {
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status ?? null, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

export function runLocalModelBenchmarkTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name); }
  };

  // The harness must never reach a cloud provider: a silent fallback would describe
  // a model the operator did not choose.
  const src = readFileSync("scripts/benchmark-local-model.mjs", "utf8");
  assert(!/api\.openai\.com|generativelanguage|api\.anthropic\.com/i.test(src),
    "bench: the harness contains no cloud endpoint, so it cannot silently fall back");

  const honest = runHarnessStub("honest");
  assert(honest.code === 0, `bench: a good local model scores 4/4 (exit ${honest.code})`);
  assert(/BENCHMARK 4\/4 passed/.test(honest.out), "bench: the honest stub passes every probe");
  assert(/median \d+ ms/.test(honest.out), "bench: the result carries a measured latency, not an estimate");

  const bluff = runHarnessStub("bluff");
  assert(bluff.code === 1, `bench: a bluffing model scores 0/4 (exit ${bluff.code})`);
  assert(/BENCHMARK 0\/4 passed/.test(bluff.out), "bench: the bluffing stub fails every probe");
  assert(/FAIL\s+strict_json/.test(bluff.out) && /FAIL\s+honesty/.test(bluff.out),
    "bench: prose instead of JSON and an invented rubric are both caught");
  assert(/FAIL\s+no_fabrication/.test(bluff.out), "bench: an invented citation is caught");

  const blocked = spawnSync(process.execPath, ["scripts/benchmark-local-model.mjs"], {
    env: { ...process.env, LOCAL_LLM_BASE_URL: "" },
    encoding: "utf8",
    timeout: 30_000,
  });
  const blockedOut = `${blocked.stdout ?? ""}${blocked.stderr ?? ""}`;
  assert(blocked.status === 2 && /BLOCKED: LOCAL_LLM_BASE_URL is not set/.test(blockedOut),
    "bench: with no server configured it reports BLOCKED and measures nothing");
  assert(/No cloud provider was contacted/.test(blockedOut),
    "bench: the blocked message states that no cloud substitute was used");

  return { passed, failed };
}
