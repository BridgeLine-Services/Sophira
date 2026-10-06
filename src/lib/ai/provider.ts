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
 * Provider selection:
 *   AI_PROVIDER=local | gemini | openai | auto (default auto)
 *     auto: gemini (if GEMINI_API_KEY set, free tier) first, then openai
 *           (only if paid use is explicitly allowed). Server routes have no
 *           local inference; "local" candidates are a client concern (the
 *           Offline page runs the real on-device model) — the server reports
 *           honestly that no remote provider is available.
 *
 * All decisions return REASONS, surfaced by the owner diagnostics screen —
 * never silent.
 */

import { VERIFIED_FREE_TIER_GEMINI_MODELS } from "./capabilities";

export type ProviderId = "local" | "gemini" | "openai";
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
}

/** The Gemini free tier currently includes this model; owner can override. */
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

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
  };
}

export function paidAllowed(env: AiEnv): boolean {
  if (env.ALLOW_PAID_AI === "true") return true;
  const budget = parseFloat(env.MONTHLY_AI_BUDGET_USD);
  return Number.isFinite(budget) && budget > 0;
}

export function costClassOf(provider: ProviderId): ProviderCostClass {
  if (provider === "local") return "local";
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
  // auto (default): free first, then paid only if explicitly allowed
  if (geminiEligible()) candidates.push("gemini");
  if (openaiEligible()) candidates.push("openai");
  if (candidates.length === 0) {
    if (!env.GEMINI_API_KEY && !env.OPENAI_API_KEY) {
      reasons.local = "no remote provider is configured — Offline mode can still run the on-device model";
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
      hooks.onUse?.({ provider: p, model: p === "gemini" ? env.GEMINI_MODEL : env.SOPHIRA_MODEL, classification: costClassOf(p), ok: false });
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
    notes.push("GEMINI_API_KEY is unset — the free-tier path is available to the owner at any time.");
  }
  if (plan.candidates.length === 0) {
    notes.push("No remote provider eligible — Offline mode still runs the on-device model.");
  }
  return {
    configuredMode: env.AI_PROVIDER,
    activeProvider: active,
    activeModel: active === "gemini" ? env.GEMINI_MODEL : active === "openai" ? env.SOPHIRA_MODEL : null,
    classification: active ? costClassOf(active) : null,
    candidates: plan.candidates,
    reasons: plan.reasons,
    paidAllowed: paidAllowed(env),
    monthlyBudgetUSD: env.MONTHLY_AI_BUDGET_USD,
    geminiConfigured: Boolean(env.GEMINI_API_KEY),
    openaiKeyPresent: Boolean(env.OPENAI_API_KEY),
    notes,
  };
}
