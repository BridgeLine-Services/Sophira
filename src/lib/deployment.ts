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

export interface DeploymentReadiness {
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
    ready,
    missing,
    optional_missing,
    detail: ready
      ? `Deployment fully configured${optional_missing.length ? ` (optional: ${optional_missing.join("; ")})` : ""}.`
      : `Deployment NOT ready: ${missing.join("; ")}.`,
  };
}
