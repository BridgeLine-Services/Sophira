#!/usr/bin/env node
import { readFileSync, existsSync, statSync } from "fs";
import { execSync } from "child_process";

let pass = 0, fail = 0;
const ok = (c, name) => { if (c) { pass++; console.log("  PASS  " + name); } else { fail++; console.log("  FAIL  " + name); } };

console.log("Sophira local-first test\n");

const [major] = process.versions.node.split(".").map(Number);
ok(major >= 20, "Node.js >= 20 (found " + process.versions.node + ")");
ok(existsSync("node_modules/next") && existsSync("node_modules/@supabase/ssr"), "dependencies installed (npm install / npm ci)");

for (const f of ["src/lib/offline/local-engine.ts", "src/lib/offline/model-manager.ts", "src/lib/offline/model-registry.ts", "src/lib/offline/offline-tasks.ts", "src/lib/ai/offline-guard.ts", "src/app/offline/page.tsx", "src/app/local/page.tsx"]) {
  ok(existsSync(f) && statSync(f).size > 100, "exists: " + f);
}

const reg = readFileSync("src/lib/offline/model-registry.ts", "utf8");
ok(reg.includes("smollm2-135m-instruct") && reg.includes("smollm2-360m-instruct"), "tiered model registry lists real local models");

const mw = readFileSync("src/middleware.ts", "utf8");
ok(mw.includes('SOPHIRA_LOCAL_FIRST === "true"') && mw.includes('NODE_ENV !== "production"'), "local-first mode is explicit AND production-impossible");
ok(existsSync("docs/QUICK_START_LOCAL.md"), "QUICK_START_LOCAL.md exists");
ok(readFileSync("docs/QUICK_START_LOCAL.md", "utf8").includes("SOPHIRA_LOCAL_FIRST=true"), "local-first activation is documented");

try {
  execSync("npx tsc --noEmit -p tsconfig.json", { stdio: "pipe" });
  ok(true, "TypeScript type check passes");
} catch {
  ok(false, "TypeScript type check passes");
}

console.log("\nRESULT: " + (fail === 0 ? "PASS" : "FAIL") + " — " + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
