/**
 * DOCUMENT HISTORY (2026-10-26) — cross-provider record of what Sophira
 * DID and what it could OBSERVE. Server-only persistence (service role,
 * always scoped to the authenticated user); pure helpers are unit tested.
 *
 * HONESTY RULES BAKED IN:
 *  - A history event describes evidence, never authorship. There is no
 *    "who typed this" verdict anywhere in this file.
 *  - Snapshots are capped + truncated with an explicit flag; a truncated
 *    snapshot is never presented as a complete recoverable version.
 *  - Provider metadata is labelled "provider-reported"; unavailable
 *    metadata stays null rather than being invented.
 *  - OAuth tokens are NEVER part of any event.
 */
import { createHash } from "crypto";

export type HistoryProvider = "google" | "microsoft";

export const HISTORY_EVENT_TYPES = [
  "document_discovered", "baseline_captured", "document_read", "draft_prepared",
  "insertion_attempted", "insertion_confirmed", "document_created",
  "replacement_attempted", "replacement_confirmed",
  "external_change_observed", "conflict_detected",
  "restore_attempted", "restore_completed", "restore_refused",
] as const;
export type HistoryEventType = (typeof HISTORY_EVENT_TYPES)[number];

export const HISTORY_ACTORS = ["user", "sophira", "external", "provider"] as const;
export type HistoryActor = (typeof HISTORY_ACTORS)[number];

export const HISTORY_PROVENANCE = [
  "sophira-generated", "sophira-inserted", "user-requested", "user-confirmed",
  "external-observed", "provider-reported", "unknown",
] as const;
export type HistoryProvenance = (typeof HISTORY_PROVENANCE)[number];

export const HISTORY_OUTCOMES = ["pending", "confirmed", "failed", "conflicted", "unavailable"] as const;
export type HistoryOutcome = (typeof HISTORY_OUTCOMES)[number];

export const HISTORY_DISCLAIMER =
  "Document history records changes Sophira performed and versions it was able to observe. Some changes may have happened outside Sophira. Version history and writing-analysis tools cannot reliably prove who physically typed or originally authored every passage.";

export const SNAPSHOT_MAX_CHARS = 60000;
const DIFF_MAX_LINES = 800;

export function fingerprintText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function fingerprintBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function truncateSnapshot(text: string): { text: string; truncated: boolean } {
  if (text.length <= SNAPSHOT_MAX_CHARS) return { text, truncated: false };
  return { text: text.slice(0, SNAPSHOT_MAX_CHARS), truncated: true };
}

export interface DiffSummary {
  added: string[];
  removed: string[];
  unchangedCount: number;
  truncated: boolean;
}

/** Line diff (LCS) with hard caps so long documents cannot freeze a request. */
export function computeDiff(previous: string, next: string): DiffSummary {
  const prevLines = previous.split("\n");
  const nextLines = next.split("\n");
  const truncated = prevLines.length > DIFF_MAX_LINES || nextLines.length > DIFF_MAX_LINES;
  const a = prevLines.slice(0, DIFF_MAX_LINES);
  const b = nextLines.slice(0, DIFF_MAX_LINES);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const added: string[] = [];
  const removed: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (dp[i + 1][j] >= dp[i][j + 1]) { removed.push(a[i]); i++; }
    else { added.push(b[j]); j++; }
  }
  while (i < n) { removed.push(a[i]); i++; }
  while (j < m) { added.push(b[j]); j++; }
  return { added, removed, unchangedCount: dp[0][0], truncated };
}

/**
 * Provenance is the MOST SPECIFIC category the evidence supports:
 * external observations and provider metadata are never upgraded into
 * authorship claims.
 */
export function classifyProvenance(
  eventType: HistoryEventType,
  actor: HistoryActor,
  confirmed: boolean,
): HistoryProvenance {
  if (eventType === "external_change_observed") return "external-observed";
  if (actor === "external") return "external-observed";
  if (actor === "provider") return "provider-reported";
  if (eventType === "draft_prepared") return "sophira-generated";
  if ((eventType === "insertion_confirmed" || eventType === "replacement_confirmed" || eventType === "document_created") && actor === "sophira") {
    return confirmed ? "sophira-inserted" : "unknown";
  }
  if (eventType === "insertion_confirmed" && actor === "user") return "user-confirmed";
  if (actor === "user") return confirmed ? "user-confirmed" : "user-requested";
  if (actor === "sophira") return "sophira-generated";
  return "unknown";
}

