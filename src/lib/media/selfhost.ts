/**
 * SELF-HOSTED MEDIA SERVICES (Phase 3b, 2026-11-09).
 *
 * Why this file exists: the owner approved open-source OCR (Tesseract) and
 * speech-to-text (Whisper), explicitly NOT a paid OCR/transcription vendor and
 * NOT a new recurring subscription.
 *
 * Architectural fact (documented, not hidden): a serverless Vercel function
 * cannot run Tesseract or Whisper. Both are native binaries with their own
 * CPU/GPU and time budgets. They therefore run on the SAME self-hosted machine
 * that already serves Sophira's local LLM, exposed over an HTTP contract:
 *
 *   SOPHIRA_OCR_URL  -> an OpenAI-agnostic OCR service (Tesseract wrapper)
 *   SOPHIRA_OCR_TOKEN
 *   SOPHIRA_ASR_URL  -> a Whisper-compatible server (whisper.cpp / faster-whisper)
 *   SOPHIRA_ASR_TOKEN
 *
 * Contract details live in docs/SELF_HOSTED_OCR_ASR.md. Everything here is
 * optional: with no URL configured, Sophira keeps its current honest behaviour
 * (it says the file cannot be read and keeps the original).
 *
 * Safety rules enforced here:
 *  - The endpoint is validated with the SAME rule as the local LLM endpoint
 *    (https, or a private host explicitly opted into) — no new network surface.
 *  - Tokens never appear in messages, logs, or returned objects.
 *  - Every call is bounded by a timeout; no retry loops.
 */
import { validateInferenceEndpoint } from "../ai/provider";

export type SelfHostedKind = "ocr" | "asr";

export interface SelfHostedConfig {
  kind: SelfHostedKind;
  configured: boolean;
  baseUrl: string | null;
  token: string | null;
  /** why it is not usable, in plain words (null when fine) */
  problem: string | null;
}

const ENV_NAMES: Record<SelfHostedKind, { url: string; token: string }> = {
  ocr: { url: "SOPHIRA_OCR_URL", token: "SOPHIRA_OCR_TOKEN" },
  asr: { url: "SOPHIRA_ASR_URL", token: "SOPHIRA_ASR_TOKEN" },
};

export function readSelfHostedConfig(
  kind: SelfHostedKind,
  env: Record<string, string | undefined> = process.env
): SelfHostedConfig {
  const names = ENV_NAMES[kind];
  const raw = (env[names.url] || "").trim().replace(/\/+$/, "");
  const token = (env[names.token] || "").trim() || null;
  if (!raw) {
    return { kind, configured: false, baseUrl: null, token, problem: "not configured" };
  }
  // Media carries member documents and recordings, so a PUBLIC endpoint must
  // be encrypted even though the shared rule tolerates http. Loopback and
  // RFC1918 hosts may stay http (that is how a home server is reached).
  const host = (() => {
    try {
      return new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, "");
    } catch {
      return "";
    }
  })();
  const isLoopbackOrPrivate =
    host === "::1" || /^127\./.test(host) || /^10\./.test(host) ||
    /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "localhost";
  if (raw.startsWith("http://") && !isLoopbackOrPrivate) {
    return { kind, configured: false, baseUrl: null, token, problem: "must use https for a public host (member media must not travel unencrypted)" };
  }
  const verdict = validateInferenceEndpoint(raw);
  if (!verdict.ok) {
    // Never echo the URL: it may carry a token in a query string.
    return { kind, configured: false, baseUrl: null, token, problem: verdict.reason };
  }
  return { kind, configured: true, baseUrl: raw, token, problem: null };
}

export interface ProbeResult {
  configured: boolean;
  healthy: boolean;
  /** plain-English status; never contains a URL, token, or file content */
  detail: string;
}

/**
 * Bounded health probe. A misconfigured or sleeping service is reported as
 * unhealthy — never assumed working.
 */
export async function probeSelfHosted(
  kind: SelfHostedKind,
  opts: { timeoutMs?: number; env?: Record<string, string | undefined> } = {}
): Promise<ProbeResult> {
  const cfg = readSelfHostedConfig(kind, opts.env ?? process.env);
  if (!cfg.configured) {
    return {
      configured: false,
      healthy: false,
      detail:
        cfg.problem === "not configured"
          ? kind === "ocr"
            ? "No self-hosted OCR service is configured, so Sophira keeps saying plainly that it cannot read scanned files."
            : "No self-hosted transcription service is configured, so Sophira does not claim to transcribe audio or video."
          : `The self-hosted ${kind.toUpperCase()} address was rejected: ${cfg.problem}`,
    };
  }
  const timeoutMs = opts.timeoutMs ?? 4000;
  try {
    const res = await fetch(`${cfg.baseUrl}/health`, {
      method: "GET",
      cache: "no-store",
      headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return {
        configured: true,
        healthy: false,
        detail: `The self-hosted ${kind.toUpperCase()} service answered with status ${res.status}. Check that it is running and reachable from Sophira.`,
      };
    }
    return {
      configured: true,
      healthy: true,
      detail: `The self-hosted ${kind.toUpperCase()} service answered its health check.`,
    };
  } catch {
    return {
      configured: true,
      healthy: false,
      detail: `The self-hosted ${kind.toUpperCase()} service could not be reached (it may be asleep, stopped, or blocked). Nothing was sent to it.`,
    };
  }
}

/** Shared POST helper: bounded, token-safe, never throws. */
export async function postSelfHosted(
  kind: SelfHostedKind,
  path: string,
  body: FormData,
  opts: { timeoutMs?: number; env?: Record<string, string | undefined> } = {}
): Promise<{ ok: true; json: unknown } | { ok: false; reason: string }> {
  const cfg = readSelfHostedConfig(kind, opts.env ?? process.env);
  if (!cfg.configured) return { ok: false, reason: "not-configured" };
  try {
    const res = await fetch(`${cfg.baseUrl}${path}`, {
      method: "POST",
      body,
      cache: "no-store",
      headers: cfg.token ? { authorization: `Bearer ${cfg.token}` } : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120000),
    });
    if (!res.ok) return { ok: false, reason: `status-${res.status}` };
    const json = (await res.json()) as unknown;
    return { ok: true, json };
  } catch (err) {
    const name = (err as { name?: string })?.name || "";
    if (name === "TimeoutError" || name === "AbortError") return { ok: false, reason: "timeout" };
    return { ok: false, reason: "unreachable" };
  }
}
