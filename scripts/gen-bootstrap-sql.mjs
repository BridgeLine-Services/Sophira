#!/usr/bin/env node
/**
 * Regenerates supabase/bootstrap-all.sql from supabase/migrations/*.sql.
 * The single-paste file must NEVER drift behind the migration chain: a
 * stale copy (it once stopped at 0026) silently creates an incomplete
 * database for a fresh installation. Run: npm run db:bootstrap-sql
 */
import { readFileSync, writeFileSync, readdirSync } from "fs";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const header = `-- SOPHIRA COMPLETE DATABASE SETUP (regenerated ${new Date().toISOString().slice(0, 10)})
-- Applies every migration in order (${files[0]} ... ${files[files.length - 1]}).
-- Run this SINGLE file once in the Supabase SQL editor for a fresh
-- installation. Every migration is additive and idempotent (IF NOT EXISTS /
-- guarded DO blocks), so re-running is safe. After it succeeds, open
-- https://sophira.vercel.app/create-owner and create the owner account.
-- Regenerate with: npm run db:bootstrap-sql
`;
const body = files.map((f) => `\n-- ===================== ${f} =====================\n` + readFileSync(`${dir}/${f}`, "utf8")).join("");
writeFileSync("supabase/bootstrap-all.sql", header + body);
console.log(`bootstrap-all.sql: wrote ${files.length} migrations (${files[0]} .. ${files[files.length - 1]})`);
