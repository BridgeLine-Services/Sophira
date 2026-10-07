/**
 * AI provider architecture — FREE-FIRST / LOCAL-FIRST (2026-10-06).
 *
 * Server-side provider dispatch with zero-billing safety. Nothing here is
 * ever imported by client code: GEMINI_API_KEY and OPENAI_API_KEY must stay
 * server-side secrets (see scripts/secret-scan.mjs, which scans the built
 * client bundle for them).
 *
 * Zero-billing (fail closed):
 *   ALLOW_PAID_AI (default "false") and MONTHLY_AI_BUDGET_USD (default "0").
 *   Paid providers (OpenAI) are ONLY eligible when the owner explicitly sets
 *   ALLOW_PAID_AI=true or a budget > 0. With the defaults, Sophira never
 *   sends a request to a paid endpoint, even if a paid key is configured.
 *
 * Provider selection (SELF-HOSTED FIRST, 2026-10-06):
 *   AI_PROVIDER=selfhost | local | gemini | openai | auto (default auto)
 *     selfhost: an OpenAI-compatible LOCAL inference server (Ollama, llama.cpp
 *           server, vLLM, LM Studio, ...) configured via LOCAL_LLM_BASE_URL +
 *           LOCAL_LLM_MODEL. Self-hosted AI is the DEFAULT path: in auto mode
 *           it is tried FIRST, before any cloud provider, and requires no API
 *           key at all. Nothing is hardcoded — the endpoint is fully
 *           configurable (dev: a machine on your LAN; prod: your own server).
 *     auto: selfhost (if LOCAL_LLM_BASE_URL set) → gemini (if GEMINI_API_KEY
 *           set, free tier) → openai (only if paid use is explicitly allowed).
 *           Server routes have no local inference; "local" candidates are a
 *           client concern (the Offline page runs the real on-device model).
 *
 * All decisions return REASONS, surfaced by the owner diagnostics screen —
 * never silent.
 */

import { VERIFIED_FREE_TIER_GEMINI_MODELS } from "./capabilities";

export type ProviderId = "local" | "selfhost" | "gemini" | "openai";
export type ProviderCostClass = "local" | "free-tier" | "paid";

export interface AiEnv {
  AI_PROVIDER: string;
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  OPENAI_API_KEY: string;
  OPENAI_BASE_URL: string;
  SOPHIRA_MODEL: string;
  ALLOW_PAID_AI: string;
  MONTHLY_AI_BUDGET_USD: string;
  /** OpenAI-compatible LOCAL inference server (Ollama/vLLM/llama.cpp/LM Studio). */
  LOCAL_LLM_BASE_URL: string;
  LOCAL_LLM_MODEL: string;
  /** Optional: only if your local server requires a bearer token. */
  LOCAL_LLM_API_KEY: string;
}

/** The Gemini free tier currently includes this model; owner can override. */
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

/** Self-hosted default (works with `ollama pull llama3.1:8b`); owner can override. */
export const SELFHOST_DEFAULT_MODEL = "llama3.1:8b";

export function readAiEnv(overrides: Partial<AiEnv> = {}): AiEnv {
  const e = typeof process !== "undefined" ? (process.env as Record<string, string | undefined>) : {};
  return {
    AI_PROVIDER: overrides.AI_PROVIDER ?? (e.AI_PROVIDER || "auto"),
    GEMINI_API_KEY: overrides.GEMINI_API_KEY ?? (e.GEMINI_API_KEY || ""),
    GEMINI_MODEL: overrides.GEMINI_MODEL ?? (e.GEMINI_MODEL || GEMINI_DEFAULT_MODEL),
    OPENAI_API_KEY: overrides.OPENAI_API_KEY ?? (e.OPENAI_API_KEY || ""),
    OPENAI_BASE_URL: overrides.OPENAI_BASE_URL ?? (e.OPENAI_BASE_URL || "https://api.openai.com/v1"),
    SOPHIRA_MODEL: overrides.SOPHIRA_MODEL ?? (e.SOPHIRA_MODEL || "gpt-4o-mini"),
    ALLOW_PAID_AI: overrides.ALLOW_PAID_AI ?? (e.ALLOW_PAID_AI || "false"),
    MONTHLY_AI_BUDGET_USD: overrides.MONTHLY_AI_BUDGET_USD ?? (e.MONTHLY_AI_BUDGET_USD || "0"),
    LOCAL_LLM_BASE_URL: overrides.LOCAL_LLM_BASE_URL ?? (e.LOCAL_LLM_BASE_URL || ""),
    LOCAL_LLM_MODEL: overrides.LOCAL_LLM_MODEL ?? (e.LOCAL_LLM_MODEL || SELFHOST_DEFAULT_MODEL),
    LOCAL_LLM_API_KEY: overrides.LOCAL_LLM_API_KEY ?? (e.LOCAL_LLM_API_KEY || ""),
  };
}

