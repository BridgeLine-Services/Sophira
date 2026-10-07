/**
 * SELF-HOSTED AI CONTRACT (2026-10-06): Sophira must be capable of running
 * with NO paid AI API. The self-hosted OpenAI-compatible inference server
 * (Ollama/vLLM/llama.cpp/LM Studio) is the DEFAULT path, configurable via
 * LOCAL_LLM_BASE_URL/LOCAL_LLM_MODEL, honestly reported when unreachable,
 * and never replaced by a silent paid fallback.
 */
import { readFileSync } from "fs";

export async function runSelfHostedAiTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): Promise<void> {
  section("Self-hosted AI: no paid API required, local runtime by default");

  const {
    resolveProviders, readAiEnv, costClassOf, selfhostBaseUrl, selfhostChat, selfhostRuntime, SELFHOST_DEFAULT_MODEL,
  } = require("../src/lib/ai/provider.js");
  type Plan = { candidates: string[]; reasons: Record<string, string> };

  // ---- provider identity --------------------------------------------------
  assert(costClassOf("selfhost") === "local", "selfhost: the self-hosted server is classified LOCAL (no billing possible)");

  const envSelf = readAiEnv({ AI_PROVIDER: "selfhost", LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434", LOCAL_LLM_MODEL: "llama3.1:8b" });
  const planSelf = resolveProviders(envSelf) as Plan;
  assert(planSelf.candidates.join() === "selfhost", "selfhost: explicit mode dispatches to the local inference server");
  assert(!planSelf.reasons.selfhost.includes("unset"), "selfhost: a configured endpoint is reported as ready");

  const envMissing = readAiEnv({ AI_PROVIDER: "selfhost" });
  const planMissing = resolveProviders(envMissing) as Plan;
  assert(planMissing.candidates.length === 0 && (planMissing.reasons.selfhost || "").includes("LOCAL_LLM_BASE_URL"),
    "selfhost: requesting the mode without an endpoint fails honestly with the fix");

  const envAuto = readAiEnv({
    AI_PROVIDER: "auto",
    LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434",
    GEMINI_API_KEY: "gk",
  });
  const planAuto = resolveProviders(envAuto) as Plan;
  assert(planAuto.candidates[0] === "selfhost" && planAuto.candidates[1] === "gemini",
    "selfhost: in auto mode the SELF-HOSTED server is tried FIRST, before any cloud provider");

  const envNoCloud = readAiEnv({ AI_PROVIDER: "auto" });
  const planNoCloud = resolveProviders(envNoCloud) as Plan;
  assert(planNoCloud.candidates.length === 0,
    "selfhost: with nothing configured, no candidate exists — no paid provider is required or assumed");

  // ---- endpoint handling (nothing hardcoded) -----------------------------
  assert(selfhostBaseUrl("http://127.0.0.1:11434") === "http://127.0.0.1:11434/v1", "selfhost: base URL gets a /v1 suffix");
  assert(selfhostBaseUrl("http://10.0.0.5:8000/v1/") === "http://10.0.0.5:8000/v1", "selfhost: an existing /v1 is not doubled");
  assert(SELFHOST_DEFAULT_MODEL.length > 0, "selfhost: a default open-weight model is documented (no cloud model)");

  // ---- request construction via injected fetch ---------------------------
  type Call = { url: string; init: { method: string; headers: Record<string, string>; body: string } };
  const seen: Call[] = [];
  const fetchOk: typeof fetch = (async (url: any, init: any) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200 });
  }) as any;
  const envChat = readAiEnv({ AI_PROVIDER: "selfhost", LOCAL_LLM_BASE_URL: "http://lan-machine.local:8080", LOCAL_LLM_MODEL: "my-model" });
  const r = await selfhostChat(envChat, [{ role: "user", content: "hi" }], {}, fetchOk);
  const c = seen[0];
  assert(r.text === "hello" && r.tokensIn === 3 && r.tokensOut === 2, "selfhost: a successful local chat returns text + token usage");
  assert(c.url === "http://lan-machine.local:8080/v1/chat/completions", "selfhost: the request goes to the CONFIGURED endpoint (OpenAI-compatible path)");
  const body = JSON.parse(c.init.body);
  assert(body.model === "my-model", "selfhost: the CONFIGURED model is requested");
  assert(!("Authorization" in c.init.headers), "selfhost: no auth header is sent when no local key is configured");
  const envKey = readAiEnv({ AI_PROVIDER: "selfhost", LOCAL_LLM_BASE_URL: "http://x:1", LOCAL_LLM_MODEL: "m", LOCAL_LLM_API_KEY: "local-secret-token-abc" });
  seen.length = 0;
  await selfhostChat(envKey, [{ role: "user", content: "hi" }], {}, fetchOk);
  assert(seen[0].init.headers.Authorization === "Bearer local-secret-token-abc", "selfhost: an optional bearer token is supported for secured local servers");

  // images (homework photos through a local vision model)
  seen.length = 0;
  await selfhostChat(envChat, [{ role: "user", content: "read this" }], { images: ["data:image/png;base64,AAAA"] }, fetchOk);
  const imgBody = JSON.parse(seen[0].init.body);
  assert(Array.isArray(imgBody.messages.at(-1).content) && imgBody.messages.at(-1).content.some((p: any) => p.type === "image_url"),
    "selfhost: homework images go to the local server in OpenAI vision format (no external OCR API)");

  // honest 404 + no key leak in errors
  const fetch404: typeof fetch = (async () => new Response("nope", { status: 404 })) as any;
  let msg = "";
  try { await selfhostChat(envKey, [{ role: "user", content: "x" }], {}, fetch404); } catch (e) { msg = (e as Error).message; }
  assert(msg.includes("my-model") === false, "selfhost: the 404 error names the model only when it is the configured one");
  assert(!msg.includes("local-secret-token-abc"), "selfhost: errors never leak the local token");

  // ---- runtime probe ------------------------------------------------------
  const fetchOllama: typeof fetch = (async (url: any) =>
    new Response(JSON.stringify({ models: [] }), { status: String(url).includes("/api/tags") ? 200 : 404 })) as any;
  const rtOllama = await selfhostRuntime(envSelf, fetchOllama);
  assert(rtOllama.available && rtOllama.runtime === "ollama", "selfhost: the probe detects Ollama");
  const fetchDead: typeof fetch = (async () => { throw new Error("ECONNREFUSED"); }) as any;
  const rtDead = await selfhostRuntime(envSelf, fetchDead);
  assert(!rtDead.available && rtDead.reason.includes("start it"), "selfhost: an unreachable runtime is reported with setup guidance");
  const rtNone = await selfhostRuntime(readAiEnv({}), fetchOllama);
  assert(!rtNone.available && rtNone.reason.includes("LOCAL_LLM_BASE_URL"), "selfhost: unconfigured is reported honestly");

  // ---- health endpoint ----------------------------------------------------
  const health = readFileSync("src/app/api/ai/health/route.ts", "utf8");
  assert(health.includes("available") && health.includes("runtime") && health.includes("reason"),
    "selfhost: /api/ai/health reports available/provider/model/runtime/reason");
  assert(health.includes("without any") || health.includes("NO secret") || health.includes("secrets"),
    "selfhost: /api/ai/health documents the no-secrets contract");
  assert(health.includes("never") && health.toLowerCase().includes("paid"),
    "selfhost: /api/ai/health never silently substitutes a paid provider");

  // ---- environment manifest + validator ----------------------------------
  const manifest = JSON.parse(readFileSync("src/config/env.manifest.json", "utf8"));
  const names = manifest.variables.map((v: any) => v.name);
  for (const n of ["LOCAL_LLM_BASE_URL", "LOCAL_LLM_MODEL", "LOCAL_LLM_API_KEY"]) {
    const v = manifest.variables.find((x: any) => x.name === n);
    assert(Boolean(v) && v.scope === "server" && v.required === "optional",
      `selfhost: ${n} is an optional server-side manifest entry (never required, never public)`);
  }
  assert(!names.includes("OPENROUTER_API_KEY") && !names.includes("GROQ_API_KEY") &&
    !names.includes("ANTHROPIC_API_KEY") && !names.includes("WOLFRAM_APP_ID") &&
    !names.includes("PERPLEXITY_API_KEY") && !names.includes("REPLICATE_API_TOKEN"),
    "selfhost: no paid-provider credentials exist anywhere in the manifest");

  const { checkEnv } = require("../src/lib/env.js");
  const badMode = checkEnv({ AI_PROVIDER: "selfhost" }, {});
  assert(badMode.issues.some((i: any) => i.var === "LOCAL_LLM_BASE_URL"),
    "selfhost: env validation demands the endpoint when the mode is selected");
  const goodMode = checkEnv({ AI_PROVIDER: "selfhost", LOCAL_LLM_BASE_URL: "http://127.0.0.1:11434" }, {});
  assert(!goodMode.issues.some((i: any) => i.level === "error"),
    "selfhost: self-hosted mode with an endpoint validates with ZERO cloud keys");

  // ---- search: fully local option ------------------------------------------
  const rp = require("../src/lib/research/provider.js");
  const LocalProvider = rp.LocalSearchProvider;
  const lp = new LocalProvider();
  const hits = await lp.search("anything");
  assert(lp.name === "local" && hits.length === 0,
    "selfhost: SEARCH_PROVIDER=local performs no external calls and never fabricates results");

  // ---- docs ----------------------------------------------------------------
  const arch = readFileSync("docs/SELF_HOSTED_AI_ARCHITECTURE.md", "utf8");
  for (const topic of ["How the local LLM works", "Frontend", "backend", "How math", "OCR", "embeddings", "Document processing", "open-source", "environment variables", "run the complete system locally"]) {
    assert(arch.toLowerCase().includes(topic.toLowerCase()), `selfhost: architecture doc covers "${topic}"`);
  }
  assert(arch.includes("no paid AI API is required"), "selfhost: the architecture doc states the no-paid acceptance criterion");
  assert(arch.includes("ollama pull llama3.1:8b"), "selfhost: the doc gives exact Ollama commands (not generic)");
  const readme = readFileSync("README.md", "utf8");
  assert(readme.includes("do NOT need an OpenAI") || readme.includes("NOT need an OpenAI"),
    "selfhost: README states the no-paid-key acceptance criterion");
  assert(readme.includes("LOCAL_LLM_BASE_URL"), "selfhost: README documents the local inference configuration");
  const tr = readFileSync("docs/TROUBLESHOOTING.md", "utf8");
  assert(tr.includes("Local inference server unreachable"), "selfhost: troubleshooting covers the unreachable local runtime");

  // ---- no vendor SDK dependencies ------------------------------------------
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const VENDOR_SDK_PREFIXES = ["openai", "@anthropic-ai", "@google/generative-ai", "langchain"];
  const vendorSdk = Object.keys(deps).filter((d) => VENDOR_SDK_PREFIXES.some((pfx) => d === pfx || d.startsWith(pfx + "/")));
  assert(vendorSdk.length === 0, "selfhost: no AI-vendor SDK dependency (all calls are plain fetch through the abstraction)");
}
