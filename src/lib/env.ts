import manifestJson from "../config/env.manifest.json";

/**
 * Centralized environment-variable authority (2026-10-06).
 *
 * ONE manifest (src/config/env.manifest.json) defines every variable
 * Sophira uses - web runtime, AI, search, local modes, native release,
 * live tests. This module turns it into runtime validation. Nothing
 * else in the codebase may invent its own required-variable list:
 *   - src/app/api/health uses healthConfiguration()
 *   - src/lib/owner-setup uses present()
 *   - scripts/gen-env-example.mjs generates .env.example
 *   - scripts/verify-deployment.mjs --env-only validates deployments
 *   - tests/run.ts asserts .env.example and the manifest never disagree
 *
 * SECURITY CONTRACT - this module NEVER:
 *   - returns secret VALUES (only booleans, labels, and issue messages)
 *   - echoes any env value into an error message
 *   - exposes server-only variables to the browser (import server-side only;
 *     browser code keeps using NEXT_PUBLIC_* directly via its own bindings)
 * and it preserves the free-first AI safeguards:
 *   ALLOW_PAID_AI=false and MONTHLY_AI_BUDGET_USD=0 by default, Gemini
 *   preferred, OpenAI inert until paid AI is explicitly allowed.
 */

export type EnvVarDef = {
  name: string;
  section: string;
  required: "production" | "optional" | "conditional" | "native-release" | "live-tests" | "internal";
  scope: "public" | "server" | "ci";
  type: "url" | "https-url" | "enum" | "boolean" | "number" | "key" | "string";
  default?: string;
  enum?: string[];
  placeholder?: string;
  note?: string;
};

export interface Manifest {
  sections: { id: string; title: string }[];
  variables: EnvVarDef[];
}

export const ENV_MANIFEST = manifestJson as unknown as Manifest;
export const envVars = (): EnvVarDef[] => ENV_MANIFEST.variables;
export const envSections = (): { id: string; title: string }[] => ENV_MANIFEST.sections;