export function paidAllowed(env: AiEnv): boolean {
  if (env.ALLOW_PAID_AI === "true") return true;
  const budget = parseFloat(env.MONTHLY_AI_BUDGET_USD);
  return Number.isFinite(budget) && budget > 0;
}

export function costClassOf(provider: ProviderId): ProviderCostClass {
  if (provider === "local" || provider === "selfhost") return "local";
  if (provider === "gemini") return "free-tier"; // free-tier quotas apply; we never attach a billing account
  return "paid";
}

export interface ProviderPlan {
  /** ordered remote providers the server may actually call right now */
  candidates: ProviderId[];
  /** why each configured provider is (or is not) eligible — shown in diagnostics */
  reasons: Partial<Record<ProviderId, string>>;
}

export function resolveProviders(env: AiEnv): ProviderPlan {
  const reasons: Partial<Record<ProviderId, string>> = {};
  const candidates: ProviderId[] = [];
  const mode = (env.AI_PROVIDER || "auto").toLowerCase();

  const geminiEligible = () => {
    if (!env.GEMINI_API_KEY) {
      reasons.gemini = "not configured (GEMINI_API_KEY is unset) — handled gracefully: falling back per policy (local/offline)";
      return false;
    }
    // MODEL-level billing policy (fail closed): when paid use is not
    // explicitly allowed, only models VERIFIED on the free tier may run.
    // Unknown/unverified models are rejected server-side here, before any
    // network call. This also guards "free forever" drift: if Google moves
    // a model off the free tier, removing it from the verified list blocks
    // it under the zero-billing policy.
    if (!paidAllowed(env) && !VERIFIED_FREE_TIER_GEMINI_MODELS.includes(env.GEMINI_MODEL)) {
      reasons.gemini = `REJECTED: model "${env.GEMINI_MODEL}" is not on the verified free-tier list and ALLOW_PAID_AI=false — set GEMINI_MODEL to a verified free-tier model (${VERIFIED_FREE_TIER_GEMINI_MODELS.join(", ")}) or explicitly allow paid use`;
      return false;
    }
    reasons.gemini = VERIFIED_FREE_TIER_GEMINI_MODELS.includes(env.GEMINI_MODEL)
      ? `free tier configured (model ${env.GEMINI_MODEL}, verified free-tier as of 2026-10-06)`
      : `configured (model ${env.GEMINI_MODEL}) with paid use EXPLICITLY allowed`;
    return true;
  };
  const openaiEligible = () => {
    if (!env.OPENAI_API_KEY) {
      reasons.openai = "not configured (OPENAI_API_KEY is unset)";
      return false;
    }
    if (!paidAllowed(env)) {
      reasons.openai =
        "IGNORED: a paid key is present but ALLOW_PAID_AI=false and MONTHLY_AI_BUDGET_USD=0 — zero-billing policy (fail closed)";
      return false;
    }
    reasons.openai = `configured and paid use EXPLICITLY allowed (model ${env.SOPHIRA_MODEL})`;
    return true;
  };

  const selfhostEligible = () => {
    if (!env.LOCAL_LLM_BASE_URL) {
      reasons.selfhost = "not configured (LOCAL_LLM_BASE_URL is unset) — self-hosted AI is the default path: point it at your Ollama/vLLM/llama.cpp server (see docs/SELF_HOSTED_AI_ARCHITECTURE.md)";
      return false;
    }
    reasons.selfhost = `self-hosted inference server configured (model ${env.LOCAL_LLM_MODEL}) — no API key required, nothing leaves your machines`;
    return true;
  };

  if (mode === "selfhost") {
    if (selfhostEligible()) candidates.push("selfhost");
    else reasons.selfhost += "; AI_PROVIDER=selfhost was requested — set LOCAL_LLM_BASE_URL (and optionally LOCAL_LLM_MODEL)";
    return { candidates, reasons };
  }
  if (mode === "local") {
    reasons.local = "AI_PROVIDER=local — the server performs no remote AI; use Offline mode (on-device model)";
    return { candidates, reasons };
  }
  if (mode === "gemini") {
    if (geminiEligible()) candidates.push("gemini");
    else reasons.gemini += "; AI_PROVIDER=gemini was requested — fix the configuration";
    return { candidates, reasons };
  }
  if (mode === "openai") {
    if (openaiEligible()) candidates.push("openai");
    else reasons.openai += "; AI_PROVIDER=openai was requested — fix the configuration";
    return { candidates, reasons };
  }
  // auto (default): SELF-HOSTED FIRST, then free cloud, then paid only if explicitly allowed
  if (selfhostEligible()) candidates.push("selfhost");
  if (geminiEligible()) candidates.push("gemini");
  if (openaiEligible()) candidates.push("openai");
  if (candidates.length === 0) {
    if (!env.GEMINI_API_KEY && !env.OPENAI_API_KEY && !env.LOCAL_LLM_BASE_URL) {
      reasons.local = "no remote provider is configured — self-hosted AI (LOCAL_LLM_BASE_URL) or Offline mode can still run locally";
    } else {
      reasons.local = "no eligible remote provider (see reasons above) — Offline mode can still run the on-device model";
    }
  }
  return { candidates, reasons };
}

