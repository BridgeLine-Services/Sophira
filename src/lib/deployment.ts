/**
 * Deployment-readiness evaluation (2026-10-05 round).
 *
 * Closes the remaining in-repo gap of the production-release-gate audit
 * item: the release workflow now REFUSES to ship against a misconfigured
 * deployment by checking the live /api/health of the target URL
 * (scripts/verify-deployment.mjs). This module holds the single source of
 * truth for the rules, mirrored in that script (both self-tested — keep
 * them in sync).
 *
 * Required to release: supabase (auth + db), supabase_service_role (used
 * by the AI/extract/account routes), ai (essay generation), and a healthy
 * response from a Sophira instance. Optional: search (web research
 * degrades gracefully when unconfigured — reported, never blocking).
 */

export interface HealthConfiguration {
  supabase?: boolean;
  supabase_service_role?: boolean;
  ai?: boolean;
  search?: boolean;
}

export interface HealthPayload {
  ok?: boolean;
  name?: string;
  configuration?: HealthConfiguration;
}

/**
 * States a non-technical reader can act on. Deliberately small: every capability
 * resolves to one of these, so the owner never reads a raw boolean or an HTTP code.
 */
export type CapabilityState =
  | "ready"
  | "needs_attention"
  | "not_connected"
  | "not_configured"
  | "checking"
  | "unable_to_verify";

export interface DeploymentCapability {
  key: string;
  label: string;
  state: CapabilityState;
  /** One plain sentence. No hostnames, keys, tokens, SQL, or provider jargon. */
  message: string;
  /** Optional capabilities must never make the whole application look broken. */
  optional: boolean;
}

export interface DeploymentReadiness {
  capabilities: DeploymentCapability[];
  ready: boolean;
  missing: string[];        // required capabilities that are NOT configured
  optional_missing: string[]; // capabilities that degrade gracefully
  detail: string;
}

const REQUIRED: { key: keyof HealthConfiguration; label: string }[] = [
  { key: "supabase", label: "Supabase (auth + database)" },
  { key: "supabase_service_role", label: "Supabase service-role key (AI/extract/account routes)" },
  { key: "ai", label: "AI provider key" },
];

type DeepChecks = { database?: string; auth?: string; schema?: string };

/**
 * Turns the health payload into capability states a student or owner can read.
 *
 * Two honest rules drive this:
 *  1. A capability is only "ready" when its check actually succeeded. Reading an
 *     environment variable proves a setting exists, not that the database answers.
 *  2. An optional integration being absent is "not connected", never a failure of
 *     the application. Canvas, Google, Microsoft and research are optional.
 *
 * `checks` is present only after a deep check (/api/health?deep=1). Without it,
 * storage and sign-in report "unable to verify" rather than guessing "ready".
 */
export function describeDeploymentCapabilities(health: unknown): DeploymentCapability[] {
  const h = (health ?? {}) as HealthPayload & { checks?: DeepChecks };
  const cfg = h.configuration ?? {};
  const checks: DeepChecks = h.checks ?? {};

  const caps: DeploymentCapability[] = [];

  const serviceOk = h.ok === true && (!h.name || h.name === "sophira");
  caps.push({
    key: "application",
    label: "Sophira",
    state: serviceOk ? "ready" : "needs_attention",
    message: serviceOk
      ? "Sophira is running and answering."
      : "Sophira is not answering as expected. An administrator needs to look at this.",
    optional: false,
  });

  // Storage: only a real query proves this. Configuration alone proves nothing.
  const storageState: CapabilityState =
    cfg.supabase !== true ? "not_configured"
      : checks.database === "ready" ? "ready"
      : checks.database === "unreachable" ? "needs_attention"
      : "unable_to_verify";
  caps.push({
    key: "database",
    label: "Private storage",
    state: storageState,
    message:
      storageState === "ready" ? "Your work is stored privately and Sophira can reach it."
      : storageState === "needs_attention" ? "Sophira cannot reach its private storage right now. Nothing you saved has been deleted."
      : storageState === "not_configured" ? "An administrator needs to finish setting up storage before work can be saved."
      : "Storage is set up, but this quick check did not open it. Run the full check to confirm.",
    optional: false,
  });

  // Sign-in.
  const authState: CapabilityState =
    cfg.supabase !== true ? "not_configured"
      : checks.auth === "ready" ? "ready"
      : checks.auth === "unreachable" ? "needs_attention"
      : "unable_to_verify";
  caps.push({
    key: "auth",
    label: "Signing in",
    state: authState,
    message:
      authState === "ready" ? "You can sign in."
      : authState === "needs_attention" ? "Signing in is not responding right now. Your account and work are unaffected."
      : authState === "not_configured" ? "An administrator needs to finish setting up sign-in."
      : "Sign-in is set up, but this quick check did not test it.",
    optional: false,
  });

  // AI: server-side help needs a provider. Offline mode works without one, and
  // saying so prevents an owner from believing the whole app is unusable.
  const aiState: CapabilityState = cfg.ai === true ? "ready" : "needs_attention";
  caps.push({
    key: "ai",
    label: "Academic help",
    state: aiState,
    message:
      aiState === "ready"
        ? "Sophira can help with assignments, explanations and writing."
        : "Online academic help is not set up yet. Studying, notes and offline help still work.",
    optional: false,
  });

  caps.push({
    key: "research",
    label: "Online research",
    state: cfg.search === true ? "ready" : "not_connected",
    message: cfg.search === true
      ? "Sophira can look up sources for you."
      : "Source lookup is not connected. Everything else still works.",
    optional: true,
  });

  // Per-student connections: the deployment cannot know these, and claiming either
  // way would be a guess. State exactly that.
  for (const [key, label, service] of [
    ["canvas", "Canvas courses", "Canvas"],
    ["google", "Google Docs", "Google Docs"],
    ["microsoft", "Microsoft Word", "Microsoft Word"],
  ] as const) {
    caps.push({
      key,
      label,
      state: "not_connected",
      message: `Not connected on this deployment check. Each student connects ${service} themselves, and doing nothing keeps working.`,
      optional: true,
    });
  }

  caps.push({
    key: "notifications",
    label: "Notifications",
    state: "needs_attention",
    message: "Brief pop-up messages and email summaries work. A permanent notification list is not built yet.",
    optional: true,
  });

  return caps;
}

export function evaluateDeploymentReadiness(health: unknown): DeploymentReadiness {
  const h = (health ?? {}) as HealthPayload;
  const cfg = h.configuration ?? {};

  const missing: string[] = [];
  for (const req of REQUIRED) {
    if (cfg[req.key] !== true) missing.push(req.label);
  }

  // The payload must come from a live, healthy Sophira instance.
  if (h.ok !== true) missing.push("the /api/health response did not report ok");
  if (h.name && h.name !== "sophira") missing.push(`unexpected service name "${h.name}" — this is not a Sophira deployment`);

  const optional_missing: string[] = [];
  if (cfg.search !== true) optional_missing.push("web-search provider (research degrades gracefully — not blocking)");

  const ready = missing.length === 0;
  return {
    capabilities: describeDeploymentCapabilities(health),
    ready,
    missing,
    optional_missing,
    detail: ready
      ? `Deployment fully configured${optional_missing.length ? ` (optional: ${optional_missing.join("; ")})` : ""}.`
      : `Deployment NOT ready: ${missing.join("; ")}.`,
  };
}