/** Presence-only check. Never returns or logs the value. */
export function present(name: string, env: Record<string, string | undefined> = process.env): boolean {
  const v = env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export interface EnvIssue {
  level: "error" | "warn";
  var: string;
  message: string; // never contains a value
}

export interface EnvCheckOptions {
  production: boolean;
  nativeRelease?: boolean;
  liveTests?: boolean;
}

function isUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return Boolean(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Pure validator: given an env bag and context, return every configuration
 * issue (categorized, human-readable, value-free). `ready` = no errors.
 */
export function checkEnv(
  env: Record<string, string | undefined>,
  opts: EnvCheckOptions
): { issues: EnvIssue[]; ready: boolean } {
  const issues: EnvIssue[] = [];
  const err = (v: string, message: string) => issues.push({ level: "error", var: v, message });
  const warn = (v: string, message: string) => issues.push({ level: "warn", var: v, message });

  for (const def of envVars()) {
    const set = present(def.name, env);
    const value = (env[def.name] ?? "").trim();

    if (set) {
      if ((def.type === "url" || def.type === "https-url") && !isUrl(value)) {
        err(def.name, `${def.name} is set but is not a valid URL.`);
      }
      if (def.type === "https-url" && !value.toLowerCase().startsWith("https://")) {
        err(def.name, `${def.name} must be an https:// URL (a plain URL would break auth redirects / native release builds).`);
      }
      if (def.type === "enum" && def.enum && !def.enum.includes(value.toLowerCase())) {
        err(def.name, `${def.name} must be one of: ${def.enum.join(", ")}.`);
      }
      if (def.type === "number" && Number.isNaN(Number(value))) {
        err(def.name, `${def.name} must be a number.`);
      }
      if (def.type === "boolean" && !["true", "false"].includes(value.toLowerCase())) {
        err(def.name, `${def.name} must be "true" or "false".`);
      }
    } else if (
      opts.production &&
      def.required === "production" &&
      def.scope !== "ci"
    ) {
      err(def.name, `${def.name} is REQUIRED in production but is not set. See .env.example ("${sectionTitle(def.section)}") for where to get it.`);
    }
  }

  // ---- conditional requirements ---------------------------------------
  if (env["SEARCH_PROVIDER"] === "custom" && !present("SEARCH_BASE_URL", env) &&
      (present("SEARCH_API_KEY", env) || env["SEARCH_PROVIDER"] === "custom")) {
    err("SEARCH_BASE_URL", "SEARCH_PROVIDER=custom requires SEARCH_BASE_URL (Brave-compatible endpoint).");
  }

  // ---- AI provider coherence (free-first preserved) --------------------
  const provider = (env["AI_PROVIDER"] || "auto").toLowerCase();
  const gemini = present("GEMINI_API_KEY", env);
  const openai = present("OPENAI_API_KEY", env);
  const paidAllowed = (env["ALLOW_PAID_AI"] || "false").toLowerCase() === "true";
  const budget = Number(env["MONTHLY_AI_BUDGET_USD"] || "0");

  if (provider === "gemini" && !gemini) {
    err("GEMINI_API_KEY", "AI_PROVIDER=gemini but GEMINI_API_KEY is not set.");
  }
  if (provider === "openai" && !openai) {
    err("OPENAI_API_KEY", "AI_PROVIDER=openai but OPENAI_API_KEY is not set.");
  }
  if (provider === "openai" && !paidAllowed) {
    warn("ALLOW_PAID_AI", "AI_PROVIDER=openai but ALLOW_PAID_AI is not true: paid requests will NOT be sent (free-first safeguard). Set ALLOW_PAID_AI=true and MONTHLY_AI_BUDGET_USD>0 to enable the paid fallback.");
  }
  if (paidAllowed && !openai) {
    warn("OPENAI_API_KEY", "ALLOW_PAID_AI=true but OPENAI_API_KEY is not set: the paid fallback is unusable.");
  }
  if (paidAllowed && budget <= 0) {
    warn("MONTHLY_AI_BUDGET_USD", "ALLOW_PAID_AI=true but MONTHLY_AI_BUDGET_USD is 0: no paid spend is possible. Raise the budget to enable the paid fallback.");
  }
  if (provider === "auto" && !gemini && !openai) {
    warn("GEMINI_API_KEY", "No AI provider key is configured (GEMINI_API_KEY preferred, free tier): AI features will honestly report not-configured until one is added.");
  }

  // ---- native release ----------------------------------------------------
  if (opts.nativeRelease) {
    for (const def of envVars()) {
      if (def.required === "native-release" && def.scope !== "ci" && !present(def.name, env)) {
        err(def.name, `${def.name} is required for native RELEASE builds.`);
      }
    }
  }

  // ---- live tests ---------------------------------------------------------
  if (opts.liveTests) {
    for (const def of envVars()) {
      if (def.required === "live-tests" && !present(def.name, env)) {
        err(def.name, `${def.name} is required when RUN_LIVE_TESTS=true.`);
      }
    }
  }

  return { issues, ready: issues.every((i) => i.level !== "error") };
}

function sectionTitle(id: string): string {
  return ENV_MANIFEST.sections.find((s) => s.id === id)?.title ?? id;
}

/**
 * The four capability booleans reported by /api/health. ai = "a remote AI
 * credential is present" (paid usage is gated SEPARATELY in
 * src/lib/ai/provider.ts by ALLOW_PAID_AI / MONTHLY_AI_BUDGET_USD).
 */
export function healthConfiguration(env: Record<string, string | undefined> = process.env) {
  return {
    supabase:
      present("NEXT_PUBLIC_SUPABASE_URL", env) &&
      present("NEXT_PUBLIC_SUPABASE_ANON_KEY", env),
    supabase_service_role: present("SUPABASE_SERVICE_ROLE_KEY", env),
    ai: present("OPENAI_API_KEY", env) || present("GEMINI_API_KEY", env),
  };
}
