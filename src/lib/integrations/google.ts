/**
 * GOOGLE DOCS / DRIVE HELPERS (server-only, 2026-10-11).
 * Token exchange, refresh, real connectivity verification, document
 * creation via the Docs API, and the pure request builder used by tests.
 * Scope is drive.file ONLY: documents created through Sophira — never the
 * whole Drive. Errors are honest; tokens are never logged.
 */
import { GOOGLE_TOKEN_URL, GOOGLE_DOCS_API, GOOGLE_DRIVE_API } from "./oauth-state";
import { summarizeGoogleFiles, type DiscoveredDocument } from "./files";
import type { ExportArtifact } from "@/lib/documents/export";

export interface ProviderTokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  granted_scopes: string | null;
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
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  if (!json.access_token) throw new Error("Google's response was missing an access token. Nothing was saved.");
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? null,
    expires_at: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
    granted_scopes: json.scope ?? null,
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
  const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? refreshToken,
    expires_at: new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString(),
    granted_scopes: json.scope ?? null,
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

/**
 * Create a real GOOGLE SLIDES presentation from a .pptx, via the Drive API
 * multipart upload with conversion (drive.file scope covers files the app
 * creates). Returns the presentation's real URL once Google confirms it.
 *
 * HONEST LIMITATION: with the least-privilege drive.file scope, Google does
 * not expose the connected account's email/display name — Sophira does NOT
 * request broader Drive scopes just to show a label.
 */
export async function uploadPptxAsSlides(
  accessToken: string,
  name: string,
  bytes: Buffer,
): Promise<{ saved: true; url: string }> {
  const boundary = "sophira-slides-upload";
  const metadata = JSON.stringify({ name: name.slice(0, 120), mimeType: "application/vnd.google-apps.presentation" });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
      cache: "no-store",
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!res.ok) throw new Error(`Google Drive did not accept the presentation (HTTP ${res.status}). Nothing was claimed as saved.`);
  const { id } = (await res.json()) as { id?: string };
  if (!id) throw new Error("Google Drive's response was missing the presentation id. Nothing was claimed as saved.");
  return { saved: true as const, url: `https://docs.google.com/presentation/d/${id}/edit` };
}

// ---------------------------------------------------------------------------
// DOCUMENT DISCOVERY + READ (2026-10-12) — honest about what drive.file
// permits. drive.file sees ONLY files this app created; it does NOT make
// every file shared with the user discoverable. Browsing all accessible
// files requires the OPTIONAL drive.readonly consent, requested ONLY via
// incremental consent when the user explicitly enables Drive browsing.
// ---------------------------------------------------------------------------

export interface GoogleListing { ok: boolean; files: DiscoveredDocument[]; note: string | null; browse_consent: boolean; }

export async function listAppCreatedFiles(accessToken: string): Promise<GoogleListing> {
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files?pageSize=200&fields=files(id,name,mimeType,webViewLink,owners,shared)&q=trashed=false",
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20000) },
  );
  if (!res.ok) {
    const error = res.status === 401 ? "the connection needs to be re-established" : `Google returned HTTP ${res.status}`;
    return { ok: false, files: [], note: `Could not list files: ${error}. Nothing is shown as accessible.`, browse_consent: false };
  }
  const json = (await res.json()) as { files?: unknown[] };
  return {
    ok: true,
    files: summarizeGoogleFiles(json.files as unknown as Array<Record<string, unknown>>),
    note: "With the least-privilege drive.file scope, Google shows only files created through Sophira. To browse everything your account can access (including documents shared with you), enable Drive browsing — it requests the additional read-only consent.",
    browse_consent: false,
  };
}

export async function listAllAccessibleFiles(accessToken: string): Promise<GoogleListing> {
  const res = await fetch(
    "https://www.googleapis.com/drive/v3/files?pageSize=200&fields=files(id,name,mimeType,webViewLink,owners,shared)&q=trashed=false&supportsAllDrives=true&includeItemsFromAllDrives=true",
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(20000) },
  );
  if (!res.ok) {
    if (res.status === 403) {
      return { ok: false, files: [], note: "Google says the Drive browsing consent has not been granted (drive.readonly). Use the Enable-Drive-browsing consent, then browse again.", browse_consent: true };
    }
    return { ok: false, files: [], note: `Google returned HTTP ${res.status}. Nothing is shown as accessible.`, browse_consent: false };
  }
  const json = (await res.json()) as { files?: unknown[] };
  return { ok: true, files: summarizeGoogleFiles(json.files as unknown as Array<Record<string, unknown>>), note: null, browse_consent: true };
}

