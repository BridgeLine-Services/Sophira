/**
 * Provider CAPABILITY REGISTRY (2026-10-06).
 *
 * Machine-readable description of every provider Sophira can use, shown in
 * the UI BEFORE a provider is activated. The registry is pure data — no
 * secrets, no keys, no network. Server and owner UI both render from it.
 *
 * Honesty rules:
 *  - free-tier facts are CURRENT facts, not promises. "Never assume an API
 *    labeled free will remain free forever": every remote row notes that
 *    the provider controls tiering and can change it at any time.
 *  - max_context numbers are the values documented by the provider TODAY
 *    (Google: gemini-2.5-flash 1,048,576 input tokens). They are display
 *    data, never load-bearing logic.
 *  - local rows carry null where the honest answer depends on the device.
 */

import { LOCAL_MODELS } from "../offline/model-registry";

export interface ProviderCapability {
  provider: "local" | "gemini" | "openai";
  model: string;
  online_required: boolean;
  free_tier: boolean;
  paid_capable: boolean;
  billing_required: boolean;
  multimodal: boolean;
  /** provider-documented context window in tokens, or null when device/provider dependent */
  max_context: number | null;
  research_tools: boolean;
  local: boolean;
  notes: string[];
}

/**
 * Gemini models VERIFIED to be on Google's free tier as of 2026-10-06.
 * Deliberately a short, maintained list: when ALLOW_PAID_AI=false, only
 * models on this list may run (fail closed). An unknown GEMINI_MODEL is
 * rejected — the owner either picks a verified free model or explicitly
 * opts into paid use. This is also the "never assume free forever" guard:
 * if Google moves a model out of the free tier, removing it from this list
 * blocks it immediately under the zero-billing policy.
 */
export const VERIFIED_FREE_TIER_GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
];

/** Capabilities of every registered LOCAL model (from the offline registry). */
export function localCapabilities(): ProviderCapability[] {
  return LOCAL_MODELS.map((m) => ({
    provider: "local" as const,
    model: m.id,
    online_required: false,
    free_tier: true,
    paid_capable: false,
    billing_required: false,
    multimodal: false,
    max_context: null, // depends on device RAM; the engine generates at most ~256 tokens per reply
    research_tools: false,
    local: true,
    notes: [
      `Runs entirely on-device (no network). Download ~${m.approxSizeMB} MB with explicit consent; every answer is stamped LOCAL MODEL.`,
      "Small-model quality: expect short, sometimes shallow answers.",
      ...m.capabilities.map((c) => `capability: ${c}`),
    ],
  }));
}

/**
 * Capabilities of the remote Gemini free-tier row, given the owner's model
 * choice. Honest per-model data only; unknown models are the owner's
 * explicit configuration.
 */
export function geminiCapabilities(model: string): ProviderCapability {
  const verifiedFree = VERIFIED_FREE_TIER_GEMINI_MODELS.includes(model);
  return {
    provider: "gemini",
    model,
    online_required: true,
    free_tier: verifiedFree,
    paid_capable: true, // the same model family has paid tiers once quotas are exceeded
    billing_required: false, // no billing account is attached BY SOPHIRA — ever
    multimodal: true, // text + image input (inlineData parts)
    max_context: 1_048_576, // documented by Google for gemini-2.5-flash today; display-only
    research_tools: true, // Gemini supports grounded search; Sophira uses its own verified search stack
    local: false,
    notes: [
      verifiedFree
        ? "On Google's free tier as verified 2026-10-06 — rate-limited; quota is not exposed by the API."
        : "NOT on the verified free-tier list — under the No Unexpected Charges policy this model is rejected unless ALLOW_PAID_AI=true.",
      "Google controls tiering and can change free-tier availability at any time; Sophira never assumes it stays free (the verified list is the policy gate).",
      "No billing account is ever attached to the key by Sophira; no recurring charge is possible through Sophira.",
    ],
  };
}

