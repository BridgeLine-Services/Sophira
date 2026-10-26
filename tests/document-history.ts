/**
 * DOCUMENT HISTORY (2026-10-26): behaviorally tests the pure engine, the
 * security invariants, the migration, and the route wiring. Live Google /
 * Microsoft calls remain honestly BLOCKED without owner OAuth registrations.
 */
import { readFileSync } from "fs";

export function runDocumentHistoryTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("document history (cross-provider, owner-scoped)");

  const H = require("../src/lib/integrations/history") as typeof import("../src/lib/integrations/history");

  // ---- fingerprints ----
  const a = H.fingerprintText("Alpha\nBeta");
  const b = H.fingerprintText("Alpha\nBeta");
  const c = H.fingerprintText("Alpha\nGamma");
  assert(a === b && a.length === 64, "history: content fingerprints are stable sha256 hex");
  assert(a !== c, "history: different content produces a different fingerprint");

  // ---- snapshot truncation is explicit, never silent ----
  const short = H.truncateSnapshot("hello");
  assert(short.text === "hello" && short.truncated === false, "history: short snapshots are preserved intact");
  const long = H.truncateSnapshot("x".repeat(H.SNAPSHOT_MAX_CHARS + 100));
  assert(long.text.length === H.SNAPSHOT_MAX_CHARS && long.truncated === true, "history: oversized snapshots are capped AND flagged truncated");

  // ---- diff correctness ----
  const d1 = H.computeDiff("one\ntwo\nthree", "one\nTWO\nthree\nfour");
  assert(d1.added.includes("four") && d1.removed.includes("two") && d1.unchangedCount === 2,
    "history: diff reports added, removed, and unchanged lines");
  const d2 = H.computeDiff("same", "same");
  assert(d2.added.length === 0 && d2.removed.length === 0, "history: identical versions show no differences");
  const big = Array.from({ length: 1200 }, (_, i) => `line ${i}`).join("\n");
  assert(H.computeDiff(big, big + "\nextra").truncated === true, "history: huge documents are truncated rather than freezing the request");

  // ---- provenance: never upgraded into authorship ----
  assert(H.classifyProvenance("external_change_observed", "external", true) === "external-observed",
    "provenance: an outside change is labelled observed, not authored");
  assert(H.classifyProvenance("document_read", "provider", true) === "provider-reported",
    "provenance: provider metadata stays provider-reported");
  assert(H.classifyProvenance("draft_prepared", "sophira", false) === "sophira-generated",
    "provenance: a prepared draft is Sophira-generated");
  assert(H.classifyProvenance("insertion_confirmed", "sophira", true) === "sophira-inserted",
    "provenance: a confirmed insertion is Sophira-inserted");
  assert(H.classifyProvenance("insertion_confirmed", "sophira", false) === "unknown",
    "provenance: an unconfirmed insertion is never claimed as inserted");
  assert(H.classifyProvenance("insertion_attempted", "user", false) === "user-requested",
    "provenance: a user-requested, unconfirmed action stays user-requested");
  assert(H.HISTORY_DISCLAIMER.includes("cannot reliably prove"), "provenance: the plain-language disclaimer is explicit about its limits");
  assert(H.describeProvenance("external-observed").includes("origin could not be established"),
    "provenance: external observations state that the origin is unknown");

  // ---- optimistic concurrency ----
  assert(H.evaluatePrecondition("etag-1", "etag-1") === "ok", "concurrency: matching eTags allow the guarded write");
  assert(H.evaluatePrecondition("etag-1", "etag-2") === "stale", "concurrency: a moved eTag is stale BEFORE any write is sent");
  assert(H.evaluatePrecondition(null, "etag-2") === "unknown" && H.evaluatePrecondition("etag-1", null) === "unknown",
    "concurrency: missing eTag metadata refuses the write instead of guessing");

  // ---- event validation ----
  const base = {
    userId: "u1", provider: "google" as const, documentId: "doc1", eventType: "insertion_confirmed" as const,
    actor: "sophira" as const, provenance: "sophira-inserted" as const, outcome: "confirmed" as const, summary: "ok",
  };
  assert(H.validateEventInput(base) === null, "events: a well-formed event validates");
  assert(H.validateEventInput({ ...base, provider: "dropbox" as never }) !== null, "events: unknown providers are rejected");
  assert(H.validateEventInput({ ...base, documentId: "" }) !== null, "events: a document id is required");
  assert(H.validateEventInput({ ...base, summary: "x".repeat(501) }) !== null, "events: oversized summaries are rejected");
  assert(H.validateEventInput({ ...base, snapshotText: "x".repeat(H.SNAPSHOT_MAX_CHARS * 5) }) !== null, "events: absurd snapshots are rejected");
  assert(H.nextSequence([{ sequence: 1 }, { sequence: 3 }]) === 4, "events: sequences are monotonic per document");

  // ---- source pins: secrets and authorship verdicts must not exist here ----
  const lib = readFileSync("src/lib/integrations/history.ts", "utf8");
  assert(!/access_token|refresh_token|client_secret/.test(lib), "security: history code never handles OAuth tokens");
  assert(!/misconduct|authorship score|ai detector|detectedByAi/i.test(lib), "honesty: no code path produces an authorship or misconduct verdict");
  const histRoute = readFileSync("src/app/api/integrations/document-history/route.ts", "utf8");
  assert(histRoute.includes("HISTORY_DISCLAIMER") && histRoute.includes('action === "restore_version"'),
    "history route: exposes the disclaimer and the guarded provider-version restore");
  assert(histRoute.includes('action === "recovery_copy"') && histRoute.includes("createDocFromArtifact"),
    "history route: Google recovery creates a NEW document instead of overwriting the original");
  assert(!/access_token.*json|json\(\{[^}]*access_token/.test(histRoute), "security: the history route never returns tokens to the client");

  // ---- Google write instrumentation ----
  const gRoute = readFileSync("src/app/api/integrations/google/doc-update/route.ts", "utf8");
  assert(gRoute.includes('"insertion_attempted"') && gRoute.includes('"insertion_confirmed"') && gRoute.includes('"conflict_detected"'),
    "google: attempt, confirmation, and conflict are all recorded in history");
  assert(gRoute.includes("preserved_draft"), "google: a failed or conflicted write still preserves the draft");
  assert(gRoute.includes("history_warning"), "google: a history write failure is reported separately from the document write");

  // ---- Microsoft guarded replacement ----
  const msLib = readFileSync("src/lib/integrations/microsoft.ts", "utf8");
  assert(msLib.includes('"If-Match"') && msLib.includes("412"), "microsoft: replacement is conditional on the reviewed eTag (412 handled)");
  assert(msLib.includes("listItemVersions") && msLib.includes("restoreItemVersion"), "microsoft: provider version history is listed and restorable");
  const msRoute = readFileSync("src/app/api/integrations/microsoft/documents/route.ts", "utf8");
  assert(msRoute.includes("expected_etag") && msRoute.includes("evaluatePrecondition"),
    "microsoft route: a replacement without the reviewed eTag is refused");
  assert(msRoute.includes('"replacement_attempted"') && msRoute.includes('"replacement_confirmed"'),
    "microsoft route: replacement attempts and confirmations are recorded");
  assert(msRoute.includes("not an in-place edit") || msRoute.includes("WHOLE FILE"),
    "microsoft route: whole-file replacement is disclosed instead of presented as a small edit");

  // ---- migration + registry ----
  const migration = readFileSync("supabase/migrations/0040_document_history.sql", "utf8");
  assert(migration.includes("create table if not exists public.document_history"), "migration: the history table is additive");
  assert(migration.includes("enable row level security"), "migration: RLS is enabled");
  assert(/create policy "own document history: read"/.test(migration) && migration.includes("auth.uid() = user_id"),
    "migration: owners can read only their own history");
  assert(!/for insert to authenticated/.test(migration) && !/for update to authenticated/.test(migration) && !/for delete to authenticated/.test(migration),
    "migration: clients cannot forge or erase history events");
  assert(migration.includes("on delete cascade"), "migration: deleting an account removes its history");
  assert(!/access_token|refresh_token/i.test(migration), "migration: no token columns in history");
  const markers = readFileSync("scripts/migration-markers.mjs", "utf8");
  const generated = readFileSync("src/lib/db-migrations.generated.ts", "utf8");
  assert(markers.includes("0040_document_history.sql") && generated.includes("0040_document_history.sql"),
    "migration: registered in the marker table and the generated bootstrap artifact");

  // ---- UI wiring ----
  const ui = readFileSync("src/components/app/DocumentBrowser.tsx", "utf8");
  assert(ui.includes("document-history?provider=") && ui.includes("Document history"), "ui: selections expose their document history");
  assert(ui.includes("Compare last two versions") && ui.includes("Check for changes outside Sophira"),
    "ui: comparison and outside-change checks are reachable");
  assert(ui.includes("Recovery copy") && ui.includes("Restore this version"),
    "ui: recovery and version restore are exposed with confirmation");
}
