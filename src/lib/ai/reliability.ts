/**
 * Phase 1 — AI reliability core (pure, injectable clock, no network).
 *
 * The failure this file exists to prevent: a local inference server that goes
 * to sleep makes EVERY request wait the full timeout before falling back, so
 * the app feels broken even though a fallback provider would have answered in a
 * second. A circuit breaker turns "dead and slow" into "dead and skipped",
 * while a half-open trial makes sure a recovered server is picked up again
 * without a restart.
 *
 * Deliberate rules:
 *  - a breaker NEVER changes which providers are configured or allowed; it only
 *    shortens the wait for a provider that is already failing,
 *  - the trial after cooldown is a SINGLE request, so a still-dead server cannot
 *    flood the network,
 *  - a paid provider is never enabled by the breaker (cost policy is untouched),
 *  - nothing here is written to the database: state is in-process and resets on
 *    restart, which is the correct scope for a network fault.
 */

export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerConfig {
  /** Consecutive failures before the breaker opens. */
  failureThreshold: number;
  /** How long the breaker stays open before one trial request. */
  cooldownMs: number;
  /** Failures that arrive slower than this are not counted as consecutive. */
  resetAfterMs: number;
}

export const DEFAULT_BREAKER: BreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  resetAfterMs: 10 * 60_000,
};

interface BreakerEntry {
  failures: number;
  openedAt: number | null;
  lastFailureAt: number | null;
  trialInFlight: boolean;
  totalFailures: number;
  totalSuccesses: number;
  lastErrorCode: string | null;
}

export interface BreakerSnapshot {
  key: string;
  state: BreakerState;
  failures: number;
  totalFailures: number;
  totalSuccesses: number;
  lastErrorCode: string | null;
  opensAtMs: number | null;
  msUntilTrial: number | null;
}

/** In-process registry. One per provider/endpoint pair. */
export class CircuitRegistry {
  private entries = new Map<string, BreakerEntry>();
  private config: BreakerConfig;
  private now: () => number;

  constructor(config: Partial<BreakerConfig> = {}, now: () => number = () => Date.now()) {
    this.config = { ...DEFAULT_BREAKER, ...config };
    this.now = now;
  }

  private entry(key: string): BreakerEntry {
    const found = this.entries.get(key);
    if (found) return found;
    const fresh: BreakerEntry = {
      failures: 0,
      openedAt: null,
      lastFailureAt: null,
      trialInFlight: false,
      totalFailures: 0,
      totalSuccesses: 0,
      lastErrorCode: null,
    };
    this.entries.set(key, fresh);
    return fresh;
  }

  /** May this provider be called right now? */
  canAttempt(key: string): { allowed: boolean; trial: boolean; state: BreakerState; msUntilTrial: number | null } {
    const e = this.entry(key);
    if (e.openedAt === null) return { allowed: true, trial: false, state: "closed", msUntilTrial: null };
    const elapsed = this.now() - e.openedAt;
    if (elapsed < this.config.cooldownMs) {
      return { allowed: false, trial: false, state: "open", msUntilTrial: this.config.cooldownMs - elapsed };
    }
    if (e.trialInFlight) {
      // Exactly one trial at a time: a dead server must not be flooded.
      return { allowed: false, trial: false, state: "half-open", msUntilTrial: 0 };
    }
    return { allowed: true, trial: true, state: "half-open", msUntilTrial: 0 };
  }

  recordSuccess(key: string): void {
    const e = this.entry(key);
    e.failures = 0;
    e.openedAt = null;
    e.trialInFlight = false;
    e.totalSuccesses += 1;
  }

  recordFailure(key: string, errorCode = "unknown"): void {
    const e = this.entry(key);
    const now = this.now();
    // A failure long after the previous one is a new incident, not a pattern.
    if (e.lastFailureAt !== null && now - e.lastFailureAt > this.config.resetAfterMs) e.failures = 0;
    e.failures += 1;
    e.totalFailures += 1;
    e.lastFailureAt = now;
    e.lastErrorCode = errorCode;
    e.trialInFlight = false;
    if (e.failures >= this.config.failureThreshold) e.openedAt = now;
  }

  /** Called when a half-open trial request is dispatched. */
  markTrialStarted(key: string): void {
    this.entry(key).trialInFlight = true;
  }

  snapshot(key: string): BreakerSnapshot {
    const e = this.entry(key);
    const state: BreakerState = e.openedAt === null ? "closed" : this.canAttempt(key).trial ? "half-open" : "open";
    const msUntilTrial = e.openedAt === null ? null : Math.max(0, this.config.cooldownMs - (this.now() - e.openedAt));
    return {
      key,
      state,
      failures: e.failures,
      totalFailures: e.totalFailures,
      totalSuccesses: e.totalSuccesses,
      lastErrorCode: e.lastErrorCode,
      opensAtMs: e.openedAt,
      msUntilTrial,
    };
  }