export function describeProvenance(p: HistoryProvenance): string {
  switch (p) {
    case "sophira-generated": return "Sophira produced this content.";
    case "sophira-inserted": return "Sophira inserted this into the document and the provider confirmed the write.";
    case "user-requested": return "You asked Sophira to perform this operation.";
    case "user-confirmed": return "You explicitly confirmed this operation.";
    case "external-observed": return "The document changed outside a confirmed Sophira write, or the origin could not be established.";
    case "provider-reported": return "The provider supplied this version metadata; it is not proof of who typed anything.";
    case "unknown": return "The available evidence is not sufficient to classify the origin.";
  }
}

/** Optimistic-concurrency decision for destructive writes. */
export type PreconditionVerdict = "ok" | "stale" | "unknown";
export function evaluatePrecondition(expectedEtag: string | null, currentEtag: string | null): PreconditionVerdict {
  if (!expectedEtag || !currentEtag) return "unknown";
  return expectedEtag === currentEtag ? "ok" : "stale";
}

export interface HistoryEventInput {
  userId: string;
  provider: HistoryProvider;
  documentId: string;
  selectionId?: string | null;
  documentTitle?: string | null;
  documentUrl?: string | null;
  eventType: HistoryEventType;
  actor: HistoryActor;
  provenance: HistoryProvenance;
  outcome: HistoryOutcome;
  providerRevision?: string | null;
  previousRevision?: string | null;
  contentFingerprint?: string | null;
  previousFingerprint?: string | null;
  snapshotText?: string | null;
  snapshotFormat?: string | null;
  targetSection?: string | null;
  summary: string;
  errorCategory?: string | null;
  diff?: DiffSummary | null;
  parentEventId?: string | null;
}

export function validateEventInput(input: HistoryEventInput): string | null {
  if (!input.userId) return "a user is required";
  if (input.provider !== "google" && input.provider !== "microsoft") return "unknown provider";
  if (!input.documentId || input.documentId.length > 300) return "a document id is required";
  if (!HISTORY_EVENT_TYPES.includes(input.eventType)) return "unknown event type";
  if (!HISTORY_ACTORS.includes(input.actor)) return "unknown actor";
  if (!HISTORY_PROVENANCE.includes(input.provenance)) return "unknown provenance";
  if (!HISTORY_OUTCOMES.includes(input.outcome)) return "unknown outcome";
  if (!input.summary || input.summary.length > 500) return "a short summary is required";
  if (input.errorCategory && input.errorCategory.length > 80) return "error category too long";
  if (input.snapshotText != null && input.snapshotText.length > SNAPSHOT_MAX_CHARS * 4) return "snapshot too large";
  return null;
}

export function nextSequence(existing: Array<{ sequence: number }>): number {
  let max = 0;
  for (const e of existing) if (e.sequence > max) max = e.sequence;
  return max + 1;
}

export interface HistoryEvent {
  id: string;
  provider: HistoryProvider;
  provider_document_id: string;
  document_title: string | null;
  document_url: string | null;
  event_type: HistoryEventType;
  actor: HistoryActor;
  provenance: HistoryProvenance;
  outcome: HistoryOutcome;
  sequence: number;
  provider_revision: string | null;
  previous_revision: string | null;
  content_fingerprint: string | null;
  previous_fingerprint: string | null;
  snapshot_truncated: boolean;
  snapshot_format: string | null;
  target_section: string | null;
  summary: string;
  error_category: string | null;
  diff_summary: DiffSummary | null;
  observed_at: string;
  recorded_at: string;
  parent_event_id: string | null;
  has_snapshot: boolean;
}

const COLUMNS =
  "id, provider, provider_document_id, document_title, document_url, event_type, actor, provenance, outcome, sequence, provider_revision, previous_revision, content_fingerprint, previous_fingerprint, snapshot_truncated, snapshot_format, target_section, summary, error_category, diff_summary, observed_at, recorded_at, parent_event_id, snapshot_text";

