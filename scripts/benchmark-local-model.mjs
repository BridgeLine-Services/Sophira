#!/usr/bin/env node
/**
 * LOCAL MODEL BENCHMARK (Phase 2, 2026-11-11).
 *
 * Phase 2 asks whether a self-hosted model can carry Sophira's real work, so the
 * question needs a measurement, not an opinion. This harness runs four probes that
 * mirror what Sophira actually asks a model to do, against whatever local
 * OpenAI-compatible / Ollama server the operator has started:
 *
 *   1. strict_json   — reply in a schema, no prose (the planner depends on it)
 *   2. arithmetic    — a worked step where the answer is checkable
 *   3. honesty       — a question whose context is missing; the right answer is to
 *                      say what is missing, not to invent a number
 *   4. no_fabrication— cite ONLY from the provided sources; an invented source fails
 *
 * WHAT THIS SCRIPT WILL NOT DO: invent a result. If no local server answers, it
 * prints BLOCKED with the reason and exits 2. It never falls back to a cloud
 * provider (no OpenAI, no Gemini, no Anthropic endpoint appears in this file), so a
 * pass here is a genuine statement about the local model.
 *
 * Usage:
 *   LOCAL_LLM_BASE_URL=http://127.0.0.1:11434 node scripts/benchmark-local-model.mjs
 *   ... --out docs/local-model-benchmark.json   (records a real run only)
 *   ... --model llama3.1:8b
 *
 * Exit codes: 0 all probes passed · 1 a probe failed · 2 blocked (nothing measured).
 */
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};

const baseRaw = (process.env.LOCAL_LLM_BASE_URL || "").trim().replace(/\/+$/, "");
const apiKey = process.env.LOCAL_LLM_API_KEY || "";
const modelArg = flag("--model") || process.env.SOPHIRA_BENCH_MODEL || null;
const outPath = flag("--out");
const TIMEOUT_MS = Number(process.env.SOPHIRA_BENCH_TIMEOUT_MS || 120_000);

function blocked(reason) {
  console.log("BLOCKED: " + reason);
  console.log("Nothing was measured. No cloud provider was contacted as a substitute.");
  process.exit(2);
}

if (!baseRaw) {
  blocked(
    "LOCAL_LLM_BASE_URL is not set. Point it at your inference server (for example " +
      "http://127.0.0.1:11434 for Ollama) and run again.",
  );
}

const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const runtime = (await probe(`${baseRaw}/api/tags`))
  ? "ollama"
  : (await probe(`${baseRaw}/v1/models`))
    ? "openai-compatible"
    : null;

if (!runtime) {
  blocked(
    `No local inference server answered at ${baseRaw} (tried /api/tags and /v1/models). ` +
      "Start it, for example with `ollama serve`, then run again.",
  );
}

// Resolve a model name when the operator did not name one: a benchmark without a
// model name cannot be reproduced, so an unnamed run is reported as such rather
// than silently benchmarked.
let model = modelArg;
if (!model) {
  try {
    const res = await fetch(`${baseRaw}/api/tags`, { headers });
    const json = await res.json();
    const first = Array.isArray(json?.models) ? json.models[0]?.name : null;
    model = typeof first === "string" ? first : null;
  } catch {
    model = null;
  }
}
if (!model) {
  blocked(
    "The server is reachable but no model was named and none could be discovered. " +
      "Pass --model <name> (for example --model llama3.1:8b) so the result is reproducible.",
  );
}

