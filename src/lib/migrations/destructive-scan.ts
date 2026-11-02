/**
 * DESTRUCTIVE MIGRATION SCAN (data preservation, 2026-11-02).
 *
 * Requirement: "Database migrations must be incremental and must preserve existing
 * records." A migration that drops a table, empties one, or rewrites every row silently
 * destroys member data and academic records.
 *
 * The scan is deliberately simple and static: it reads the SQL text and looks for
 * statements that cannot be undone. It is NOT a SQL parser and does not pretend to be
 * one. Its purpose is to make an irreversible statement impossible to add by accident,
 * and to force a deliberate, documented decision when one is genuinely required.
 *
 * Approval: a statement is allowed only when a nearby comment carries the marker
 *   -- destructive-approved: <reason>
 * so the reason is recorded in the migration itself, reviewable forever.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface DestructiveFinding {
  file: string;
  line: number;
  kind: string;
  statement: string;
  approved: boolean;
  reason: string | null;
}

const APPROVAL = /destructive-approved:\s*(.+)/i;

type Rule = { kind: string; test: (sql: string) => boolean };

/** Normalise for matching: strip line comments and collapse whitespace. */
function normalise(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const RULES: Rule[] = [
  { kind: "drop_table", test: (s) => /\bdrop\s+table\b/i.test(s) },
  { kind: "drop_column", test: (s) => /\bdrop\s+column\b/i.test(s) },
  { kind: "drop_schema", test: (s) => /\bdrop\s+schema\b/i.test(s) },
  { kind: "truncate", test: (s) => /\btruncate\b/i.test(s) },
  // A DELETE or UPDATE with no WHERE rewrites or empties the whole table.
  {
    kind: "delete_without_where",
    test: (s) => {
      const m = /\bdelete\s+from\s+[^\s;]+([^;]*)/i.exec(s);
      return !!m && !/\bwhere\b/i.test(m[1]);
    },
  },
  {
    kind: "update_without_where",
    test: (s) => {
      const m = /\bupdate\s+[^\s;]+\s+set\b([^;]*)/i.exec(s);
      return !!m && !/\bwhere\b/i.test(m[1]);
    },
  },
];

/**
 * Scan one file's SQL. Approval comments may sit on the statement line or up to three
 * lines above it, which is how migrations in this repository are written.
 */
export function scanSql(name: string, sql: string): DestructiveFinding[] {
  const lines = sql.split("\n");
  const effective = normalise(sql);
  const findings: DestructiveFinding[] = [];

  for (const rule of RULES) {
    if (!rule.test(effective)) continue;

    // Report every occurrence so two destructive statements cannot hide behind one approval.
    lines.forEach((rawLine, index) => {
      const lineNo = index + 1;
      const window = lines.slice(Math.max(0, index - 3), index + 1).join("\n");
      const statement = rawLine.replace(/--.*$/, "").trim();
      if (!statement) return;
      if (!rule.test(statement) && !rule.test(window)) return;
      // Only count the line that actually carries the destructive keyword.
      if (!rule.test(statement)) return;

      const approval = APPROVAL.exec(window);
      findings.push({
        file: name,
        line: lineNo,
        kind: rule.kind,
        statement: statement.slice(0, 200),
        approved: !!approval,
        reason: approval ? approval[1].trim() : null,
      });
    });
  }

  return findings;
}

export function scanMigrations(dir = "supabase/migrations"): {
  files: number;
  findings: DestructiveFinding[];
  unapproved: DestructiveFinding[];
} {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const findings: DestructiveFinding[] = [];
  for (const file of files) {
    findings.push(...scanSql(file, readFileSync(join(dir, file), "utf8")));
  }
  return { files: files.length, findings, unapproved: findings.filter((f) => !f.approved) };
}
