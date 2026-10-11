/**
 * OAUTH STATE + TOKEN HELPERS (integrations, 2026-10-11). Pure and unit
 * tested: the authorization 'state' value guards against CSRF on both
 * provider callbacks, and refresh decisions are explicit, testable rules.
 * Tokens themselves are NEVER handled here (see connections.ts, server-only).
 */
import { randomBytes, timingSafeEqual } from "crypto";

export const STATE_COOKIE = "sophira_oauth_state";
export const STATE_MAX_AGE_SECONDS = 600;

export function createState(): string {
  return randomBytes(24).toString("base64url");
}

/** Constant-time comparison; any mismatch is fatal (never partially valid). */
export function verifyState(expected: string | null | undefined, provided: string | null | undefined): boolean {
  if (!expected || !provided || expected.length !== provided.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
  } catch {
    return false;
  }
}

/** Refresh when the token is expired or expires within the next 60 seconds. */
export function needsRefresh(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return true;
  const exp = Date.parse(expiresAt);
  if (!Number.isFinite(exp)) return true;
  return exp - nowMs < 60_000;
}

// ---- Provider endpoints (documented, current as of 2026-10) ----
export const MICROSOFT_AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
export const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
/** Narrowest delegated permission set for the promised operations: read/write the user's own files, plus offline access so reconnects keep working. */
export const MICROSOFT_SCOPES = "Files.ReadWrite offline_access";
export const MICROSOFT_GRAPH = "https://graph.microsoft.com/v1.0";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** drive.file: ONLY documents created or explicitly opened through Sophira — never the whole Drive. */
export const GOOGLE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_DOCS_API = "https://docs.googleapis.com/v1";
export const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";

export function microsoftAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL(MICROSOFT_AUTHORIZE_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", MICROSOFT_SCOPES);
  u.searchParams.set("state", state);
  u.searchParams.set("response_mode", "query");
  return u.toString();
}

export function googleAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const u = new URL(GOOGLE_AUTHORIZE_URL);
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", GOOGLE_SCOPE);
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}