/** Read a Google Doc (or plain-text file) as text for read-only assistance. */
export async function readGoogleFileText(accessToken: string, fileId: string, mime: string): Promise<{ ok: boolean; text: string | null; error: string | null }> {
  if (mime === "application/vnd.google-apps.document") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/markdown`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(30000) },
    );
    if (!res.ok) return { ok: false, text: null, error: res.status === 403 ? "Google says this account is not permitted to read that document" : res.status === 404 ? "that document no longer exists or the id is wrong" : `Google returned HTTP ${res.status}` };
    return { ok: true, text: await res.text(), error: null };
  }
  if (mime === "text/plain" || mime === "text/markdown" || mime === "text/csv") {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(30000) },
    );
    if (!res.ok) return { ok: false, text: null, error: res.status === 403 ? "Google says this account is not permitted to read that file" : `Google returned HTTP ${res.status}` };
    return { ok: true, text: await res.text(), error: null };
  }
  return { ok: false, text: null, error: "this file type cannot be read as text yet — a downloadable draft is offered instead" };
}

// ---------------------------------------------------------------------------
// REVISION-GUARDED, SECTION-SCOPED WRITE-BACK (2026-10-12, Objective 5).
// Google's Docs API batchUpdate supports writeControl.requiredRevisionId:
// if ANYONE changed the document since the revision Sophira read, Google
// refuses the write (409) instead of silently overwriting a collaborator's
// edit. Sophira ALWAYS sends the requiredRevisionId — there is no blind
// write path — and a conflict preserves the draft so no work is lost.
// Microsoft Word remains draft-download-only until a bounded, eTag-guarded
// Word write-back exists; that limit is documented, never hidden.
// ---------------------------------------------------------------------------

export interface DocBlock { text: string; endIndex: number }
export interface DocSnapshot { ok: boolean; revisionId: string | null; blocks: DocBlock[]; endIndex: number | null; error: string | null; }
export interface DocWriteResult { ok: boolean; conflict: boolean; revisionId: string | null; error: string | null; }

/** Fetch the CURRENT revision + paragraph texts of an existing Google Doc. */
export async function getGoogleDocSnapshot(accessToken: string, docId: string): Promise<DocSnapshot> {
  const res = await fetch(`${GOOGLE_DOCS_API}/documents/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    return { ok: false, revisionId: null, blocks: [], endIndex: null,
      error: res.status === 403 ? "Google says this account is not permitted to read that document"
        : res.status === 404 ? "that document no longer exists or the id is wrong" : `Google returned HTTP ${res.status}` };
  }
  const doc = (await res.json()) as {
    revisionId?: string;
    body?: { content?: Array<{ paragraph?: { elements?: Array<{ textRun?: { content?: string } }> }; endIndex?: number }> };
  };
  const blocks: DocBlock[] = [];
  for (const el of doc.body?.content ?? []) {
    const text = (el.paragraph?.elements ?? []).map((e) => e.textRun?.content ?? "").join("");
    if (text.trim() !== "" && typeof el.endIndex === "number") blocks.push({ text, endIndex: el.endIndex as number });
  }
  const last = doc.body?.content ?? [];
  let endIndex: number | null = null;
  for (let i = last.length - 1; i >= 0; i--) { if (typeof last[i]?.endIndex === "number") { endIndex = last[i].endIndex as number; break; } }
  return { ok: true, revisionId: doc.revisionId ?? null, blocks, endIndex, error: null };
}

/**
 * PURE: locate the insertion point for a user's assigned section. The
 * heading must be found VERBATIM in a paragraph — the write stays inside
 * the user's stated section, never the whole document. Returns null when
 * the heading is absent so NO write happens at a guessed location.
 */
export function locateSectionInsertion(blocks: DocBlock[], heading: string): number | null {
  const target = heading.trim().toLowerCase();
  if (target === "") return null;
  const hit = blocks.find((b) => b.text.trim().toLowerCase() === target);
  // Insert directly under the heading block (existing content is shifted,
  // never deleted) — the write stays inside the user's stated section.
  return hit ? hit.endIndex : null;
}

/**
 * PURE: build the revision-guarded insert request. requiredRevisionId is
 * ALWAYS present — Google then refuses the write (409) if the document
 * changed since the snapshot, instead of overwriting a collaborator.
 */
export function buildGuardedInsertRequest(text: string, insertIndex: number, requiredRevisionId: string): {
  requests: { insertText: { location: { index: number }; text: string } }[];
  writeControl: { requiredRevisionId: string };
} {
  return {
    requests: [{ insertText: { location: { index: Math.max(1, Math.floor(insertIndex)) }, text: `${text.replace(/\r\n/g, "\n")}\n` } }],
    writeControl: { requiredRevisionId },
  };
}

/** Apply the guarded write; map 409 to an honest conflict result. */
export async function applyGoogleDocUpdate(accessToken: string, docId: string, payload: { requests: { insertText: { location: { index: number }; text: string } }[]; writeControl: { requiredRevisionId: string } }): Promise<DocWriteResult> {
  const res = await fetch(`${GOOGLE_DOCS_API}/documents/${encodeURIComponent(docId)}:batchUpdate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 409) {
    return { ok: false, conflict: true, revisionId: null,
      error: "The document changed while Sophira was preparing the update. Nothing was written. Your draft is preserved below — review the newer version and try again." };
  }
  if (!res.ok) {
    return { ok: false, conflict: false, revisionId: null,
      error: res.status === 403 ? "Google says this account is not permitted to write that document. A downloadable draft is available instead."
        : res.status === 400 ? "Google rejected the update (the document may have been restructured). Nothing was written."
        : `Google returned HTTP ${res.status}. Nothing was written.` };
  }
  const json = (await res.json()) as { document?: { revisionId?: string } };
  return { ok: true, conflict: false, revisionId: json.document?.revisionId ?? null, error: null };
}
