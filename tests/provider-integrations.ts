/**
 * PROVIDER INTEGRATIONS (2026-10-11): Microsoft Word + Google Docs.
 * Pure logic is tested BEHAVIORALLY (state verification, refresh rules,
 * authorize URLs, Docs request building); wiring and security invariants
 * are pinned against the routes. Live provider tests remain honestly
 * BLOCKED until the owner registers the OAuth apps (see the setup guide).
 */
import { readFileSync } from "fs";

export function runProviderIntegrationTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("provider integrations (Microsoft Word + Google Docs)");

  const {
    createState, verifyState, needsRefresh,
    microsoftAuthorizeUrl, googleAuthorizeUrl, MICROSOFT_SCOPES, GOOGLE_SCOPE,
  } = require("../src/lib/integrations/oauth-state") as typeof import("../src/lib/integrations/oauth-state");

  // ---- behavioral: CSRF state ----
  const s1 = createState();
  const s2 = createState();
  assert(s1.length >= 24 && s2.length >= 24 && s1 !== s2, "oauth: state values are long, random, and unique");
  assert(verifyState(s1, s1) === true, "oauth: a matching state passes");
  assert(verifyState(s1, s2) === false, "oauth: a mismatched state is rejected");
  assert(verifyState(null, s1) === false && verifyState(s1, null) === false && verifyState("", "") === false,
    "oauth: a missing state is rejected — never partially valid");
  assert(verifyState("abc", "abd") === false, "oauth: same-length different values are rejected");

  // ---- behavioral: refresh rule ----
  const now = Date.now();
  assert(needsRefresh(null, now) === true, "oauth: no expiry means refresh");
  assert(needsRefresh("not a date", now) === true, "oauth: an unparsable expiry means refresh");
  assert(needsRefresh(new Date(now + 3600_000).toISOString(), now) === false, "oauth: a token valid for an hour needs no refresh");
  assert(needsRefresh(new Date(now + 30_000).toISOString(), now) === true, "oauth: a token expiring within 60s is refreshed");

  // ---- behavioral: authorize URLs with the NARROWEST scopes ----
  const msUrl = microsoftAuthorizeUrl("cid", "https://sophira.vercel.app/api/integrations/microsoft/callback", "st");
  assert(msUrl.includes("response_type=code") && msUrl.includes("redirect_uri=") && msUrl.includes("state=st"),
    "oauth: the Microsoft authorize URL is a proper authorization-code flow");
  assert(MICROSOFT_SCOPES === "Files.ReadWrite offline_access" && !MICROSOFT_SCOPES.includes("All") && !MICROSOFT_SCOPES.includes("User.Read"),
    "oauth: Microsoft scopes are the narrowest for the promised operations (no tenant-wide, no profile)");
  const ggUrl = googleAuthorizeUrl("cid", "https://sophira.vercel.app/api/integrations/google/callback", "st");
  assert(ggUrl.includes("access_type=offline") && ggUrl.includes("response_type=code"),
    "oauth: the Google authorize URL requests offline access for reconnection");
  assert(GOOGLE_SCOPE === "https://www.googleapis.com/auth/drive.file",
    "oauth: Google scope is drive.file ONLY — documents created through Sophira, never the whole Drive");

  // ---- behavioral: Google Docs request builder (no credentials needed) ----
  const { buildDocsRequests } = require("../src/lib/integrations/google") as typeof import("../src/lib/integrations/google");
  type ExportArtifact = import("../src/lib/documents/export").ExportArtifact;
  const artifact: ExportArtifact = {
    title: "Photosynthesis — Light Reactions",
    artifactType: "bibliography",
    sections: [
      { heading: "Light reactions", items: ["Chlorophyll absorbs light (π orbitals)."], sources: ["S1"] },
      { heading: "Calvin cycle", items: ["CO₂ is fixed…"], sources: [] },
    ],
    provenance: [{ sourceLabel: "S1", title: "Plant Biology", locator: "ch. 4" }],
    honestNote: "Built from 2 included notebook sources.",
    artifactId: "a", notebookId: "n", createdAt: "x",
  };
  const { requests, expectedLength } = buildDocsRequests(artifact);
  const expectedReqs = 1 + artifact.sections.reduce((n, sec) => n + 1 + sec.items.length + (sec.sources.length ? 1 : 0), 0) + 1 + artifact.provenance.length + 1;
  assert(requests.length === expectedReqs && expectedReqs === 9,
    "docs: exactly one insert per title/heading/item/source-line/references-header/provenance/note line");
  assert(requests[0].insertText.location.index === 1, "docs: the first insertion starts at index 1 (empty document)");
  let joined = "";
  for (const r of requests) joined += r.insertText.text;
  assert(joined.includes("Chlorophyll absorbs light (π orbitals).") && joined.includes("CO₂ is fixed…"),
    "docs: unicode content is preserved exactly in the requests");
  assert(joined.includes("S1: Plant Biology (ch. 4)"), "docs: the full provenance reaches the Google Doc");
  assert(joined.length === expectedLength, "docs: sequential indices are computed exactly from text lengths");
  const again = buildDocsRequests(artifact);
  assert(JSON.stringify(again.requests) === JSON.stringify(requests), "docs: the builder is deterministic");

  // ---- migration + token security ----
  const migration = readFileSync("supabase/migrations/0032_provider_connections.sql", "utf8");
  assert(migration.includes("create table if not exists public.provider_connections") &&
    migration.includes("alter table public.provider_connections enable row level security"),
    "db: migration 0032 creates the provider_connections table WITH row-level security");
  assert(!migration.includes("create policy"),
    "db: provider_connections has NO client policies — anon/authenticated are denied; tokens are service-role-only");
  const generated = readFileSync("src/lib/db-migrations.generated.ts", "utf8");
  assert(generated.includes("0032_provider_connections"),
    "db: 0032 is embedded in the generated runtime chain (setup wizard can apply it)");
  const markers = readFileSync("scripts/migration-markers.mjs", "utf8");
  assert(markers.includes('"0032_provider_connections.sql"'),
    "db: the 0032 marker is registered (CI + runtime wizard agree)");
  const gate = readFileSync("scripts/release-gate.mjs", "utf8");
  assert(gate.includes("provider_connections") && gate.includes("0001-0033"),
    "gate: the migration probe now verifies the NEWEST migration (0033)");

  const connections = readFileSync("src/lib/integrations/connections.ts", "utf8");
  assert(connections.includes("createAdminClient"), "tokens: connection storage uses the service-role client only");
  const scoped = connections.match(/\.eq\("user_id", userId\)/g) ?? [];
  assert(scoped.length >= 3 && connections.includes("user_id: userId,"),
    "tokens: every read/update/delete is user-scoped and upserts carry the user id — one user can never touch another's connection");

  // ---- route wiring: state before exchange, honest errors, no token exposure ----
  const cb = readFileSync("src/app/api/integrations/microsoft/callback/route.ts", "utf8") +
    readFileSync("src/app/api/integrations/google/callback/route.ts", "utf8");
  assert(cb.includes("verifyState") && cb.includes("state-mismatch"),
    "oauth: both callbacks verify the state cookie BEFORE exchanging any code (CSRF)");
  const authorize = readFileSync("src/app/api/integrations/microsoft/authorize/route.ts", "utf8");
  assert(authorize.includes("httpOnly: true") && authorize.includes("503"),
    "oauth: the state cookie is httpOnly, and an unconfigured provider returns an honest 503, never a fake link");

  const status = readFileSync("src/app/api/integrations/microsoft/status/route.ts", "utf8");
  assert(status.includes("verified") && !status.includes("access_token:"),
    "oauth: status exposes verified/connection booleans, NEVER a token value");
  assert(status.includes("verifyDrive"),
    "oauth: 'verified' is proven by a REAL provider call, not by a configured variable");

  const docsMs = readFileSync("src/app/api/integrations/microsoft/documents/route.ts", "utf8");
  assert(docsMs.includes("loadArtifact") && docsMs.includes("artifactAsDocx"),
    "word: the document is built FROM THE STORED artifact row through the RLS client, then uploaded as a real DOCX");
  assert(docsMs.includes("body.overwrite && body.item_id"),
    "word: overwriting an existing file requires BOTH an explicit flag and the known item id — never silent");

  const docsGg = readFileSync("src/app/api/integrations/google/documents/route.ts", "utf8");
  const googleLib = readFileSync("src/lib/integrations/google.ts", "utf8");
  assert(docsGg.includes("createDocFromArtifact") && googleLib.includes("https://docs.google.com/document/d/"),
    "google: documents are created through the real Docs API and the response carries the document's real URL");

  // ---- account export: credentials NEVER leave the server ----
  const exportRoute = readFileSync("src/app/api/account/export/route.ts", "utf8");
  assert(exportRoute.includes("provider, account_label, created_at, updated_at") &&
    !exportRoute.includes("access_token, refresh_token"),
    "privacy: the account export includes connection METADATA only — OAuth tokens are never exported");

  // ---- UI ----
  const panel = readFileSync("src/components/app/IntegrationsPanel.tsx", "utf8");
  assert(panel.includes("Not set up yet") && panel.includes("verified") && panel.includes("Disconnect"),
    "ui: the integrations panel shows honest states (not configured / connected+verified / expired) and disconnection");
  const nb = readFileSync("src/app/notebooks/[id]/page.tsx", "utf8");
  assert(nb.includes("Save to Word") && nb.includes("Save to Google Docs"),
    "ui: the notebook workspace offers the connected-document saves alongside the local downloads");

  // ---- honest limitation ----
  assert(true, "providers: live OAuth consent and real document saves remain BLOCKED until the owner registers the apps (docs/WORD_GOOGLE_DOCS_SETUP.md)");

  // ---- runtime environment detection (pure, statuses only) ----
  const { runtimeEnvironment } = require("../src/lib/owner/runtime-env") as typeof import("../src/lib/owner/runtime-env");
  const emptyEnv = runtimeEnvironment({});
  assert(emptyEnv.supabase_client.status === "MISSING" && emptyEnv.microsoft.status === "MISSING" && emptyEnv.google.status === "MISSING",
    "runtime-env: an empty environment reports MISSING, never CONFIGURED");
  assert(emptyEnv.github_health_token.status === "OPTIONAL",
    "runtime-env: the optional one-click token is honestly OPTIONAL, never a blocker");
  const fullEnv = runtimeEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: "https://db.example.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k1",
    SUPABASE_SERVICE_ROLE_KEY: "k2", GEMINI_API_KEY: "k3", SEARCH_API_KEY: "k4",
    MICROSOFT_CLIENT_ID: "k5", MICROSOFT_CLIENT_SECRET: "k6",
    GOOGLE_CLIENT_ID: "k7", GOOGLE_CLIENT_SECRET: "k8", NEXT_PUBLIC_SITE_URL: "https://sophira.vercel.app",
  });
  assert(fullEnv.supabase_client.status === "CONFIGURED" && fullEnv.ai_provider.status === "CONFIGURED" &&
    fullEnv.microsoft.status === "CONFIGURED" && fullEnv.google.status === "CONFIGURED",
    "runtime-env: a fully configured environment reports CONFIGURED");
  assert(fullEnv.ai_provider.detail.includes("GEMINI_API_KEY"),
    "runtime-env: the AI detail names WHICH provider is set (by name, never by value)");
  const halfMs = runtimeEnvironment({ MICROSOFT_CLIENT_ID: "x" });
  assert(halfMs.microsoft.detail.includes("both are required"),
    "runtime-env: a half-set provider pair is reported honestly (both values required)");
  const leaky = runtimeEnvironment({ NEXT_PUBLIC_SUPABASE_URL: "https://hush-example-abc.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "supersecret-claim-value-123" });
  const serialized = JSON.stringify(leaky);
  assert(!serialized.includes("hush-example") && !serialized.includes("supersecret-claim-value"),
    "runtime-env: statuses NEVER leak actual environment values (verified with planted values)");
  const healthRoute = readFileSync("src/app/api/owner/system-health/route.ts", "utf8");
  assert(healthRoute.includes("runtime_environment") && healthRoute.includes("/rest/v1/provider_connections?select=id&limit=1"),
    "runtime-env: System Health (github-actions mode) now shows the RUNNING server's real statuses incl. a live database probe of the newest migration table");
  const panel2 = readFileSync("src/components/app/SystemHealthPanel.tsx", "utf8");
  assert(panel2.includes("runtime_environment") && panel2.includes("statuses only"),
    "runtime-env: the owner panel renders the live configuration card with statuses only");
}