/* ------------------------------------------------------------------ */
/* Gemini free tier — server-side only. The key travels in the         */
/* x-goog-api-key header (never in URLs, query strings, or logs).       */
/* ------------------------------------------------------------------ */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOpts {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  /** base64 data URLs (server routes pass uploaded images) */
  images?: string[];
}

export interface GeminiRequestBody {
  systemInstruction?: { parts: { text: string }[] };
  contents: { role: "user" | "model"; parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[];
  generationConfig: { temperature: number; maxOutputTokens: number; responseMimeType?: string };
}

/** Pure: ChatMessage[] → Gemini generateContent body. Tested. */
export function geminiBody(messages: ChatMessage[], opts: ChatOpts): GeminiRequestBody {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const rest = messages.filter((m) => m.role !== "system");
  const contents = rest.map((m, i) => {
    const parts: GeminiRequestBody["contents"][number]["parts"] = [{ text: m.content }];
    if (opts.images && opts.images.length > 0 && i === rest.length - 1 && m.role === "user") {
      for (const dataUrl of opts.images) {
        const mt = dataUrl.match(/^data:([^;]+);base64,(.*)$/s);
        if (mt) parts.push({ inlineData: { mimeType: mt[1], data: mt[2] } });
      }
    }
    return { role: m.role === "assistant" ? ("model" as const) : ("user" as const), parts };
  });
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      maxOutputTokens: opts.maxTokens ?? 4096,
      ...(opts.jsonMode ? { responseMimeType: "application/json" } : {}),
    },
  };
}

/** Pure: extract text + token usage from a generateContent response. Tested. */
export function parseGeminiText(
  data: unknown
): { text: string; tokensIn: number | null; tokensOut: number | null } {
  const d = data as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const parts = d?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((p) => (typeof p.text === "string" ? p.text : ""))
    .join("")
    .trim();
  const u = d?.usageMetadata;
  return {
    text,
    tokensIn: typeof u?.promptTokenCount === "number" ? u.promptTokenCount : null,
    tokensOut: typeof u?.candidatesTokenCount === "number" ? u.candidatesTokenCount : null,
  };
}

