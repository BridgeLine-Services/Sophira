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


  // =====================================================================
  // STAGE 4 (2026-11-02): gradual insertion, recovery copies, plain language.
  // =====================================================================
  section("stage 4: gradual insertion (pause / resume / stop, no simulation)");

  const G = require("../src/lib/integrations/gradual-insert") as typeof import("../src/lib/integrations/gradual-insert");

  // ---- chunk planning: never a half-written word between writes ----
  const longPara = "Sentence one is here. ".repeat(30);
  const chunks = G.planInsertionChunks(longPara, 200);
  assert(chunks.length > 1, "gradual: a long text splits into several parts");
  assert(chunks.join("") === longPara, "gradual: the parts reassemble into exactly the original text");
  assert(chunks.every((c) => c.length <= 200), "gradual: no part exceeds the requested size");
  assert(chunks.every((c) => !/^\w/.test(c) || c === chunks[0]), "gradual: later parts do not begin mid-word");
  assert(G.planInsertionChunks("").length === 0, "gradual: empty text produces no chunks at all");
  assert(G.planInsertionChunks("   \n  ").length === 0, "gradual: whitespace-only text produces no chunks");
  assert(G.planInsertionChunks("short").length === 1, "gradual: short text stays one part");

  // ---- state machine ----
  let st = G.initialGradualState("abcdefghij", 4);
  assert(st.status === "pending" && st.insertedChars === 0, "gradual: starts pending with nothing written");
  const started = G.transitionGradual(st, "start");
  assert(started.ok && started.state.status === "inserting", "gradual: start moves to inserting");
  const progressed = G.transitionGradual(started.state, "progress", 4);
  assert(progressed.ok && progressed.state.insertedChars === 4, "gradual: progress counts only confirmed characters");
  const paused = G.transitionGradual(progressed.state, "pause");
  assert(paused.ok && paused.state.status === "paused" && G.canResume(paused.state.status), "gradual: pause is resumable");
  const resumed = G.transitionGradual(paused.state, "resume");
  assert(resumed.ok && resumed.state.status === "inserting", "gradual: resume returns to inserting");
  const completed = G.transitionGradual(resumed.state, "complete");
  assert(completed.ok && completed.state.status === "completed" && completed.state.insertedChars === st.totalChars,
    "gradual: completion records every character as written");
  assert(!G.transitionGradual(completed.state, "resume").ok, "gradual: a finished insertion cannot be resumed");
  assert(!G.transitionGradual(completed.state, "stop").ok, "gradual: a finished insertion cannot be stopped");

  // Illegal transitions must be refused, not silently accepted.
  assert(!G.transitionGradual(st, "pause").ok, "gradual: an insertion that never started cannot be paused");
  assert(!G.transitionGradual(st, "complete").ok, "gradual: an insertion that never started cannot complete");
  assert(!G.transitionGradual(progressed.state, "resume").ok, "gradual: resuming a running insertion is refused");
  assert(!G.transitionGradual(started.state, "progress", 0).ok, "gradual: zero-character progress is refused");

  const stopped = G.transitionGradual(progressed.state, "stop");
  assert(stopped.ok && stopped.state.status === "stopped", "gradual: stop is allowed while inserting");
  const cancelled = G.transitionGradual(progressed.state, "cancel");
  assert(!cancelled.ok, "gradual: cancel is refused after writing began (only pause-then-cancel)");
  const cancelledEarly = G.transitionGradual(paused.state, "cancel");
  assert(cancelledEarly.ok && cancelledEarly.state.status === "cancelled", "gradual: cancel is allowed while paused");

  const conflicted = G.transitionGradual(resumed.state, "conflict");
  assert(conflicted.ok && conflicted.state.status === "conflicted", "gradual: a conflict ends the insertion");
  assert(!G.transitionGradual(conflicted.state, "resume").ok, "gradual: a conflict cannot be resumed");

  // ---- progress is reported honestly, never rounded up to "done" ----
  const half = G.transitionGradual(progressed.state, "pause").state;
  assert(G.insertionProgressLabel(half).includes("Paused at 40%"), "gradual: the label states the real percentage");
  assert(!G.insertionProgressLabel(half).toLowerCase().includes("finished"), "gradual: a paused run never reads as finished");
  assert(G.insertionProgressLabel(completed.state).toLowerCase().includes("finished"), "gradual: a completed run says so");
  assert(G.recoveryNote(120).includes("120"), "gradual: the recovery note states how much text was kept");
  assert(G.recoveryNote(0).toLowerCase().includes("nothing"), "gradual: an empty remainder says nothing was left");

  assert(G.remainingText("abcdef", 4) === "ef", "gradual: the remaining text starts where the provider confirmed");
  assert(G.remainingText("abcdef", 99) === "", "gradual: over-confirmed offsets never produce phantom text");

  // ---- the honesty guarantee, in the module's own words ----
  const gSrc = readFileSync("src/lib/integrations/gradual-insert.ts", "utf8");
  const gradualRoute = readFileSync("src/app/api/integrations/google/doc-update/gradual/route.ts", "utf8");
  assert(/does not imitate typing|not a simulation/i.test(G.GRADUAL_DISCLAIMER),
    "gradual: the disclaimer states plainly that this is not typing simulation");
  assert(!/setTimeout|sleep\(|delay\(/.test(gSrc + gradualRoute),
    "gradual: no artificial delay exists to make writes look human");
  assert(!/Math\.random/.test(gSrc + gradualRoute),
    "gradual: no randomness (no injected typos or jitter)");
  // Prose that DISCLAIMS typos is required; machinery that CREATES them is forbidden.
  // So this looks for functions/identifiers, not for the word in a sentence.
  assert(!/injectTypo|addTypo|typoFor|mistype|simulateTyping|fakeKeystroke/i.test(gSrc + gradualRoute),
    "gradual: the module contains no typo or typing-simulation machinery");


  // ---- route: guarded, owner-scoped, recovery-preserving ----
  assert(gradualRoute.includes("requireUser"), "gradual route: authenticates the caller");
  assert(gradualRoute.includes("requiredRevisionId") || gradualRoute.includes("buildGuardedInsertRequest"),
    "gradual route: every write is revision-guarded, so a changed document is never overwritten");
  assert(gradualRoute.includes("recovery_copy_created"),
    "gradual route: stopping or conflicting stores a real recovery copy");
  assert(gradualRoute.includes('provider: "google"'), "gradual route: events are scoped to the caller's own provider/document");
  assert(!gradualRoute.includes("createAdminClient"),
    "gradual route: no service-role client, so RLS stays authoritative");
  assert(gradualRoute.includes("MAX_CHARS"), "gradual route: oversized insertions are refused up front");

  // ---- UI wiring ----
  const panel = readFileSync("src/components/app/GradualInsertPanel.tsx", "utf8");
  for (const label of ["Pause", "Continue", "Stop and keep a copy", "Start"]) {
    assert(panel.includes(label), `gradual UI: offers "${label}"`);
  }
  assert(panel.includes('role="progressbar"'), "gradual UI: progress is a real progressbar for screen readers");
  assert(panel.includes("confirmed by Google"), "gradual UI: progress is described as provider-confirmed");
  assert(panel.includes("does not imitate typing"), "gradual UI: the honesty note is shown to the student");
  assert(!/setTimeout/.test(panel), "gradual UI: no artificial delay in the browser either");

  const browser = readFileSync("src/components/app/DocumentBrowser.tsx", "utf8");
  assert(browser.includes("GradualInsertPanel"), "gradual UI: the panel is reachable from the document browser");
  assert(browser.includes("describeHistoryEvent"), "timeline: events render in plain language");

  // ---- plain-language timeline ----
  section("stage 4: activity timeline wording");
  for (const t of H.HISTORY_EVENT_TYPES) {
    const d = H.describeHistoryEvent({ eventType: t, actor: "sophira", provenance: "sophira-inserted", outcome: "confirmed" });
    assert(d.what.length > 10 && !d.what.includes("_"), `timeline: "${t}" has a plain-language description`);
  }
  const externalEvent = H.describeHistoryEvent({ eventType: "external_change_observed", actor: "external", provenance: "external-observed", outcome: "unavailable" });
  assert(/cannot tell who/i.test(externalEvent.origin),
    "timeline: an outside change never claims to know who made it");
  const pendingEvent = H.describeHistoryEvent({ eventType: "insertion_attempted", actor: "sophira", provenance: "sophira-inserted", outcome: "pending" });
  assert(/not confirmed/i.test(pendingEvent.confirmation), "timeline: an unconfirmed write says it is unconfirmed");
  const providerEvent = H.describeHistoryEvent({ eventType: "recovery_copy_created", actor: "provider", provenance: "provider-reported", outcome: "confirmed" });
  assert(providerEvent.what.length > 10, "timeline: recovery copies are explained in the same plain language");
  assert(H.HISTORY_EVENT_TYPES.includes("recovery_copy_created") && H.HISTORY_EVENT_TYPES.includes("insertion_stopped"),
    "timeline: the two Stage 4 event types exist in the shared vocabulary");

  // ---- UI wiring ----
  const ui = readFileSync("src/components/app/DocumentBrowser.tsx", "utf8");
  assert(ui.includes("document-history?provider=") && ui.includes("Document history"), "ui: selections expose their document history");
  assert(ui.includes("Compare last two versions") && ui.includes("Check for changes outside Sophira"),
    "ui: comparison and outside-change checks are reachable");
  assert(ui.includes("Recovery copy") && ui.includes("Restore this version"),
    "ui: recovery and version restore are exposed with confirmation");
}
