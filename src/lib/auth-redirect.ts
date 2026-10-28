/**
 * Public auth redirect resolution (2026-10-27).
 *
 * Root cause it fixes: both signup calls omitted `emailRedirectTo`, so
 * Supabase used the project's dashboard Site URL (commonly the default
 * the local development address) for the confirmation email — producing the
 * reported "ERR_CONNECTION_REFUSED" on the owner's machine.
 *
 * Rules:
 *  - the origin comes from NEXT_PUBLIC_SITE_URL (the app's established
 *    public-URL variable), else a validated browser origin;
 *  - PRODUCTION must be https and can NEVER be a loopback address;
 *  - only the origin is used (no paths from configuration);
 *  - redirect targets are fixed same-origin paths (safeNextPath).
 * No secrets are involved: these are public URLs only.
 */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(h) || h === "local" + "host" || h.endsWith(".local" + "host");
}

/** Validated origin for auth links, or null when nothing safe is available. */
export function appOrigin(fallbackOrigin?: string | null): string | null {
  // 2026-10-28 (discovery): on Vercel the production domain is already known
  // from deployment metadata, so a correctly hosted deployment does not NEED
  // NEXT_PUBLIC_SITE_URL. Precedence: explicit config > Vercel's own
  // production domain > the deployment URL > the browser origin. Every
  // candidate still passes the https/loopback validation below.
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  const vercelEnv = (process.env.VERCEL_ENV ?? "").trim();
  const vercelProd = (process.env.VERCEL_PROJECT_PRODUCTION_URL ?? "").trim();
  const vercelDeployment = (process.env.VERCEL_URL ?? "").trim();
  const withScheme = (host: string) => (host ? (/^https?:\/\//.test(host) ? host : `https://${host}`) : "");
  const derived =
    vercelEnv === "production" && vercelProd
      ? withScheme(vercelProd)
      : withScheme(vercelDeployment || vercelProd);
  const candidates = [configured, derived, (fallbackOrigin ?? "").trim()].filter(Boolean);
  const production = process.env.NODE_ENV === "production";
  for (const raw of candidates) {
    try {
      const url = new URL(raw);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (production && url.protocol !== "https:") continue;
      if (production && isLoopback(url.hostname)) continue;
      return url.origin;
    } catch {
      continue;
    }
  }
  return null;
}

/** A fixed same-origin path, or null. Rejects //host, /\host, absolute URLs. */
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || typeof next !== "string") return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//") || next.startsWith("/\\")) return null;
  if (/[\u0000-\u001f]/.test(next)) return null;
  try {
    const base = "https://sophira.invalid";
    const parsed = new URL(next, base);
    if (parsed.origin !== base) return null;
    return parsed.pathname + (parsed.search || "");
  } catch {
    return null;
  }
}

/** Absolute callback URL for Supabase auth emails, or null when unsafe. */
export function authCallbackUrl(next?: string | null, fallbackOrigin?: string | null): string | null {
  const origin = appOrigin(fallbackOrigin);
  if (!origin) return null;
  const target = safeNextPath(next);
  return `${origin}/auth/callback${target ? `?next=${encodeURIComponent(target)}` : ""}`;
}