export class AiProviderUnavailableError extends Error {
  constructor(public plan: ProviderPlan, public envSummary: { provider: string; allowPaid: boolean; budget: string }) {
    super(
      plan.candidates.length === 0
        ? "No AI provider is available. Free path: the owner sets GEMINI_API_KEY (Google Gemini free tier), or you can use Offline mode, which runs the on-device model without any server."
        : "The AI provider is temporarily unavailable — please retry, or use Offline mode (on-device model)."
    );
    this.name = "AiProviderUnavailableError";
  }
}

export type FetchLike = typeof fetch;

export async function geminiChat(
  env: AiEnv,
  messages: ChatMessage[],
  opts: ChatOpts,
  fetchFn: FetchLike = fetch
): Promise<{ text: string; tokensIn: number | null; tokensOut: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetchFn(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODEL)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: JSON.stringify(geminiBody(messages, opts)),
        signal: controller.signal,
      }
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) {
        throw new Error("Gemini free-tier quota was exceeded (rate limited).");
      }
      if (res.status === 404) {
        throw new Error(
          `The configured Gemini model "${env.GEMINI_MODEL}" is no longer available. Update GEMINI_MODEL to a model on Google's current free tier, or use Offline mode.`
        );
      }
      // Never echo the body (could reflect request data) or the key.
      throw new Error(`The Gemini API returned an error (HTTP ${res.status}).`);
    }
    const data = await res.json();
    const parsed = parseGeminiText(data);
    if (!parsed.text) throw new Error("Gemini returned an empty response.");
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* SELF-HOSTED inference (2026-10-06): any OpenAI-compatible local      */
/* server — Ollama, llama.cpp server, vLLM, LM Studio, llama-cpp-python */
/* — via /v1/chat/completions. No API key required (an optional bearer  */
/* token is supported for secured endpoints). The endpoint comes from   */
/* LOCAL_LLM_BASE_URL; nothing is hardcoded and no cloud call is made.  */
/* ------------------------------------------------------------------ */

