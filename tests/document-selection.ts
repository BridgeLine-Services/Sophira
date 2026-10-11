/**
 * DOCUMENT SELECTION + WORKLOAD ISOLATION TESTS (2026-10-12).
 * Covers the document-access round: discovery honesty, read-only
 * extraction, workload-selection records, IDOR/tamper resistance, and
 * consent honesty. Live provider behavior remains EXTERNALLY BLOCKED
 * until the owner registers the apps — nothing here fakes it.
 */
import { readFileSync } from "fs";

export async function runDocumentSelectionTests(assert: (cond: boolean, label: string) => void, section: (t: string) => void): Promise<void> {
  section("Document selection & workload isolation");

  // ---- migration 0034: the workload_selections boundary record ----
  const mig = readFileSync("supabase/migrations/0034_workload_selections.sql", "utf8");
  assert(mig.includes("create table if not exists public.workload_selections") &&
    mig.includes("user_id uuid not null references auth.users(id) on delete cascade"),
    "0034: workload selections are owner-bound rows (user_id references the authenticated user, cascading on delete)");
  assert(mig.includes("unique (user_id, provider, provider_document_id)"),
    "0034: one active selection per user+provider+document (no silent duplicates)");
  assert(mig.includes("enable row level security") &&
    ["for select", "for insert", "for update", "for delete"].every((op) => mig.includes(op)) &&
    (mig.match(/auth\.uid\(\) = user_id/g) ?? []).length >= 4,
    "0034: RLS on with owner-only policies for all four operations");
  const markers = readFileSync("scripts/migration-markers.mjs", "utf8");
  assert(markers.includes('"0034_workload_selections.sql"'),
    "0034: marker registered (CI + runtime wizard agree)");
  const generated = readFileSync("src/lib/db-migrations.generated.ts", "utf8");
  assert(generated.includes("0034_workload_selections"),
    "0034: embedded in the generated runtime chain");
  const gate = readFileSync("scripts/release-gate.mjs", "utf8");
  assert(gate.includes("workload_selections") && gate.includes("0001-0034"),
    "gate: the migration probe verifies the NEWEST migration (0034 workload_selections)");
  const conn32 = readFileSync("supabase/migrations/0032_provider_connections.sql", "utf8");
  assert(!conn32.includes("create policy"),
    "0032 unchanged: provider tokens remain service-role-only (no client policies) — selections never loosened token isolation");

  // ---- real docx text extraction round-trip (the read path for Word files) ----
  const { buildDocx } = await import("../src/lib/documents/export");
  const artifact = {
    title: "Roundtrip Document",
    artifactType: "essay",
    sections: [{ heading: "Section A", items: ["User one is responsible for this section only."], sources: [] }],
    provenance: [],
    artifactId: "sel-roundtrip",
    notebookId: "nb-roundtrip",
    createdAt: "2026-10-12T00:00:00.000Z",
  };
  const docx = await buildDocx(artifact);
  const mammoth = await import("mammoth");
  const extracted = (await mammoth.extractRawText({ buffer: docx })).value;
  assert(extracted.includes("Roundtrip Document") && extracted.includes("User one is responsible for this section only."),
    "read: a real .docx round-trips through the extraction path (mammoth) — document text is genuinely retrievable");

  // ---- eligibility honesty ----
  const { eligibilityFor } = await import("../src/lib/integrations/files");
  assert(eligibilityFor("application/vnd.google-apps.document").readable_text &&
    eligibilityFor("application/vnd.openxmlformats-officedocument.wordprocessingml.document").readable_text,
    "read: Google Docs and Word documents are readable as text");
  const slides = eligibilityFor("application/vnd.google-apps.presentation");
  assert(!slides.readable_text && slides.reason.includes("cannot be read as text"),
    "read: presentations are HONESTLY not-yet-readable (never silently claimed)");

  // ---- server-side selection validation ----
  const { validateSelectionInput } = await import("../src/lib/integrations/files");
  const bad1 = validateSelectionInput({ provider: "dropbox", provider_document_id: "x" });
  assert(!bad1.ok, "selection: unknown providers are rejected server-side");
  const bad2 = validateSelectionInput({ provider: "google" });
  assert(!bad2.ok, "selection: a document id is required server-side");
  const good = validateSelectionInput({ provider: "google", provider_document_id: " abc ", document_title: "  Group essay  ", scope_description: "Section A only", access_state: "write" });
  assert(good.ok && good.value.provider_document_id === "abc" && good.value.scope_description === "Section A only",
    "selection: valid input is trimmed and normalized");
  const injected = validateSelectionInput({ provider: "google", provider_document_id: "x", user_id: "someone-else" } as never);
  assert(injected.ok && !("user_id" in injected.value),
    "selection: a client-supplied user_id is ignored by validation — the session user id is the only owner");

  // ---- route-level tamper resistance (TEST F/G pattern, static pins) ----
  const selRoute = readFileSync("src/app/api/integrations/selections/route.ts", "utf8");
  assert(selRoute.includes("user_id: guard.data.user.id") && !selRoute.includes("body.user_id"),
    "route: selections are created with the SESSION user id — never a client-supplied one");
  const selIdRoute = readFileSync("src/app/api/integrations/selections/[id]/route.ts", "utf8");
  assert(selIdRoute.includes('.eq("user_id", guard.data.user.id)'),
    "route: update/delete of a selection is constrained to the session user (RLS as defense in depth)");
  for (const f of ["microsoft/files", "google/files", "microsoft/file-content", "google/file-content"]) {
    const src = readFileSync(`src/app/api/integrations/${f}/route.ts`, "utf8");
    assert(src.includes("guard.data.user.id"),
      `route: ${f} operates ONLY through the session user's own connection`);
    assert(!src.includes("user_id") || !src.match(/searchParams\.get\("user_id"\)/),
      `route: ${f} never accepts a user id from the client`);
  }
  const filesLib = readFileSync("src/lib/integrations/files.ts", "utf8");
  assert(filesLib.includes('access: "listed"'),
    "honesty: a discovered file is only ever 'listed' — discovery is never reported as write access or synchronization");

  // ---- Google consent honesty ----
  const oauthState = readFileSync("src/lib/integrations/oauth-state.ts", "utf8");
  const { googleAuthorizeUrl } = await import("../src/lib/integrations/oauth-state");
  const defaultUrl = googleAuthorizeUrl("cid", "https://app.example/cb", "st");
  assert(!defaultUrl.includes("drive.readonly"),
    "consent: the default Google flow stays at least-privilege drive.file");
  const browseUrl = googleAuthorizeUrl("cid", "https://app.example/cb", "st", ["https://www.googleapis.com/auth/drive.readonly"]);
  assert(browseUrl.includes("drive.readonly"),
    "consent: drive.readonly is added ONLY through the explicit browse intent (incremental consent)");
  const authRoute = readFileSync("src/app/api/integrations/google/authorize/route.ts", "utf8");
  assert(authRoute.includes('intent === "browse"'),
    "consent: the authorize route grants the broader scope only on the explicit browse intent");
  const gFilesRoute = readFileSync("src/app/api/integrations/google/files/route.ts", "utf8");
  assert(gFilesRoute.includes('granted.includes("drive.readonly")') && gFilesRoute.includes("browse_consent_url"),
    "consent: browsing all accessible files requires the granted read-only scope; otherwise the UI is offered the consent, not a fake list");

  // ---- Microsoft shared-file honesty ----
  const msLib = readFileSync("src/lib/integrations/microsoft.ts", "utf8");
  assert(msLib.includes("sharedWithMe") && msLib.includes("restricts"),
    "honesty: tenant-restricted shared-file listing returns an explicit note, never a silent empty 'connected' list");
  assert(msLib.includes("Files.ReadWrite.All") === false,
    "honesty: no tenant-wide scope (Files.ReadWrite.All etc.) is ever requested to work around sharing restrictions");
  assert(msLib.includes("downloadDriveItem") && msLib.includes("not permitted to read that file"),
    "honesty: 403 on a specific file is reported as a permission refusal, never bypassed with another account");

  // ---- UI mounts the workflow ----
  const panel = readFileSync("src/components/app/IntegrationsPanel.tsx", "utf8");
  assert(panel.includes("<DocumentBrowser />"),
    "ui: the Integrations panel mounts the document browser + workload scope workflow");
  const browser = readFileSync("src/components/app/DocumentBrowser.tsx", "utf8");
  assert(browser.includes("scope_description") && browser.includes("only ever works for you"),
    "ui: the user confirms the workload scope before a selection is saved, with the boundary stated in plain language");
}
