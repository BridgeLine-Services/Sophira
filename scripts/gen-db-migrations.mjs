#!/usr/bin/env node
/**
 * GENERATE the runtime migration chain (2026-10-07).
 *
 * Emits src/lib/db-migrations.generated.ts - the COMPLETE migration chain
 * (name + marker + SQL, in order) embedded in the server bundle so the
 * FIRST-LAUNCH SETUP WIZARD can initialize an empty or partially
 * initialized database from the deployed app itself (no SQL editor, no
 * CI knowledge). The offline suite pins the generated content byte-for-byte
 * against supabase/migrations/*.sql, and pins the marker table byte-for-byte
 * against scripts/migration-markers.mjs, so the embedded chain can never
 * drift from the pipeline's chain.
 *
 * Run after adding any migration: node scripts/gen-db-migrations.mjs
 * (the test suite FAILS if a migration file is not reflected here).
 */
import { readFileSync, readdirSync, writeFileSync } from "fs";
import path from "path";
import { MARKERS } from "./migration-markers.mjs";

const ROOT = path.join(process.cwd());
const DIR = path.join(ROOT, "supabase", "migrations");
const OUT = path.join(ROOT, "src", "lib", "db-migrations.generated.ts");

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const entries = files.map((f) => ({
  name: f,
  marker: MARKERS[f] || null,
  sql: readFileSync(path.join(DIR, f), "utf8"),
}));

const body = `/**
 * GENERATED FILE - DO NOT EDIT BY HAND.
 * Source of truth: supabase/migrations/*.sql + scripts/migration-markers.mjs.
 * Regenerate with: node scripts/gen-db-migrations.mjs
 * (the offline test suite fails if this file drifts from the sources).
 *
 * SERVER-SIDE ONLY: imported exclusively by src/lib/db-bootstrap.ts for
 * the first-launch setup wizard. Never import from a client component.
 */
export interface MigrationEntry {
  name: string;
  /** SQL whose truth proves this migration is already applied. */
  marker: string | null;
  sql: string;
}

export const MIGRATIONS: MigrationEntry[] = ${JSON.stringify(entries, null, 2)};
`;

writeFileSync(OUT, body);
console.log(`generated ${OUT}: ${entries.length} migrations embedded (markers on ${entries.filter((e) => e.marker).length})`);