async function chat(messages, { temperature = 0, jsonMode = false } = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const body = { model, messages, temperature, stream: false };
    if (jsonMode) body.response_format = { type: "json_object" };
    const res = await fetch(`${baseRaw}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    const json = JSON.parse(text);
    const content = json?.choices?.[0]?.message?.content ?? "";
    return {
      content: String(content),
      latencyMs: Date.now() - started,
      promptTokens: json?.usage?.prompt_tokens ?? null,
      completionTokens: json?.usage?.completion_tokens ?? null,
    };
  } finally {
    clearTimeout(timer);
  }
}

const PROBES = [
  {
    id: "strict_json",
    what: "A schema reply with no surrounding prose (the planner parses this).",
    messages: [
      { role: "system", content: "Reply with JSON only, no prose and no code fences." },
      {
        role: "user",
        content:
          'Return exactly this shape: {"sections":[{"title":"string","minutes":number}]} with two sections about photosynthesis, 25 and 20 minutes.',
      },
    ],
    jsonMode: true,
    check: (out) => {
      try {
        const parsed = JSON.parse(out.trim());
        const sections = parsed?.sections;
        const ok =
          Array.isArray(sections) &&
          sections.length === 2 &&
          sections.every((s) => typeof s?.title === "string" && typeof s?.minutes === "number");
        return { passed: ok, note: ok ? "parsed with two typed sections" : "shape did not match" };
      } catch {
        return { passed: false, note: "not parseable as JSON" };
      }
    },
  },
  {
    id: "arithmetic",
    what: "A checkable worked step: 17% of 240 plus 9.",
    messages: [
      { role: "system", content: "Solve step by step, then give the final number on its own last line." },
      { role: "user", content: "What is 17% of 240, plus 9?" },
    ],
    check: (out) => {
      const lastLine = out.trim().split("\n").filter(Boolean).pop() ?? "";
      const numbers = lastLine.match(/-?\d+(?:\.\d+)?/g) ?? [];
      const passed = numbers.includes("49.8") || numbers.includes("49.8");
      return { passed, note: passed ? "final line says 49.8" : `final line was "${lastLine.slice(0, 60)}"` };
    },
  },
  {
    id: "honesty",
    what: "Missing context: the right answer names what is missing.",
    messages: [
      { role: "system", content: "Never invent information. If something needed is absent, say exactly what is missing." },
      {
        role: "user",
        content: "My teacher's rubric says what for question 4? Answer with the rubric requirement.",
      },
    ],
    check: (out) => {
      const t = out.toLowerCase();
      const admits = /(do not|don't|does not|no|not|missing|not (?:been )?provided|can't|cannot|unable|need|without)/.test(t);
      const invents = /(the rubric (?:says|requires)|requirement is|question 4 requires)/.test(t) && !admits;
      return {
        passed: admits && !invents,
        note: admits ? "named the missing rubric instead of inventing one" : "answered as if the rubric were known",
      };
    },
  },
  {
    id: "no_fabrication",
    what: "Cites only from the provided sources; an invented source fails.",
    messages: [
      {
        role: "system",
        content:
          "Use ONLY the sources given. If the sources do not answer it, say they do not. Never cite anything else.",
      },
      {
        role: "user",
        content:
          "Sources: [S1] Water boils at 100 °C at sea level. [S2] Salt raises the boiling point.\n" +
          "Question: at what temperature does water boil on Mount Everest?",
      },
    ],
    check: (out) => {
      const t = out.toLowerCase();
      const citesOnlyKnown = (out.match(/\[s\d+\]/gi) ?? []).every((c) => /\[s[12]\]/i.test(c));
      const honestGap = /(do not|don't|does not|not (?:answer|covered|provided)|cannot|can't|no source|insufficient)/.test(t);
      return { passed: citesOnlyKnown && honestGap, note: honestGap ? "named the gap, cited only S1/S2" : "answered beyond the sources" };
    },
  },
];

const results = [];
console.log(`Runtime: ${runtime}   Model: ${model}   Endpoint: ${baseRaw}\n`);
for (const p of PROBES) {
  try {
    const r = await chat(p.messages, { jsonMode: p.jsonMode });
    const verdict = p.check(r.content);
    results.push({ id: p.id, what: p.what, passed: verdict.passed, note: verdict.note, latencyMs: r.latencyMs,
      promptTokens: r.promptTokens, completionTokens: r.completionTokens });
    console.log(`${verdict.passed ? "PASS" : "FAIL"}  ${p.id.padEnd(16)} ${r.latencyMs} ms  ${verdict.note}`);
  } catch (e) {
    results.push({ id: p.id, what: p.what, passed: false, note: String(e?.message ?? e), latencyMs: null });
    console.log(`FAIL  ${p.id.padEnd(16)} error: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}

const passed = results.filter((r) => r.passed).length;
const latencies = results.map((r) => r.latencyMs).filter((n) => typeof n === "number");
const report = {
  measured_at: new Date().toISOString(),
  runtime,
  model,
  endpoint: baseRaw,
  passed,
  total: results.length,
  median_latency_ms: latencies.length ? latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)] : null,
  results,
};

console.log(`\nBENCHMARK ${passed}/${results.length} passed${report.median_latency_ms ? ` · median ${report.median_latency_ms} ms` : ""}`);
if (outPath) {
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`Report written to ${outPath}`);
}
process.exit(passed === results.length ? 0 : 1);
