#!/usr/bin/env node
// AI PROVIDER SELECTION BASELINE (Prompt 5, Step 1) - no network, no model.
const { resolveProviders, readAiEnv } = await import("../tests-dist/src/lib/ai/provider.js");
const scenarios = {
  "nothing configured": {},
  "self-hosted only": { LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434/v1" },
  "gemini only": { GEMINI_API_KEY: "test-key" },
  "openai key, paid DISABLED": { OPENAI_API_KEY: "test-key" },
  "openai key, paid ENABLED": { OPENAI_API_KEY: "test-key", ALLOW_PAID_AI: "true", MONTHLY_AI_BUDGET_USD: "10" },
  "forced openai, paid DISABLED": { AI_PROVIDER: "openai", OPENAI_API_KEY: "test-key" },
};
for (const [name, env] of Object.entries(scenarios)) {
  const plan = resolveProviders(readAiEnv(env));
  const picks = Array.isArray(plan.order) ? plan.order.map((p) => p.provider ?? p.id ?? p).join(" > ") : JSON.stringify(plan).slice(0, 90);
  console.log(name.padEnd(28), "->", picks);
}
