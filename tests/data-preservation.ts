/**
 * DATA AND MEMBER PRESERVATION (2026-11-02).
 *
 * The requirement is that rebuilding or redeploying Sophira can never quietly destroy
 * members, invitations, permissions, or academic records. These tests pin the three
 * mechanisms that make that true, so a future change cannot undo them without failing CI.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scanSql, scanMigrations } from "../src/lib/migrations/destructive-scan";

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

export function runDataPreservationTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): void {
  section("data preservation (migrations cannot silently destroy records)");

  assert(scanSql("x.sql", "create table t (id uuid);").length === 0,
    "migrations: an additive statement is not flagged");
  assert(scanSql("x.sql", "drop table members;").some((f) => f.kind === "drop_table"),
    "migrations: DROP TABLE is flagged");
  assert(scanSql("x.sql", "alter table t drop column email;").some((f) => f.kind === "drop_column"),
    "migrations: DROP COLUMN is flagged");
  assert(scanSql("x.sql", "truncate members;").some((f) => f.kind === "truncate"),
    "migrations: TRUNCATE is flagged");
  assert(scanSql("x.sql", "delete from members;").some((f) => f.kind === "delete_without_where"),
    "migrations: a DELETE with no WHERE is flagged (it would empty the table)");
  assert(scanSql("x.sql", "delete from members where id = $1;").length === 0,
    "migrations: a targeted DELETE is not flagged");
  assert(scanSql("x.sql", "update profiles set status = 'active';").some((f) => f.kind === "update_without_where"),
    "migrations: an UPDATE with no WHERE is flagged (it would rewrite every member)");
  assert(scanSql("x.sql", "update profiles set status = 'active' where id = $1;").length === 0,
    "migrations: a targeted UPDATE is not flagged");

  // Comments must not create false alarms, and an approval must be explicit.
  assert(scanSql("x.sql", "-- we will never drop table here\nselect 1;").length === 0,
    "migrations: a destructive word inside a comment is not flagged");
  const approved = scanSql("x.sql", "-- destructive-approved: clearing expired refresh tokens only\ndelete from auth.refresh_tokens;");
  assert(approved.length === 1 && approved[0].approved && Boolean(approved[0].reason?.includes("refresh tokens")),
    "migrations: a destructive statement with a documented reason is allowed and the reason is retained");
  const twoStatements = scanSql("x.sql", "-- destructive-approved: one reason\ndelete from a;\ndelete from b;");
  assert(twoStatements.filter((f) => f.kind === "delete_without_where").length === 2,
    "migrations: two destructive statements are both reported, so one approval cannot cover both silently");

  // The real repository must be clean.
  const repo = scanMigrations();
  assert(repo.files >= 41, `migrations: the whole chain is scanned (${repo.files} files)`);
  assert(repo.unapproved.length === 0,
    `migrations: no unapproved destructive statement exists in the chain (found: ${repo.unapproved.map((f) => `${f.file}:${f.line} ${f.kind}`).join(", ") || "none"})`);

  section("member preservation (every API route is authenticated or deliberately public)");

  // Routes that may be reached without a member session. Each has a documented reason in
  // its own file; adding one here is a deliberate decision, which is the point.
  const PUBLIC_API = new Set([
    "/api/health",
    "/api/ai/health",
    "/api/setup-status",
    "/api/setup-repair",
    "/api/setup-sql",
    // Self-guarded rather than guard-protected: both run BEFORE a member can be active.
    //   complete-owner    — the first owner has no profile yet; ownership is decided by the
    //                       database (migration 0025), not by the request.
    //   invitations/accept — an invited person is 'pending' until they accept, so requireUser
    //                       would deny the very request that activates them.
    // Each is asserted below to perform its own verification, so "self-guarded" is not a
    // synonym for "open".
    "/api/complete-owner",
    "/api/invitations/accept",
  ]);
  const OWNER_OR_MEMBER = /requireUser|requireOwner/;

  const routes = walk("src/app/api").filter((f) => f.endsWith("route.ts"));
  const unguarded = routes
    .filter((f) => {
      const source = readFileSync(f, "utf8");
      if (OWNER_OR_MEMBER.test(source)) return false;
      const route = "/" + f.replace(/^src\/app\//, "").replace(/\/route\.ts$/, "");
      return !PUBLIC_API.has(route);
    })
    .map((f) => "/" + f.replace(/^src\/app\//, "").replace(/\/route\.ts$/, ""));

  assert(routes.length >= 80, `api: the audit sees the real route set (${routes.length} routes)`);
  assert(unguarded.length === 0,
    `api: every route is guarded by requireUser/requireOwner or is deliberately public (unguarded: ${unguarded.join(", ") || "none"})`);

  // The two self-guarded routes must actually verify something themselves.
  for (const [file, marker] of [
    ["src/app/api/complete-owner/route.ts", /status|owner/i],
    ["src/app/api/invitations/accept/route.ts", /invitation|status/i],
  ] as const) {
    const source = readFileSync(file, "utf8");
    assert(marker.test(source) && /getUser\(\)/.test(source),
      `api: ${file.split("/api/")[1]} identifies the caller itself instead of trusting the request`);
  }

  // Identity must not be keyed on email: revocation and reinstatement depend on the
  // permanent auth id, and a member without a name or email stays a valid record.
  const guard = readFileSync("src/lib/supabase/guard.ts", "utf8");
  assert(/ACTIVE_STATUSES/.test(guard) && /fail CLOSED/.test(guard),
    "members: access is granted only to an allow-list of statuses, so an unknown status is denied");
  assert(/select\("\*"\)\.eq\("id", user\.id\)/.test(guard),
    "members: the member record is looked up by the permanent auth id, never by email");

  // Revocation must reach live sessions, not just hide navigation.
  const middleware = readFileSync("src/middleware.ts", "utf8");
  assert(/revoked/.test(middleware) && /access-denied/.test(middleware),
    "members: a revoked member is turned away from protected pages on their next request");
  const revocation = walk("supabase/migrations").map((f) => readFileSync(f, "utf8")).join("\n");
  assert(/refresh_tokens/i.test(revocation),
    "members: revocation clears stored refresh tokens, so a revoked session cannot renew itself");

  section("data preservation (the record census catches data loss, not just missing members)");
  {
    // The preservation script used to compare members and invitations only, so a migration or
    // restore that emptied assignments, notebooks or research still reported "preserved".
    // Its comparison is now exercised offline, against planted losses, so the day the logic
    // breaks the suite says so instead of waiting for a real deployment to lose data.
    const out = execFileSync("node", ["scripts/member-preservation.mjs", "--self-test"], {
      encoding: "utf8",
      cwd: process.cwd(),
    });
    assert(/self-test: PASS/.test(out), "preservation: the census comparison self-test passes offline");
    assert(/[1-9]\d* planted losses detected/.test(out),
      "preservation: the self-test detects planted losses (it is not a vacuous pass)");
    assert(/legitimate changes correctly ignored/.test(out) && !/FAIL/.test(out),
      "preservation: growth and unchanged counts are NOT reported as loss");

    const source = readFileSync("scripts/member-preservation.mjs", "utf8");
    assert(/member_notifications/.test(source) && /research_sources/.test(source) && /notebooks/.test(source),
      "preservation: the census covers academic records and the notification tables, not only members");
    // Inspect the LIST, not the file: the comment above the list names these tables in order to
    // explain why they are excluded, and a test that greps the whole file cannot tell the
    // difference between a mention and an entry.
    const list = source.slice(source.indexOf("const CENSUS_TABLES = ["), source.indexOf("];", source.indexOf("const CENSUS_TABLES = [")));
    assert(list.length > 100, "preservation: the census table list is found and non-trivial");
    assert(!/owner_bootstrap|app_config|sophira_meta/.test(list),
      "preservation: setup state (owner bootstrap, app config, schema meta) is excluded from the census on purpose");
  }
}