/** Normalize a local base URL (accepts both http://host:11434 and …/v1). */
export function selfhostBaseUrl(raw: string): string {
  const base = raw.trim().replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

export async function selfhostChat(
  env: AiEnv,
  messages: ChatMessage[],
  opts: ChatOpts,
  fetchFn: FetchLike = fetch
): Promise<{ text: string; tokensIn: number | null; tokensOut: number | null }> {
  const baseUrl = selfhostBaseUrl(env.LOCAL_LLM_BASE_URL);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const finalMessages: { role: string; content: unknown }[] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (opts.images && opts.images.length > 0 && finalMessages.length > 0) {
    const last = finalMessages[finalMessages.length - 1];
    if (last.role === "user") {
      last.content = [
        { type: "text", text: String(last.content) },
        ...opts.images.map((dataUrl) => ({ type: "image_url", image_url: { url: dataUrl } })),
      ];
    }
  }
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (env.LOCAL_LLM_API_KEY) headers.Authorization = `Bearer ${env.LOCAL_LLM_API_KEY}`;
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: env.LOCAL_LLM_MODEL,
        messages: finalMessages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 4096,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 404) {
        throw new Error(
          `The local inference server responded 404 for model "${env.LOCAL_LLM_MODEL}". Pull the model (e.g. ollama pull ${env.LOCAL_LLM_MODEL}) or set LOCAL_LLM_MODEL to an installed model.`
        );
      }
      // Never echo the body or any credentials.
      throw new Error(`The local inference server returned an error (HTTP ${res.status}).`);
    }
    const data = await res.json();
    const msg = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message;
    const text = typeof msg?.content === "string" ? msg.content : "";
    if (!text.trim()) throw new Error("The local inference server returned an empty response.");
    const u = (data as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
    return {
      text,
      tokensIn: typeof u?.prompt_tokens === "number" ? u.prompt_tokens : null,
      tokensOut: typeof u?.completion_tokens === "number" ? u.completion_tokens : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Probe a local inference server: detect the runtime WITHOUT secrets. */
export async function selfhostRuntime(
  env: AiEnv,
  fetchFn: FetchLike = fetch
): Promise<{ available: boolean; runtime: string; reason: string }> {
  if (!env.LOCAL_LLM_BASE_URL) {
    return { available: false, runtime: "none", reason: "LOCAL_LLM_BASE_URL is not configured" };
  }
  const base = env.LOCAL_LLM_BASE_URL.trim().replace(/\/+$/, "");
  const probe = async (url: string): Promise<{ ok: boolean; runtime: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      const headers: Record<string, string> = {};
      if (env.LOCAL_LLM_API_KEY) headers.Authorization = `Bearer ${env.LOCAL_LLM_API_KEY}`;
      const res = await fetchFn(url, { signal: controller.signal, headers });
      return { ok: res.ok, runtime: "" };
    } catch {
      return { ok: false, runtime: "" };
    } finally {
      clearTimeout(timer);
    }
  };
  const ollama = await probe(`${base}/api/tags`);
  if (ollama.ok) return { available: true, runtime: "ollama", reason: "" };
  const openaiCompat = await probe(`${base}/v1/models`);
  if (openaiCompat.ok) return { available: true, runtime: "openai-compatible", reason: "" };
  return {
    available: false,
    runtime: "none",
    reason: "Local inference server unreachable — start it (e.g. `ollama serve`) and check LOCAL_LLM_BASE_URL. Non-AI features keep working; no cloud call is made as a substitute.",
  };
}

export async function openaiChat(
  env: AiEnv,
  messages: ChatMessage[],
  opts: ChatOpts,
  fetchFn: FetchLike = fetch
): Promise<string> {
  const baseUrl = (env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  const finalMessages: { role: string; content: unknown }[] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (opts.images && opts.images.length > 0 && finalMessages.length > 0) {
    const last = finalMessages[finalMessages.length - 1];
    if (last.role === "user") {
      last.content = [
        { type: "text", text: String(last.content) },
        ...opts.images.map((dataUrl) => ({ type: "image_url", image_url: { url: dataUrl } })),
      ];
    }
  }
  try {
    const res = await fetchFn(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: env.SOPHIRA_MODEL,
        messages: finalMessages,
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 4096,
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Do not include the body — it can reflect request data. Honest status only.
      throw new Error(`The AI service returned an error (HTTP ${res.status}).`);
    }
    const data = await res.json();
    const content = (data as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("The AI service returned an empty response. Please try again.");
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export interface UseRecord {
  provider: ProviderId;
  model: string;
  classification: ProviderCostClass;
  ok: boolean;
  tokensIn?: number | null;
  tokensOut?: number | null;
  userId?: string;
}

/**
 * Dispatch a server-side chat through the eligible providers, in order.
 * On failure of one candidate the next is tried; if all fail (or none are
 * eligible) the honest AiProviderUnavailableError is thrown — never a
 * fabricated response. `onUse` (best-effort, never throws here) records
 * usage for the owner diagnostics screen.
 */
export async function serverAiChat(
  messages: ChatMessage[],
  opts: ChatOpts = {},
  env: AiEnv = readAiEnv(),
  hooks: { fetchFn?: FetchLike; onUse?: (r: UseRecord) => void } = {}
): Promise<{ text: string; provider: ProviderId; model: string }> {
  const plan = resolveProviders(env);
  const errors: string[] = [];
  for (const p of plan.candidates) {
    try {
      if (p === "selfhost") {
        const r = await selfhostChat(env, messages, opts, hooks.fetchFn);
        if (!r.text) throw new Error("The local inference server returned an empty response.");
        hooks.onUse?.({ provider: "selfhost", model: env.LOCAL_LLM_MODEL, classification: "local", ok: true, tokensIn: r.tokensIn, tokensOut: r.tokensOut });
        return { text: r.text, provider: "selfhost", model: env.LOCAL_LLM_MODEL };
      }
      if (p === "gemini") {
        const r = await geminiChat(env, messages, opts, hooks.fetchFn);
        if (!r.text) throw new Error("Gemini returned an empty response.");
        hooks.onUse?.({ provider: "gemini", model: env.GEMINI_MODEL, classification: "free-tier", ok: true, tokensIn: r.tokensIn, tokensOut: r.tokensOut });
        return { text: r.text, provider: "gemini", model: env.GEMINI_MODEL };
      }
      if (p === "openai") {
        const text = await openaiChat(env, messages, opts, hooks.fetchFn);
        hooks.onUse?.({ provider: "openai", model: env.SOPHIRA_MODEL, classification: "paid", ok: true });
        return { text, provider: "openai", model: env.SOPHIRA_MODEL };
      }
    } catch (e) {
      errors.push(`${p}: ${(e as Error).message}`);
      hooks.onUse?.({
        provider: p,
        model: p === "gemini" ? env.GEMINI_MODEL : p === "selfhost" ? env.LOCAL_LLM_MODEL : env.SOPHIRA_MODEL,
        classification: costClassOf(p),
        ok: false,
      });
    }
  }
  const err = new AiProviderUnavailableError(plan, {
    provider: env.AI_PROVIDER,
    allowPaid: paidAllowed(env),
    budget: env.MONTHLY_AI_BUDGET_USD,
  });
  // Preserve the per-provider failure reasons for diagnostics/logs without
  // ever including secret material.
  (err as Error & { attemptErrors?: string[] }).attemptErrors = errors;
  throw err;
}

/* ------------------------------------------------------------------ */
/* Owner diagnostics (server-only; contains NO secret values).          */
/* ------------------------------------------------------------------ */

export interface ProviderDiagnostics {
  configuredMode: string;
  activeProvider: ProviderId | null;
  activeModel: string | null;
  classification: ProviderCostClass | null;
  candidates: ProviderId[];
  reasons: Partial<Record<ProviderId, string>>;
  paidAllowed: boolean;
  monthlyBudgetUSD: string;
  geminiConfigured: boolean;
  openaiKeyPresent: boolean;
  selfhostConfigured: boolean;
  selfhostModel: string | null;
  notes: string[];
}

export function providerDiagnostics(env: AiEnv): ProviderDiagnostics {
  const plan = resolveProviders(env);
  const active = plan.candidates[0] ?? null;
  const notes: string[] = [];
  if (env.OPENAI_API_KEY && !paidAllowed(env)) {
    notes.push("OPENAI_API_KEY is present but IGNORED: zero-billing policy (ALLOW_PAID_AI=false, MONTHLY_AI_BUDGET_USD=0).");
  }
  if (!env.GEMINI_API_KEY) {
    notes.push("GEMINI_API_KEY is unset — optional; the self-hosted path (LOCAL_LLM_BASE_URL) needs no key at all.");
  }
  if (!env.LOCAL_LLM_BASE_URL) {
    notes.push("LOCAL_LLM_BASE_URL is unset — self-hosted AI is the default path; point it at your Ollama/vLLM/llama.cpp server (docs/SELF_HOSTED_AI_ARCHITECTURE.md).");
  }
  if (plan.candidates.length === 0) {
    notes.push("No remote provider eligible — Offline mode still runs the on-device model.");
  }
  return {
    configuredMode: env.AI_PROVIDER,
    activeProvider: active,
    activeModel:
      active === "gemini" ? env.GEMINI_MODEL
      : active === "openai" ? env.SOPHIRA_MODEL
      : active === "selfhost" ? env.LOCAL_LLM_MODEL
      : null,
    classification: active ? costClassOf(active) : null,
    candidates: plan.candidates,
    reasons: plan.reasons,
    paidAllowed: paidAllowed(env),
    monthlyBudgetUSD: env.MONTHLY_AI_BUDGET_USD,
    geminiConfigured: Boolean(env.GEMINI_API_KEY),
    openaiKeyPresent: Boolean(env.OPENAI_API_KEY),
    selfhostConfigured: Boolean(env.LOCAL_LLM_BASE_URL),
    selfhostModel: env.LOCAL_LLM_BASE_URL ? env.LOCAL_LLM_MODEL : null,
    notes,
  };
}
