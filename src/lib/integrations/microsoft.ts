/**
 * MICROSOFT GRAPH HELPERS (server-only, 2026-10-11).
 * Token exchange, refresh, and the real document operations used by the
 * Word integration. Errors are surfaced as honest Error messages — never
 * swallowed into fake success. Tokens are passed in, never logged.
 */
import { MICROSOFT_TOKEN_URL, MICROSOFT_GRAPH } from "./oauth-state";
import { summarizeMicrosoftItems, type DiscoveredDocument } from "./files";

export interface ProviderTokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  granted_scopes: string | null;
}

export function microsoftConfigured(): boolean {
  return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
}

export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<ProviderTokens> {
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: "Files.ReadWrite offline_access",
  });
  const res = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Microsoft did not accept the sign-in. Nothing was saved; you can try again.");
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  if (!json.access_token) throw new Error("Microsoft's response was missing an access token. Nothing was saved.");
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? null,
    expires_at: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
    granted_scopes: json.scope ?? null,
  };
}

export async function refreshAccessToken(refreshToken: string): Promise<ProviderTokens> {
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID!,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: "Files.ReadWrite offline_access",
  });
  const res = await fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) throw new Error("Microsoft could not renew access. Please reconnect your account.");
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? refreshToken,
    expires_at: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
    granted_scopes: json.scope ?? null,
  };
}

/** REAL connectivity verification: an actual Graph call against the user's own drive. */
export async function verifyDrive(accessToken: string): Promise<{ ok: boolean; label: string | null; accountId: string | null }> {
  try {
    const res = await fetch(`${MICROSOFT_GRAPH}/me/drive`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { ok: false, label: null, accountId: null };
    const json = (await res.json()) as { id?: string; owner?: { user?: { displayName?: string } }; name?: string };
    // The drive id is a stable provider-side account identifier (never client-supplied).
    return { ok: true, label: json.owner?.user?.displayName ?? json.name ?? null, accountId: json.id ?? null };
  } catch {
    return { ok: false, label: null, accountId: null };
  }
}

/**
 * Upload a DOCX to OneDrive root. conflict=fail: an existing file with the
 * same name is NEVER silently overwritten — the caller reports the 409 so
 * the user can decide (rename, delete, or explicitly replace via item_id).
 */
const OFFICE_MIME: Record<"docx" | "pptx", string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export async function uploadOfficeFile(
  accessToken: string,
  filename: string,
  bytes: Buffer,
  kind: "docx" | "pptx",
): Promise<{ saved: true; id: string; url: string }> {
  const safe = filename.replace(/[^a-zA-Z0-9 _.-]/g, "").trim().slice(0, 120) || "Sophira export";
  const res = await fetch(
    `${MICROSOFT_GRAPH}/me/drive/root:/${encodeURIComponent(safe)}.${kind}:/content?@microsoft.graph-conflictBehavior=fail`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": OFFICE_MIME[kind],
      },
      body: new Uint8Array(bytes),
      cache: "no-store",
    },
  );
  if (res.status === 409) {
    throw new Error("A file with this name already exists in your OneDrive. Rename the artifact or delete the old file first — Sophira never overwrites it silently.");
  }
  if (!res.ok) throw new Error(`OneDrive did not accept the document (HTTP ${res.status}). Nothing was claimed as saved.`);
  const json = (await res.json()) as { id: string; webUrl?: string };
  if (!json.id || !json.webUrl) throw new Error("OneDrive's response was missing the document link. Nothing was claimed as saved.");
  return { saved: true as const, id: json.id, url: json.webUrl };
}

/** EXPLICIT overwrite of a known document (only ever called with user confirmation). */
export async function overwriteDocx(
  accessToken: string,
  itemId: string,
  bytes: Buffer,
): Promise<{ saved: true; url: string | null }> {
  const res = await fetch(`${MICROSOFT_GRAPH}/me/drive/items/${encodeURIComponent(itemId)}/content`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    body: new Uint8Array(bytes),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OneDrive rejected the update (HTTP ${res.status}). Nothing was claimed as saved.`);
  const json = (await res.json()) as { webUrl?: string };
  return { saved: true as const, url: json.webUrl ?? null };
}

export async function uploadDocx(
  accessToken: string,
  filename: string,
  bytes: Buffer,
): Promise<{ saved: true; id: string; url: string }> {
  return uploadOfficeFile(accessToken, filename, bytes, "docx");
}

// ---------------------------------------------------------------------------
// DOCUMENT DISCOVERY + READ (2026-10-12) — read-only assistance.
// Files.ReadWrite covers reading files the signed-in user can access; some
// organizational tenants restrict sharedWithMe — every such failure is
// returned HONESTLY (never a silent empty list), and no broader scope
// (no tenant-wide Files scopes) is ever requested to work around it.
// ---------------------------------------------------------------------------

export interface DriveListing { ok: boolean; files: DiscoveredDocument[]; note: string | null; }

export async function listDriveFiles(accessToken: string): Promise<DriveListing> {
  const [own, shared] = await Promise.all([
    fetch(`${MICROSOFT_GRAPH}/me/drive/root/children?$top=200&$select=id,name,file,webUrl,remoteItem`, {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20000),
    }),
    fetch(`${MICROSOFT_GRAPH}/me/drive/sharedWithMe?$top=200&$select=id,name,file,webUrl,remoteItem`, {
      headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20000),
    }),
  ]);
  if (!own.ok) {
    const detail = own.status === 401 ? "the connection needs to be re-established" : own.status === 403 ? "your account or tenant restricts listing files" : `Microsoft returned HTTP ${own.status}`;
    return { ok: false, files: [], note: `Could not list your own files: ${detail}. Nothing is shown as accessible.` };
  }
  const ownJson = (await own.json()) as { value?: unknown[] };
  const files = summarizeMicrosoftItems(ownJson.value as unknown as Array<Record<string, unknown>>);
  let note: string | null = null;
  if (shared.ok) {
    const sharedJson = (await shared.json()) as { value?: unknown[] };
    files.push(...summarizeMicrosoftItems(sharedJson.value as unknown as Array<Record<string, unknown>>));
  } else {
    note = shared.status === 403
      ? "Explicitly shared files could not be listed (your account or tenant restricts that). Your own files are shown; a specific shared file can still be read if you open it from Sophira with its item id."
      : `Shared-file listing failed (HTTP ${shared.status}); your own files are shown.`;
  }
  return { ok: true, files, note };
}

export async function downloadDriveItem(accessToken: string, itemId: string, driveId?: string | null): Promise<{ ok: boolean; bytes: Buffer | null; mime: string | null; error: string | null }> {
  const base = driveId ? `${MICROSOFT_GRAPH}/drives/${encodeURIComponent(driveId)}` : `${MICROSOFT_GRAPH}/me/drive`;
  const res = await fetch(`${base}/items/${encodeURIComponent(itemId)}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const error = res.status === 403 ? "Microsoft says this account is not permitted to read that file"
      : res.status === 404 ? "that file no longer exists or the id is wrong"
      : res.status === 401 ? "the connection needs to be re-established"
      : `Microsoft returned HTTP ${res.status}`;
    return { ok: false, bytes: null, mime: null, error };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  return { ok: true, bytes, mime: res.headers.get("content-type"), error: null };
}