export async function recordHistoryEvent(input: HistoryEventInput): Promise<{ ok: boolean; id: string | null; sequence: number | null; error: string | null }> {
  const invalid = validateEventInput(input);
  if (invalid) return { ok: false, id: null, sequence: null, error: invalid };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const snap = input.snapshotText != null ? truncateSnapshot(input.snapshotText) : null;
  const fingerprint = input.contentFingerprint ?? (snap ? fingerprintText(snap.text) : null);
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: last } = await admin
      .from("document_history")
      .select("sequence")
      .eq("user_id", input.userId)
      .eq("provider", input.provider)
      .eq("provider_document_id", input.documentId)
      .order("sequence", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sequence = ((last?.sequence as number | undefined) ?? 0) + 1;
    const { data, error } = await admin
      .from("document_history")
      .insert({
        user_id: input.userId,
        provider: input.provider,
        provider_document_id: input.documentId,
        selection_id: input.selectionId ?? null,
        document_title: input.documentTitle ?? null,
        document_url: input.documentUrl ?? null,
        event_type: input.eventType,
        actor: input.actor,
        provenance: input.provenance,
        outcome: input.outcome,
        sequence,
        provider_revision: input.providerRevision ?? null,
        previous_revision: input.previousRevision ?? null,
        content_fingerprint: fingerprint,
        previous_fingerprint: input.previousFingerprint ?? null,
        snapshot_text: snap?.text ?? null,
        snapshot_truncated: snap?.truncated ?? false,
        snapshot_format: input.snapshotFormat ?? (snap ? "text" : null),
        target_section: input.targetSection ?? null,
        summary: input.summary,
        error_category: input.errorCategory ?? null,
        diff_summary: input.diff ?? null,
        parent_event_id: input.parentEventId ?? null,
      })
      .select("id, sequence")
      .single();
    if (!error) return { ok: true, id: (data as { id: string }).id, sequence: (data as { sequence: number }).sequence, error: null };
    if ((error as { code?: string }).code !== "23505") return { ok: false, id: null, sequence: null, error: "The history record could not be saved." };
    // unique(user, provider, doc, sequence) collision: retry with a fresh sequence.
  }
  return { ok: false, id: null, sequence: null, error: "The history record could not be saved after retries." };
}

export async function listHistoryEvents(
  userId: string,
  provider: HistoryProvider,
  documentId: string,
  limit = 50,
): Promise<{ ok: boolean; events: HistoryEvent[]; error: string | null }> {
  if (!userId || !documentId) return { ok: false, events: [], error: "A document is required." };
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("document_history")
    .select(COLUMNS)
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("provider_document_id", documentId)
    .order("sequence", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 100));
  if (error) return { ok: false, events: [], error: "Your history could not be loaded." };
  const events = (data ?? []).map((row) => {
    const r = row as Record<string, unknown> & { snapshot_text?: string | null };
    const { snapshot_text, ...rest } = r;
    return { ...(rest as unknown as HistoryEvent), has_snapshot: typeof snapshot_text === "string" && snapshot_text.length > 0 };
  });
  return { ok: true, events, error: null };
}

export async function latestSnapshotEvent(
  userId: string,
  provider: HistoryProvider,
  documentId: string,
): Promise<{ snapshot: string | null; fingerprint: string | null; eventId: string | null; recordedAt: string | null }> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data } = await admin
    .from("document_history")
    .select("id, snapshot_text, content_fingerprint, recorded_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("provider_document_id", documentId)
    .not("snapshot_text", "is", null)
    .order("sequence", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = data as { id?: string; snapshot_text?: string | null; content_fingerprint?: string | null; recorded_at?: string | null } | null;
  return {
    snapshot: row?.snapshot_text ?? null,
    fingerprint: row?.content_fingerprint ?? null,
    eventId: row?.id ?? null,
    recordedAt: row?.recorded_at ?? null,
  };
}

export async function getOwnedSnapshot(userId: string, eventId: string): Promise<{ ok: boolean; snapshot: string | null; provider: HistoryProvider | null; documentId: string | null; truncated: boolean }> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data } = await admin
    .from("document_history")
    .select("snapshot_text, snapshot_truncated, provider, provider_document_id")
    .eq("id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  const row = data as { snapshot_text?: string | null; snapshot_truncated?: boolean; provider?: HistoryProvider; provider_document_id?: string } | null;
  if (!row || !row.snapshot_text) return { ok: false, snapshot: null, provider: null, documentId: null, truncated: false };
  return { ok: true, snapshot: row.snapshot_text, provider: row.provider ?? null, documentId: row.provider_document_id ?? null, truncated: Boolean(row.snapshot_truncated) };
}

/** The most recent snapshot-bearing events (used for comparisons). */
export async function recentSnapshots(
  userId: string,
  provider: HistoryProvider,
  documentId: string,
  limit = 2,
): Promise<Array<{ id: string; sequence: number; snapshot: string; fingerprint: string | null; recorded_at: string }>> {
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  const { data } = await admin
    .from("document_history")
    .select("id, sequence, snapshot_text, content_fingerprint, recorded_at")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("provider_document_id", documentId)
    .not("snapshot_text", "is", null)
    .order("sequence", { ascending: false })
    .limit(Math.min(Math.max(1, limit), 10));
  return ((data ?? []) as Array<{ id: string; sequence: number; snapshot_text: string; content_fingerprint: string | null; recorded_at: string }>).map((r) => ({
    id: r.id, sequence: r.sequence, snapshot: r.snapshot_text, fingerprint: r.content_fingerprint, recorded_at: r.recorded_at,
  }));
}