/** Optional OpenAI row (NEVER the default; paid by nature). */
export function openaiCapabilities(model: string): ProviderCapability {
  return {
    provider: "openai",
    model,
    online_required: true,
    free_tier: false,
    paid_capable: true,
    billing_required: true,
    multimodal: true,
    max_context: null, // model-dependent (gpt-4o-mini etc.) — not assumed here
    research_tools: false,
    local: false,
    notes: [
      "OPTIONAL provider — never the default. Billed per token by OpenAI.",
      "Rejected by default: ALLOW_PAID_AI=false and MONTHLY_AI_BUDGET_USD=0 fail closed.",
      "Runs ONLY when the owner explicitly sets ALLOW_PAID_AI=true (or a budget > 0) in the SERVER environment.",
    ],
  };
}

/** Full registry for UI display, in activation-precedence order (free first). */
export function capabilityRegistry(env: {
  GEMINI_MODEL: string;
  SOPHIRA_MODEL: string;
}): ProviderCapability[] {
  return [...localCapabilities(), geminiCapabilities(env.GEMINI_MODEL), openaiCapabilities(env.SOPHIRA_MODEL)];
}

/* ------------------------------------------------------------------ */
/* "No Unexpected Charges" security setting (server-enforced).          */
/*                                                                     */
/* The setting is the SERVER ENVIRONMENT — deliberately not a frontend  */
/* control: ALLOW_PAID_AI=false and MONTHLY_AI_BUDGET_USD=0 mean paid   */
/* providers are rejected inside resolveProviders(), server-side,       */
/* before any network call. The UI only DISPLAYS the state.             */
/* ------------------------------------------------------------------ */

export interface NoUnexpectedChargesState {
  enabled: boolean;
  detail: string;
}

export function noUnexpectedCharges(paidAllowedFlag: boolean): NoUnexpectedChargesState {
  return paidAllowedFlag
    ? {
        enabled: false,
        detail:
          "OFF — the owner explicitly allowed paid AI (ALLOW_PAID_AI=true or MONTHLY_AI_BUDGET_USD>0) in the server environment.",
      }
    : {
        enabled: true,
        detail:
          "ON — ALLOW_PAID_AI=false and MONTHLY_AI_BUDGET_USD=0. Paid providers and unverified models are rejected server-side before any network call.",
      };
}

/**
 * STARTUP DIAGNOSTIC — returns ONLY the five allowed fields and NOTHING
 * else: no keys, no values, no extra metadata. Server-rendered at startup
 * by /api/provider-diagnostics (owner-guarded).
 */
export interface StartupDiagnostics {
  configured_provider: string;
  configured_model: string;
  local_model_availability: { available: boolean; model_ids: string[]; detail: string };
  free_tier_mode: boolean;
  paid_ai_allowed: "yes" | "no";
}

export function startupDiagnostics(env: {
  AI_PROVIDER: string;
  GEMINI_MODEL: string;
  SOPHIRA_MODEL: string;
  GEMINI_API_KEY: string;
  OPENAI_API_KEY: string;
  ALLOW_PAID_AI: string;
  MONTHLY_AI_BUDGET_USD: string;
}): StartupDiagnostics {
  const locals = LOCAL_MODELS;
  return {
    configured_provider: env.AI_PROVIDER,
    configured_model: env.GEMINI_API_KEY || env.OPENAI_API_KEY ? (env.GEMINI_API_KEY ? env.GEMINI_MODEL : env.SOPHIRA_MODEL) : "local-only",
    local_model_availability: {
      // Availability = models registered and downloadable. Whether one is
      // already DOWNLOADED is client state (IndexedDB on the device) and is
      // shown on the Offline page — the server cannot see it, and this
      // endpoint does not pretend otherwise.
      available: locals.length > 0,
      model_ids: locals.map((m) => m.id),
      detail: `${locals.length} local model(s) registered for download; download state is per-device (Offline page)`,
    },
    free_tier_mode: Boolean(env.GEMINI_API_KEY) && VERIFIED_FREE_TIER_GEMINI_MODELS.includes(env.GEMINI_MODEL),
    paid_ai_allowed:
      env.ALLOW_PAID_AI === "true" || (parseFloat(env.MONTHLY_AI_BUDGET_USD || "0") || 0) > 0 ? "yes" : "no",
  };
}
