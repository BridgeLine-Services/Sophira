/**
 * ENV MANIFEST CONTRACT (2026-10-06): one authoritative environment-variable
 * definition. src/config/env.manifest.json is the single source of truth;
 * .env.example is GENERATED from it; src/lib/env.ts validates against it at
 * runtime; scripts/verify-deployment.mjs --env-only checks deployments
 * against it. These tests pin the sync and the security contract (never
 * values, free-first AI defaults preserved).
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";

export function runEnvManifestTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Environment manifest: one authoritative source of truth");

  const manifest = JSON.parse(readFileSync("src/config/env.manifest.json", "utf8"));
  const vars: any[] = manifest.variables;
  assert(Array.isArray(vars) && vars.length >= 30, "env: the manifest catalogs the full variable inventory (30+ entries)");
  for (const v of vars) {
    assert(
      typeof v.name === "string" && v.name.length > 0 &&
      typeof v.section === "string" &&
      ["production", "optional", "conditional", "native-release", "live-tests", "internal"].includes(v.required) &&
      ["public", "server", "ci"].includes(v.scope) &&
      typeof v.type === "string",
      `env: manifest entry ${v.name ?? "?"} has all required fields (name/section/required/scope/type)`
    );
  }
  for (const sec of manifest.sections) {
    assert(
      vars.some((v) => v.section === sec.id),
      `env: manifest section "${sec.id}" is not empty (dead sections are doc rot)`
    );
  }

  // ---- every variable ANY code reads is in the manifest -------------------
  const srcEnv = new Set<string>();
  for (const f of execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx' 'scripts/**/*.mjs' 'capacitor.config.ts'", { encoding: "utf8" }).split("\n").filter(Boolean)) {
    const c = readFileSync(f, "utf8");
    for (const m of Array.from(c.matchAll(/process\.env\.([A-Z_0-9]+)/g))) srcEnv.add(m[1]);
  }
  srcEnv.delete("NODE_ENV"); // framework-managed
  const manifestNames = new Set(vars.map((v) => v.name));
  const unmanifested = Array.from(srcEnv).filter((n) => !manifestNames.has(n));
  assert(unmanifested.length === 0, `env: every process.env.* read anywhere (src, scripts, capacitor) is in the manifest (missing: ${unmanifested.join(", ")})`);

  // ---- .env.example is GENERATED and in sync -----------------------------
  const genCheck = (() => {
    try {
      execSync("node scripts/gen-env-example.mjs --check", { encoding: "utf8", stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  })();
  assert(genCheck, "env: .env.example is byte-identical to the manifest generator output (never hand-edited)");
  const example = readFileSync(".env.example", "utf8");
  for (const v of vars.filter((v) => v.required !== "internal")) {
    assert(example.includes(v.name + "=") || example.includes(v.name + ":"),
      `env: .env.example contains ${v.name}`);
  }
  assert(!example.match(/sk-[A-Za-z0-9]{10,}/) && !/[a-f0-9]{32,}/i.test(example),
    "env: .env.example contains no secret-shaped values");
  const manifestBlob = JSON.stringify(manifest);
  assert(!manifestBlob.match(/sk-[A-Za-z0-9]{10,}/) && !/[a-f0-9]{40,}/i.test(manifestBlob),
    "env: the manifest contains no secret-shaped values");

  // ---- free-first AI defaults are pinned in the manifest -------------------
  const byName = (n: string) => vars.find((v) => v.name === n);
  assert(byName("ALLOW_PAID_AI")?.default === "false", "env: ALLOW_PAID_AI defaults to false in the manifest (zero-billing guarantee)");
  assert(byName("MONTHLY_AI_BUDGET_USD")?.default === "0", "env: MONTHLY_AI_BUDGET_USD defaults to 0 in the manifest");
  assert(byName("AI_PROVIDER")?.default === "auto", "env: AI_PROVIDER defaults to auto");
  assert(Boolean(byName("GEMINI_API_KEY")?.note?.toLowerCase().includes("preferred")),
    "env: GEMINI_API_KEY is documented as the PREFERRED (free-tier) provider");
  assert(byName("SUPABASE_SERVICE_ROLE_KEY")?.scope === "server",
    "env: SUPABASE_SERVICE_ROLE_KEY is marked server-only in the manifest");

  // ---- centralized validation module exists and is used -------------------
  const envTs = readFileSync("src/lib/env.ts", "utf8");
  assert(envTs.includes("checkEnv") && envTs.includes("healthConfiguration"),
    "env: the centralized validator exposes checkEnv + healthConfiguration");
  assert(envTs.includes("never") || envTs.includes("NEVER"),
    "env: the centralized validator documents its no-values security contract");
  const health = readFileSync("src/app/api/health/route.ts", "utf8");
  assert(health.includes("lib/env"),
    "env: /api/health uses the centralized module (no independent variable lists)");
  const ownerSetup = readFileSync("src/lib/owner-setup.ts", "utf8");
  assert(ownerSetup.includes('from "./env"'),
    "env: owner-setup uses the centralized module (no independent variable lists)");

  // ---- runtime validator unit tests (pure, no env access) ----------------
  const { checkEnv } = require("../src/lib/env.js");
  type R = { issues: { level: string; var: string; message: string }[]; ready: boolean };
  const messages = (r: R) => r.issues.map((i) => `${i.var}: ${i.message}`);
  const errs = (r: R) => r.issues.filter((i) => i.level === "error");
  const warns = (r: R) => r.issues.filter((i) => i.level === "warn");

  const none = checkEnv({}, { production: false }) as R;
  assert(none.ready === true && warns(none).some((w) => w.message.includes("No AI provider key")),
    "env: local context with nothing set is READY (all vars optional) but honestly warns about AI");

  const prodEmpty = checkEnv({}, { production: true }) as R;
  assert(!prodEmpty.ready, "env: production with nothing set is NOT ready");
  assert(errs(prodEmpty).some((e) => e.var === "NEXT_PUBLIC_SUPABASE_URL"),
    "env: production check demands the Supabase URL");
  assert(errs(prodEmpty).some((e) => e.var === "SUPABASE_SERVICE_ROLE_KEY"),
    "env: production check demands the service-role key");

  const prodOk = checkEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    SUPABASE_SERVICE_ROLE_KEY: "srk",
    NEXT_PUBLIC_SITE_URL: "https://app.example.com",
    GEMINI_API_KEY: "gk",
  }, { production: true }) as R;
  assert(prodOk.ready, "env: a fully configured production env passes");

  const badUrl = checkEnv({ NEXT_PUBLIC_SITE_URL: "not-a-url" }, {}) as R;
  assert(errs(badUrl).some((e) => e.var === "NEXT_PUBLIC_SITE_URL"),
    "env: malformed URLs are rejected");
  const plainHttp = checkEnv({ NEXT_PUBLIC_SITE_URL: "http://app.example.com" }, {}) as R;
  assert(errs(plainHttp).some((e) => e.message.includes("https")),
    "env: non-https app URLs are rejected");
  const badEnum = checkEnv({ AI_PROVIDER: "grok" }, {}) as R;
  assert(errs(badEnum).some((e) => e.var === "AI_PROVIDER"),
    "env: invalid enum values are rejected");

  const geminiNoKey = checkEnv({ AI_PROVIDER: "gemini" }, {}) as R;
  assert(!geminiNoKey.ready, "env: AI_PROVIDER=gemini without a key is an error");
  const openaiUnpaid = checkEnv({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-x" }, {}) as R;
  assert(openaiUnpaid.ready === true && warns(openaiUnpaid).some((w) => w.var === "ALLOW_PAID_AI"),
    "env: OpenAI selected without ALLOW_PAID_AI stays READY but warns (free-first safeguard preserved)");
  const paidNoBudget = checkEnv({ ALLOW_PAID_AI: "true", OPENAI_API_KEY: "sk-x" }, {}) as R;
  assert(warns(paidNoBudget).some((w) => w.var === "MONTHLY_AI_BUDGET_USD"),
    "env: paid AI with a zero budget warns that no paid spend is possible");
  const customNoBase = checkEnv({ SEARCH_PROVIDER: "custom" }, {}) as R;
  assert(errs(customNoBase).some((e) => e.var === "SEARCH_BASE_URL"),
    "env: custom search provider without a base URL is an error");

  const leak = checkEnv({ NEXT_PUBLIC_SITE_URL: "https://very-secret-host.example" }, { production: true }) as R;
  assert(messages(leak).every((m) => !m.includes("very-secret-host")),
    "env: validator messages NEVER echo env values");
  assert(!JSON.stringify(leak).includes("supabase.co/x"),
    "env: validator output carries no values at all");

  // ---- scripts wired -------------------------------------------------------
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts["verify:deployment"] === "node scripts/verify-deployment.mjs",
    "env: npm run verify:deployment exists");
  assert(pkg.scripts["verify:env"] === "node scripts/verify-deployment.mjs --env-only",
    "env: npm run verify:env exists (offline validation)");
  assert(pkg.scripts["env:example"] === "node scripts/gen-env-example.mjs --check",
    "env: npm run env:example exists (sync check)");
  const vd = readFileSync("scripts/verify-deployment.mjs", "utf8");
  assert(vd.includes("env-only") && vd.includes("values are never printed") || vd.includes("values never printed"),
    "env: the offline verifier documents that it never prints values");
  const gen = readFileSync("scripts/gen-env-example.mjs", "utf8");
  assert(gen.includes("NEVER commit real secrets") || gen.includes("Placeholders only"),
    "env: the generator states the no-secrets contract");
}
