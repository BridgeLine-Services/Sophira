/**
 * NATIVE APP URL RESOLUTION (2026-10-05) — no silent production fallback.
 *
 * The native shells (Capacitor android/ios, Tauri desktop) load the
 * deployed Sophira web app. They must NEVER silently point at a fake or
 * placeholder URL:
 *
 *   RELEASE builds: SOPHIRA_APP_URL must be defined, valid, and NOT a
 *   placeholder — otherwise the build FAILS with a clear error.
 *
 *   DEVELOPMENT builds: an EXPLICIT development configuration is used
 *   when SOPHIRA_APP_URL is not set (SOPHIRA_DEV_URL, falling back to the
 *   project's existing dev site URL NEXT_PUBLIC_SITE_URL →
 *   http://localhost:3000). It is chosen loudly, never silently.
 *
 *   A PROVIDED URL is always validated strictly — a malformed or
 *   placeholder SOPHIRA_APP_URL fails the build even in dev mode,
 *   because there is no silent fallback to hide behind anymore.
 *
 * Pure and deterministic — offline-testable (tests/run.ts §21).
 */

/** The old silent fallback this module exists to remove. */
export const REMOVED_FALLBACK_URL = "https://sophira.example.com";

/** Placeholder-ish hostnames that must never ship in a release build. */
export const PLACEHOLDER_PATTERNS: RegExp[] = [
  /^sophira\.example\.com$/i,
  /(^|\.)example\.(com|org|net)$/i,
  /(^|\.)example\.(com|org)\.?(:\d+)?$/i,
  /^your-[-a-z0-9]*domain/i,
  /your-sophira-domain/i,
  /(^|\.)(placeholder|changeme|replace-me)/i,
];

export interface UrlValidation {
  ok: boolean;
  url: string | null;
  errors: string[];
}

function isPlaceholderUrl(u: URL): boolean {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(u.hostname) || re.test(u.toString()));
}

/**
 * Strict validation used whenever a URL will be baked into a build.
 * Release URLs must be https with a real hostname and no credentials.
 */
export function validateNativeAppUrl(raw: string, mode: "release" | "dev" = "release"): UrlValidation {
  const errors: string[] = [];
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { ok: false, url: null, errors: ["SOPHIRA_APP_URL is empty"] };
  }
  let u: URL;
  try {
    u = new URL(trimmed);
  } catch {
    return { ok: false, url: null, errors: [`"${trimmed}" is not a valid URL`] };
  }
  if (isPlaceholderUrl(u)) {
    errors.push(`"${u.toString()}" is a placeholder URL — set the real SOPHIRA_APP_URL deployment URL`);
  }
  if (mode === "release") {
    if (u.protocol !== "https:") {
      errors.push(`the URL must use https (got "${u.protocol}") — auth tokens must never cross plaintext`);
    }
    if (/^localhost$|127\.0\.0\.1|0\.0\.0\.0|::1/.test(u.hostname)) {
      errors.push("a release build cannot point at localhost — set SOPHIRA_APP_URL to the deployed app");
    }
  } else {
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      errors.push(`the URL must use http or https (got "${u.protocol}")`);
    }
  }
  if (u.username || u.password) errors.push("the URL must not contain credentials");
  if (!u.hostname) errors.push("the URL has no hostname");
  if (errors.length > 0) return { ok: false, url: null, errors };
  // Canonical form: no trailing slash so server.url joins paths predictably.
  const clean = u.toString().replace(/\/+$/, "");
  return { ok: true, url: clean, errors: [] };
}

export const DEV_DEFAULT_URL = "http://localhost:3000";

/** Node's process.env-shaped record (string values, not a strict interface). */
export interface NativeEnv {
  SOPHIRA_APP_URL?: string;
  SOPHIRA_DEV_URL?: string;
  NEXT_PUBLIC_SITE_URL?: string;
  SOPHIRA_NATIVE_RELEASE?: string;
  [key: string]: string | undefined;
}

/** Release mode is explicit: set by release scripts and CI, never guessed. */
export function isReleaseBuild(env: NativeEnv): boolean {
  return env.SOPHIRA_NATIVE_RELEASE === "1" || env.SOPHIRA_NATIVE_RELEASE === "true";
}

export interface ResolvedNativeUrl {
  url: string;
  cleartext: boolean;
  mode: "release" | "dev";
  basis: string;
}

/**
 * Resolve the server URL for a native shell build. THROWS on any
 * release-mode violation or on a provided-but-invalid URL — the build
 * fails loudly instead of silently pointing at a fake URL.
 */
export function resolveNativeServerUrl(env: NativeEnv): ResolvedNativeUrl {
  const mode: "release" | "dev" = isReleaseBuild(env) ? "release" : "dev";
  const provided = (env.SOPHIRA_APP_URL ?? "").trim();
  if (provided) {
    const v = validateNativeAppUrl(provided, mode);
    if (!v.ok) {
      throw new Error(
        `SOPHIRA_APP_URL is invalid — refusing to build:\n  - ${v.errors.join("\n  - ")}`
      );
    }
    return { url: v.url as string, cleartext: false, mode, basis: "SOPHIRA_APP_URL" };
  }
  if (mode === "release") {
    throw new Error(
      "SOPHIRA_APP_URL must be defined for a release build — refusing to build. " +
        "Set the deployment URL (e.g. SOPHIRA_APP_URL=https://your-sophira-domain npx cap sync android). " +
        `There is no fallback anymore (the old silent fallback ${REMOVED_FALLBACK_URL} was removed).`
    );
  }
  // Development builds use the explicit development configuration.
  const devCandidate = (env.SOPHIRA_DEV_URL ?? env.NEXT_PUBLIC_SITE_URL ?? DEV_DEFAULT_URL).trim();
  const v = validateNativeAppUrl(devCandidate, "dev");
  if (!v.ok) {
    throw new Error(
      `The development URL configuration is invalid — refusing to build:\n  - ${v.errors.join("\n  - ")}`
    );
  }
  const isLocal = /^localhost$|127\.0\.0\.1|0\.0\.0\.0|::1/.test(new URL(v.url as string).hostname);
  return {
    url: v.url as string,
    cleartext: isLocal, // http://localhost is the ONLY cleartext allowed
    mode,
    basis: env.SOPHIRA_DEV_URL ? "SOPHIRA_DEV_URL (development)"
      : env.NEXT_PUBLIC_SITE_URL ? "NEXT_PUBLIC_SITE_URL (development)"
        : `${DEV_DEFAULT_URL} (development default)`,
  };
}
