/**
 * FEATURE SWITCHES (2026-11-15).
 *
 * The repository had no feature-flag infrastructure at all (see
 * docs/PRESERVATION_AUDIT_2026-11-15.md §4.6), so this is the smallest thing that satisfies the
 * directive's Part 2.4 without inventing a system:
 *
 *  - A flag is ON only when its environment variable is exactly "1" or "true". Anything else,
 *    including a typo, means OFF. Default OFF is the point: new capability must be asked for.
 *  - Turning a flag off never breaks the existing app: the manual essay workflow is not behind
 *    any flag, and every flag-gated route refuses with a plain message instead of half-working.
 *  - The state is readable so the Owner dashboard and /api/health can report it truthfully.
 *
 * Server-only by design: it reads process.env. Never import this into a client component.
 */

/** The environment shape these functions read. Deliberately not NodeJS.ProcessEnv: tests must be able to pass a plain object. */
export type EnvLike = Record<string, string | undefined>;

export interface FlagDefinition {
  key: FlagKey;
  env: string;
  /** What a member gets when it is on. */
  what: string;
  /** What still works when it is off. */
  whenOff: string;
  /** Rollback instruction, in the Owner's terms. */
  rollback: string;
}

export const FLAG_KEYS = ["autonomous_essay"] as const;
export type FlagKey = (typeof FLAG_KEYS)[number];

export const FLAGS: Readonly<Record<FlagKey, FlagDefinition>> = {
  autonomous_essay: {
    key: "autonomous_essay",
    env: "SOPHIRA_AUTONOMOUS_ESSAY",
    what: "A student can start an assignment run that plans, drafts, audits and verifies the whole piece without requesting each section.",
    whenOff: "The manual essay workflow is unchanged: plan, approve or edit the outline, then draft one section at a time.",
    rollback: "Unset SOPHIRA_AUTONOMOUS_ESSAY (or set it to 0) and redeploy. Run records stay in the database, no student work is lost, and the manual workflow behaves exactly as it does today.",
  },
};

export interface FlagState {
  key: FlagKey;
  enabled: boolean;
  /** Where the value came from, for an honest status line. */
  source: string;
  detail: string;
}

/** The only place the on/off question is answered. */
export function flagEnabled(key: FlagKey, env: EnvLike = process.env): boolean {
  const raw = env[FLAGS[key].env];
  return raw === "1" || raw === "true";
}

export function flagStates(env: EnvLike = process.env): FlagState[] {
  return FLAG_KEYS.map((key) => {
    const def = FLAGS[key];
    const raw = env[def.env];
    const set = raw !== undefined && raw !== "";
    const enabled = flagEnabled(key, env);
    return {
      key,
      enabled,
      source: def.env,
      detail: enabled
        ? `On (${def.env} is set). ${def.what}`
        : set
          ? `Off: ${def.env} is set to "${raw}", which is not "1" or "true". ${def.whenOff}`
          : `Off: ${def.env} is not set. ${def.whenOff}`,
    };
  });
}

/** The message a gated route returns. Plain language, no jargon, and it says what still works. */
export function flagDisabledMessage(key: FlagKey): string {
  const def = FLAGS[key];
  return `This is switched off in this deployment. ${def.whenOff} An administrator enables it with ${def.env}=1.`;
}
