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

// ---------------------------------------------------------------------------
// SAFE REPLACEMENT + RECOVERY (2026-10-26)
// A stale listing is NEVER proof a file is unchanged. Every replacement:
//   1. the caller supplies the eTag it actually saw (expected_etag);
//   2. we re-read the CURRENT item metadata;
//   3. a mismatch refuses the write BEFORE anything is sent;
//   4. the PUT itself is conditional (If-Match), so a change between our
//      check and the write also fails (412) instead of overwriting.
// OneDrive's own version history is the recoverable copy for Word files;
// Sophira never claims a binary snapshot it did not store.
// ---------------------------------------------------------------------------

export interface ItemMetadata {
  ok: boolean;
  eTag: string | null;
  id: string | null;
  name: string | null;
  webUrl: string | null;
  lastModifiedDateTime: string | null;
  size: number | null;
  error: string | null;
}

export async function getItemMetadata(accessToken: string, itemId: string): Promise<ItemMetadata> {
  const res = await fetch(
    `${MICROSOFT_GRAPH}/me/drive/items/${encodeURIComponent(itemId)}?$select=id,name,eTag,webUrl,lastModifiedDateTime,size`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20000) },
  );
  if (!res.ok) {
    const error = res.status === 404 ? "that file no longer exists or the id is wrong"
      : res.status === 403 ? "Microsoft says this account is not permitted to read that file"
      : res.status === 401 ? "the connection needs to be re-established"
      : `Microsoft returned HTTP ${res.status}`;
    return { ok: false, eTag: null, id: null, name: null, webUrl: null, lastModifiedDateTime: null, size: null, error };
  }
  const json = (await res.json()) as { id?: string; name?: string; eTag?: string; webUrl?: string; lastModifiedDateTime?: string; size?: number };
  return { ok: true, eTag: json.eTag ?? null, id: json.id ?? null, name: json.name ?? null, webUrl: json.webUrl ?? null, lastModifiedDateTime: json.lastModifiedDateTime ?? null, size: typeof json.size === "number" ? json.size : null, error: null };
}

export interface GuardedReplaceResult {
  saved: boolean;
  conflict: boolean;
  url: string | null;
  eTag: string | null;
  error: string | null;
}

/** Conditional replacement: the write is refused by the provider (412) if the file changed. */
export async function overwriteDocxGuarded(
  accessToken: string,
  itemId: string,
  bytes: Buffer,
  expectedEtag: string,
): Promise<GuardedReplaceResult> {
  const res = await fetch(`${MICROSOFT_GRAPH}/me/drive/items/${encodeURIComponent(itemId)}/content`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "If-Match": expectedEtag,
    },
    body: new Uint8Array(bytes),
    cache: "no-store",
  });
  if (res.status === 412) {
    return { saved: false, conflict: true, url: null, eTag: null, error: "This file changed in OneDrive while Sophira was preparing the update. Nothing was overwritten. Your draft is safe — review the latest version and try again." };
  }
  if (!res.ok) {
    return { saved: false, conflict: false, url: null, eTag: null, error: `OneDrive rejected the update (HTTP ${res.status}). Nothing was overwritten.` };
  }
  const json = (await res.json()) as { webUrl?: string; eTag?: string };
  return { saved: true, conflict: false, url: json.webUrl ?? null, eTag: json.eTag ?? null, error: null };
}

export interface ItemVersion { id: string; lastModifiedDateTime: string | null }

/** Provider version history (the honest recoverable copy for Word files). */
export async function listItemVersions(
  accessToken: string,
  itemId: string,
): Promise<{ ok: boolean; versions: ItemVersion[]; error: string | null }> {
  const res = await fetch(
    `${MICROSOFT_GRAPH}/me/drive/items/${encodeURIComponent(itemId)}/versions?$select=id,lastModifiedDateTime`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20000) },
  );
  if (!res.ok) {
    const error = res.status === 404 ? "This file has no version history available (the account or drive type may not keep versions)."
      : res.status === 403 ? "Microsoft says this account is not permitted to list versions of that file."
      : `Microsoft returned HTTP ${res.status} while listing versions.`;
    return { ok: false, versions: [], error };
  }
  const json = (await res.json()) as { value?: Array<{ id?: string; lastModifiedDateTime?: string }> };
  const versions = (json.value ?? [])
    .filter((v): v is { id: string; lastModifiedDateTime?: string } => typeof v.id === "string")
    .map((v) => ({ id: v.id, lastModifiedDateTime: v.lastModifiedDateTime ?? null }));
  return { ok: true, versions, error: null };
}

/** Restore a provider version, guarded by the eTag the user reviewed. */
export async function restoreItemVersion(
  accessToken: string,
  itemId: string,
  versionId: string,
  expectedEtag: string,
): Promise<{ ok: boolean; conflict: boolean; error: string | null }> {
  const res = await fetch(
    `${MICROSOFT_GRAPH}/me/drive/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(versionId)}/restore`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "If-Match": expectedEtag },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (res.status === 412) {
    return { ok: false, conflict: true, error: "This file changed since you reviewed it. Nothing was restored — review the latest version and try again." };
  }
  if (!res.ok) {
    return { ok: false, conflict: false, error: `Microsoft could not restore that version (HTTP ${res.status}). The current file was left untouched.` };
  }
  return { ok: true, conflict: false, error: null };
}
