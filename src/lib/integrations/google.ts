/**
 * GOOGLE DOCS / DRIVE HELPERS (server-only, 2026-10-11).
 * Token exchange, refresh, real connectivity verification, document
 * creation via the Docs API, and the pure request builder used by tests.
 * Scope is drive.file ONLY: documents created through Sophira — never the
 * whole Drive. Errors are honest; tokens are never logged.
 */
import { GOOGLE_TOKEN_URL, GOOGLE_DOCS_API, GOOGLE_DRIVE_API } from "./oauth-state";
import type { ExportArtifact } from "@/lib/documents/export";

export interface ProviderTokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
}

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export async function exchangeCode(code: string, redirectUri: string): Promise<ProviderTokens> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Google did not accept the sign-in. Nothing was saved; you can try again.");
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  if (!json.access_token) throw new Error("Google's response was missing an access token. Nothing was saved.");
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? null,
    expires_at: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<ProviderTokens> {
  const body = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Google could not renew access. Please reconnect your account.");
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? refreshToken,
    expires_at: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
  };
}

/** REAL connectivity verification: an actual Drive call with the drive.file scope. */
export async function verifyDriveFileScope(accessToken: string): Promise<{ ok: boolean; label: string | null }> {
  try {
    const res = await fetch(`${GOOGLE_DRIVE_API}/files?pageSize=1&fields=files(id,name)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, label: null };
    return { ok: true, label: null };
  } catch {
    return { ok: false, label: null };
  }
}

/**
 * PURE: build the Docs API batchUpdate requests for an artifact, appending
 * every heading, item, source line, and the full provenance into an empty
 * document. Sequential indices are computed exactly; the same artifact
 * always produces identical requests. Tested without any credentials.
 */
export function buildDocsRequests(a: ExportArtifact): {
  requests: { insertText: { location: { index: number }; text: string } }[];
  expectedLength: number;
} {
  const requests: { insertText: { location: { index: number }; text: string } }[] = [];
  let idx = 1;
  const push = (text: string) => {
    requests.push({ insertText: { location: { index: idx }, text } });
    idx += text.length;
  };
  push(`${a.title}\n`);
  for (const sec of a.sections) {
    push(`${sec.heading}\n`);
    for (const item of sec.items) push(`${item}\n`);
    if (sec.sources.length > 0) push(`Sources: ${sec.sources.join(", ")}\n`);
  }
  push("References & provenance\n");
  for (const p of a.provenance ?? []) {
    push(`${p.sourceLabel}: ${p.title}${p.locator ? ` (${p.locator})` : ""}\n`);
  }
  if (a.honestNote) push(`${a.honestNote}\n`);
  return { requests, expectedLength: idx - 1 };
}

/** Create a real Google Doc and insert the artifact's content. */
export async function createDocFromArtifact(
  accessToken: string,
  a: ExportArtifact,
): Promise<{ saved: true; url: string }> {
  const title = a.title.slice(0, 120);
  const created = await fetch(`${GOOGLE_DOCS_API}/documents?title=${encodeURIComponent(title)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (!created.ok) throw new Error(`Google Docs did not create the document (HTTP ${created.status}). Nothing was claimed as saved.`);
  const { documentId } = (await created.json()) as { documentId?: string };
  if (!documentId) throw new Error("Google Docs' response was missing the document id. Nothing was claimed as saved.");
  const { requests } = buildDocsRequests(a);
  if (requests.length > 0) {
    const updated = await fetch(`${GOOGLE_DOCS_API}/documents/${encodeURIComponent(documentId)}:batchUpdate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ requests }),
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
    if (!updated.ok) throw new Error(`Google Docs did not accept the content (HTTP ${updated.status}). The document was created but is empty — open it in Google Docs and retry, or delete it.`);
  }
  return { saved: true as const, url: `https://docs.google.com/document/d/${documentId}/edit` };
}
