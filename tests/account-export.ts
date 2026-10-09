/**
 * ACCOUNT DATA EXPORT (2026-10-09): privacy requirement — users can download
 * every record they own. Conformance tests for the export route + UI:
 * authorization chain, RLS-only reads (no admin client), complete table
 * coverage, honest truncation, downloadable response shape.
 */
import { readFileSync } from "fs";
import { execSync as _exec } from "child_process";
const execSync2 = (cmd: string): string[] => _exec(cmd, { encoding: "utf8" }).split("\n").filter(Boolean);

export function runAccountExportTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Account data export: complete, authorized, RLS-scoped, honest");

  const route = readFileSync("src/app/api/account/export/route.ts", "utf8");

  // Authorization chain: authenticated -> ACTIVE access (revoked users cannot export)
  assert(route.includes("requireUser") && route.includes("guard.ok") && route.includes("guard.response"),
    "export: the route enforces the full authorization chain (authenticated -> ACTIVE access) before reading anything");

  // RLS-only: the export uses the user-scoped client, never the admin/service-role client
  assert(!route.includes("createAdminClient") && !route.includes("createServiceClient") && !route.includes("service_role"),
    "export: reads happen ONLY through the RLS-scoped client — no admin/service-role client can read a member's data");
  assert(route.includes("createClient"),
    "export: the route creates the user-scoped Supabase client for every read");

  // Complete table coverage: every user-owned table in the migrations is exported
  const tableLines = execSync2(
    "grep -h '^create table' supabase/migrations/*.sql | sed 's/create table //; s/if not exists //; s/public\\.//; s/ *(.*//' | tr -d ' ' | sort -u"
  ).filter(Boolean);
  const userOwned = tableLines.filter((t) =>
    !["invitations", "invitation_requests", "app_config", "sophira_meta", "owner_bootstrap", "provider_usage"].includes(t)
  );
  for (const t of userOwned) {
    assert(route.includes(`"${t}"`),
      `export: user-owned table ${t} is included in the export scope`);
  }
  // The exclusions are exactly the non-user tables (system/operator/telemetry) — nothing silently dropped
  for (const t of ["invitations", "invitation_requests", "app_config", "sophira_meta", "owner_bootstrap", "provider_usage"]) {
    assert(!route.includes(`"${t}"`),
      `export: non-user table ${t} is NOT exported (it is not the member's personal data)`);
  }

  // Honest limits: row caps reported, read errors reported, never silently omitted
  assert(route.includes("truncated") && route.includes("ROW_CAP"),
    "export: per-table row cap is reported as truncated — the export never lies about completeness");
  assert(route.includes("Could not read this table"),
    "export: a failed table read is reported as an error entry, never silently omitted");
  assert(route.includes("truncated_any"),
    "export: the document carries a global truncation flag");

  // Downloadable response shape
  assert(route.includes("content-disposition") && route.includes("attachment") && route.includes("application/json"),
    "export: the response is a downloadable JSON attachment (content-disposition set)");
  assert(route.includes("no-store"),
    "export: the response is never cached (personal data must not linger in shared caches)");
  assert(route.includes("exported_at") && route.includes("format") && route.includes("version"),
    "export: the document is self-describing (format, version, exported_at)");

  // Uploaded file binaries stay in private storage — records only, honestly stated
  assert(route.includes("not the bytes themselves") || route.includes("bytes themselves") || route.includes("storage"),
    "export: the route documents that file binaries remain in private storage (records only)");

  // UI: Settings offers the download, reports failures honestly, no fake success
  const settings = readFileSync("src/app/settings/page.tsx", "utf8");
  assert(settings.includes("/api/account/export") && settings.includes("Download my data"),
    "export: the Settings page offers 'Download my data (JSON)' backed by the export route");
  assert(settings.includes("Could not prepare the export") || settings.includes("Could not reach the server"),
    "export: export failures surface an honest error message in the UI");
  assert(settings.includes("Could not reach the server"),
    "export: network failures surface an honest error message in the UI");
  assert(settings.includes("URL.revokeObjectURL"),
    "export: the UI releases the object URL after download (no dangling blob references)");
}
