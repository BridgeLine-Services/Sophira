#!/usr/bin/env node
/**
 * CLI for the offline academic evaluation corpus (Prompt 2).
 *
 *   node scripts/run-ai-evals.mjs             all cases
 *   node scripts/run-ai-evals.mjs --boundary  information-scope cases only
 *
 * Exit codes: 0 = all deterministic cases pass, 1 = failures, 3 = not compiled.
 * Live-model cases are SKIPPED here and are never counted as passes.
 */
import { existsSync } from "node:fs";

const target = new URL("../tests-dist/tests/ai-evals/runner.js", import.meta.url);
if (!existsSync(target)) {
  console.error("eval suite is not compiled (run `npm test` once, which builds tests-dist)");
  process.exit(3);
}
const mod = await import(target.href);
const boundaryOnly = process.argv.includes("--boundary");
const all = mod.runOfflineEvals();
const results = boundaryOnly ? all.filter((r) => /^(GOV|SRC)-/.test(r.id)) : all;
const failed = results.filter((r) => r.status === "fail");
const skipped = results.filter((r) => r.status === "skipped");
console.log(`evals: ${results.length} case(s), ${results.length - failed.length - skipped.length} deterministic pass, ${skipped.length} skipped (live), ${failed.length} failed`);
for (const f of failed) console.error(`  FAIL ${f.id}: ${f.detail}`);
process.exit(failed.length === 0 ? 0 : 1);