  all(): BreakerSnapshot[] {
    return [...this.entries.keys()].sort().map((k) => this.snapshot(k));
  }

  reset(key?: string): void {
    if (key) this.entries.delete(key);
    else this.entries.clear();
  }
}

/** The process-wide registry used by the provider layer. */
export const aiBreakers = new CircuitRegistry();

/** Stable key: a provider is only as healthy as the endpoint behind it. */
export function breakerKey(provider: string, endpoint?: string | null): string {
  const host = endpoint ? safeHost(endpoint) : "";
  return host ? `${provider}@${host}` : provider;
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}

export interface HealthRow {
  key: string;
  state: BreakerState;
  ok: boolean;
  plainEnglish: string;
}

/**
 * Health for one provider, in words a non-technical owner can act on. A closed
 * breaker with no traffic is "not tried yet", never "healthy".
 */
export function describeBreaker(snap: BreakerSnapshot): HealthRow {
  const attempts = snap.totalFailures + snap.totalSuccesses;
  if (snap.state === "open") {
    const secs = Math.ceil((snap.msUntilTrial ?? 0) / 1000);
    return {
      key: snap.key,
      state: snap.state,
      ok: false,
      plainEnglish: `Not responding (${snap.failures} failures in a row). Sophira is using the next available option and will retry this one in about ${secs} seconds.`,
    };
  }
  if (snap.state === "half-open") {
    return {
      key: snap.key,
      state: snap.state,
      ok: true,
      plainEnglish: "Testing whether it is back. The next answer will show whether it recovered.",
    };
  }
  if (attempts === 0) {
    return { key: snap.key, state: snap.state, ok: true, plainEnglish: "Ready, but nothing has been sent to it yet this session." };
  }
  if (snap.failures > 0) {
    return {
      key: snap.key,
      state: snap.state,
      ok: true,
      plainEnglish: `Answering, with ${snap.failures} recent failure${snap.failures === 1 ? "" : "s"} (last: ${snap.lastErrorCode ?? "unknown"}).`,
    };
  }
  if (snap.totalFailures > 0) {
    // Recovered: still worth saying, so a flapping provider is visible.
    return {
      key: snap.key,
      state: snap.state,
      ok: true,
      plainEnglish: `Answering again after ${snap.totalFailures} earlier failure${snap.totalFailures === 1 ? "" : "s"} (last: ${snap.lastErrorCode ?? "unknown"}).`,
    };
  }
  return { key: snap.key, state: snap.state, ok: true, plainEnglish: `Answering normally (${snap.totalSuccesses} successful requests).` };
}

/** Classifies a thrown error so the breaker and the health page use one vocabulary. */
export function errorCodeOf(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const lower = message.toLowerCase();
  if (lower.includes("abort") || lower.includes("timeout") || lower.includes("timed out")) return "timeout";
  if (lower.includes("econnrefused") || lower.includes("fetch failed") || lower.includes("network")) return "unreachable";
  if (lower.includes("429") || lower.includes("rate limit") || lower.includes("quota")) return "rate_limited";
  if (lower.includes("401") || lower.includes("403") || lower.includes("unauthor")) return "unauthorized";
  if (lower.includes("500") || lower.includes("502") || lower.includes("503") || lower.includes("504")) return "server_error";
  if (lower.includes("json") || lower.includes("parse")) return "bad_response";
  return "unknown";
}

/**
 * Runs one provider call with breaker accounting. `fn` receives nothing and is
 * only called when the breaker allows it, so the caller's fallback chain is
 * untouched: an open breaker throws BreakerOpenError immediately, which the
 * existing routing treats as "this provider did not answer".
 */
export class BreakerOpenError extends Error {
  constructor(public readonly key: string, public readonly msUntilTrial: number) {
    super(`Circuit open for ${key}; next trial in ${Math.ceil(msUntilTrial / 1000)}s`);
    this.name = "BreakerOpenError";
  }
}

export async function withBreaker<T>(
  registry: CircuitRegistry,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const gate = registry.canAttempt(key);
  if (!gate.allowed) throw new BreakerOpenError(key, gate.msUntilTrial ?? 0);
  if (gate.trial) registry.markTrialStarted(key);
  try {
    const out = await fn();
    registry.recordSuccess(key);
    return out;
  } catch (err) {
    registry.recordFailure(key, errorCodeOf(err));
    throw err;
  }
}
