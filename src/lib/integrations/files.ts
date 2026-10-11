/**
 * DOCUMENT DISCOVERY + SELECTION helpers (2026-10-12).
 * Discovery and access are DIFFERENT capabilities: a file that cannot be
 * listed may still be readable when explicitly selected, and a listed
 * file may not be writable. Every state here is honest — a listed file is
 * only "listed", never "connected" or "synchronized".
 */

export interface DiscoveredDocument {
  id: string;
  title: string;
  url: string | null;
  mime: string;
  shared: boolean;
  owner: string | null;
  /** "listed" only ever means the provider returned it in a listing. */
  access: "listed";
}

export interface Eligibility {
  /** readable as plain text through a supported provider operation */
  readable_text: boolean;
  reason: string;
}

const MS_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const GG_DOC = "application/vnd.google-apps.document";
const GG_SLIDES = "application/vnd.google-apps.presentation";
const GG_SHEET = "application/vnd.google-apps.spreadsheet";

/** Which discovered documents can be read as text for AI assistance. */
export function eligibilityFor(mime: string): Eligibility {
  if (mime === MS_DOCX || mime === GG_DOC) return { readable_text: true, reason: "document text can be extracted" };
  if (mime === "text/plain" || mime === "text/markdown" || mime === "text/csv") return { readable_text: true, reason: "plain text file" };
  if (mime === GG_SLIDES) return { readable_text: false, reason: "presentations cannot be read as text yet — download the .pptx export instead" };
  if (mime === GG_SHEET) return { readable_text: false, reason: "spreadsheets are not readable yet" };
  return { readable_text: false, reason: "unsupported document type for text extraction" };
}

/** Normalize a Microsoft Graph driveItem (own or sharedWithMe) listing. */
export function summarizeMicrosoftItems(
  items: Array<Record<string, unknown>> | null | undefined,
): DiscoveredDocument[] {
  if (!Array.isArray(items)) return [];
  const out: DiscoveredDocument[] = [];
  for (const it of items) {
    const file = it.file as { mimeType?: string } | undefined;
    if (!file?.mimeType) continue; // folders and non-file entries are not documents
    out.push({
      id: String(it.id ?? ""),
      title: String(it.name ?? "Untitled"),
      url: (it.webUrl as string | undefined) ?? null,
      mime: file.mimeType,
      shared: Boolean(it.remoteItem),
      owner: ((it.remoteItem as { owner?: { user?: { displayName?: string } } } | undefined)?.owner?.user?.displayName) ?? null,
      access: "listed",
    });
  }
  return out;
}

/** Normalize a Google Drive files.list response. */
export function summarizeGoogleFiles(
  files: Array<Record<string, unknown>> | null | undefined,
): DiscoveredDocument[] {
  if (!Array.isArray(files)) return [];
  return files
    .filter((f) => typeof f.id === "string")
    .map((f) => ({
      id: String(f.id),
      title: String(f.name ?? "Untitled"),
      url: (f.webViewLink as string | undefined) ?? null,
      mime: String(f.mimeType ?? ""),
      shared: Boolean(f.shared),
      owner: ((f.owners as Array<{ displayName?: string }> | undefined)?.[0]?.displayName) ?? null,
      access: "listed" as const,
    }));
}

/** Validate a workload-scope payload server-side. Client input is never trusted. */
export function validateSelectionInput(input: {
  provider?: unknown;
  provider_document_id?: unknown;
  document_title?: unknown;
  document_url?: unknown;
  access_state?: unknown;
  scope_description?: unknown;
  content_fingerprint?: unknown;
}): { ok: true; value: {
  provider: "microsoft" | "google";
  provider_document_id: string;
  document_title: string | null;
  document_url: string | null;
  access_state: "unverified" | "read" | "write";
  scope_description: string | null;
  content_fingerprint: string | null;
} } | { ok: false; error: string } {
  if (input.provider !== "microsoft" && input.provider !== "google") return { ok: false, error: "provider must be microsoft or google" };
  if (typeof input.provider_document_id !== "string" || input.provider_document_id.trim() === "" || input.provider_document_id.length > 500)
    return { ok: false, error: "provider_document_id is required (max 500 chars)" };
  const access = input.access_state;
  const access_state = access === "read" || access === "write" ? access : "unverified";
  const str = (v: unknown, max: number): string | null =>
    typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
  const scope = str(input.scope_description, 2000);
  return {
    ok: true,
    value: {
      provider: input.provider,
      provider_document_id: input.provider_document_id.trim(),
      document_title: str(input.document_title, 300),
      document_url: str(input.document_url, 2000),
      access_state,
      scope_description: scope,
      content_fingerprint: str(input.content_fingerprint, 100),
    },
  };
}
