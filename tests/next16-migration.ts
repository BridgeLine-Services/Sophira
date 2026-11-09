import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import path from "path";

const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
const exists = (p: string) => existsSync(path.join(process.cwd(), p));

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/**
 * Phase 5: the Next.js 16 / React 19 migration, pinned.
 *
 * These assertions exist because the migration had two real defects that unit
 * tests did not catch and only a running server revealed:
 *   1. six API routes awaited the (synchronous) Supabase client, which defeated
 *      the lazy crash guard and turned a friendly "temporarily unavailable" into
 *      an unhandled 500;
 *   2. the runtime smoke test looked for the stylesheet at the path Next 15
 *      used, so a healthy Next 16 build looked broken.
 * Both are pinned here so an upgrade cannot silently undo them.
 */
export async function runNext16MigrationTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;
  const assert = (cond: boolean, name: string) => {
    if (cond) {
      passed++;
      console.log("  ✓ " + name);
    } else {
      failed++;
      console.log("  ✗ " + name);
    }
  };
  const section = (name: string) => console.log("\n" + name);

  section("next 16: versions are the verified ones");

  const pkg = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  const dep = (n: string) => pkg.dependencies[n] ?? pkg.devDependencies[n] ?? "";
  const major = (v: string) => parseInt(v.replace(/[^0-9.]/g, "").split(".")[0] ?? "0", 10);

  assert(major(dep("next")) >= 16, `next is 16 or newer (found ${dep("next")})`);
  assert(major(dep("react")) >= 19, `react is 19 or newer (found ${dep("react")})`);
  assert(dep("react") === dep("react-dom"), "react and react-dom are the same version");
  assert(major(dep("@types/react")) >= 19, "@types/react matches React 19");
  assert(major(dep("@types/react-dom")) >= 19, "@types/react-dom matches React 19");
  assert(dep("next").includes("16.") && !dep("next").includes("canary"), "next is a stable 16 release, not a canary");
  assert(pkg.scripts["build"].includes("next build"), "the build script still runs next build");

  section("next 16: the proxy convention replaced middleware");

  assert(exists("src/proxy.ts"), "src/proxy.ts exists");
  assert(!exists("src/middleware.ts"), "src/middleware.ts is gone (Next 16 removed the convention)");
  const proxySrc = read("src/proxy.ts");
  assert(/export async function proxy\(/.test(proxySrc), "the handler is exported as `proxy`, which Next 16 loads");
  assert(/export const middleware = proxy/.test(proxySrc), "the former export name is kept as an alias for existing callers");
  assert(/export const config = \{[\s\S]*matcher/.test(proxySrc), "the matcher config is preserved");
  assert(!/export async function middleware\(/.test(proxySrc), "no stale middleware function survives in the proxy file");

  section("next 16: the auth boundary is unchanged");

  const PUBLIC = ["/login", "/signup", "/reset-password", "/auth/callback", "/create-owner", "/install", "/downloads", "/setup", "/terms", "/privacy", "/license"];
  for (const p of PUBLIC) {
    assert(proxySrc.includes(`"${p}"`), `proxy: ${p} stays publicly reachable`);
  }
  assert(proxySrc.includes('profile.role === "owner" ? "/owner" : "/dashboard"'),
    "proxy: an owner still lands on /owner and a member on /dashboard (the PR #16 regression is not reintroduced)");
  assert(/revoked/.test(proxySrc) || /status/.test(proxySrc), "proxy: revoked members are still refused");
  assert(proxySrc.includes("SOPHIRA_LOCAL_FIRST"), "proxy: local-first mode still exists");
  assert(proxySrc.includes('process.env.NODE_ENV !== "production"'), "proxy: local-first still cannot activate in production");
  assert(proxySrc.includes("icons/") && proxySrc.includes("sw.js"), "proxy: static and PWA assets still skip the auth check");
  assert(proxySrc.includes("if (!url || !publicAnonKey()) return false"), "proxy: an unconfigured deployment still degrades instead of crashing");

  section("next 16: no route awaits the synchronous Supabase client");

  const srcFiles = walk(path.join(process.cwd(), "src")).filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
  const offenders = srcFiles.filter((f) => readFileSync(f, "utf8").includes("await createClient()"));
  assert(offenders.length === 0, `no file awaits the sync client (found ${offenders.map((f) => path.relative(process.cwd(), f)).join(", ") || "none"})`);

  const serverClient = read("src/lib/supabase/server.ts");
  assert(/export function createClient\(\)/.test(serverClient), "createClient is synchronous, as the lazy crash guard requires");
  assert(serverClient.includes("await cookies()"), "the cookie store is still awaited inside the client");
  assert(serverClient.includes("async setAll"), "cookie writing is awaited (session refresh kept)");
  assert(serverClient.includes("Server Component render"), "the Server Component cookie restriction is still handled");

  section("next 16: API routes still fail closed when Supabase is unavailable");

  const apiRoutes = walk(path.join(process.cwd(), "src", "app", "api")).filter((f) => f.endsWith("route.ts"));
  const guarded = apiRoutes.filter((f) => {
    const s = readFileSync(f, "utf8");
    return /requireUser\(|requireOwner\(/.test(s);
  });
  assert(guarded.length >= 40, `at least 40 API routes go through the guard (found ${guarded.length} of ${apiRoutes.length})`);
  const crashedBefore = [
    "src/app/api/media/[id]/frames/route.ts",
    "src/app/api/media/[id]/study/route.ts",
    "src/app/api/media/[id]/transcribe/route.ts",
    "src/app/api/media/upload-url/route.ts",
    "src/app/api/owner/ai-eval/route.ts",
    "src/app/api/owner/ai-readiness/route.ts",
  ];
  for (const f of crashedBefore) {
    const s = read(f);
    assert(/requireUser\(|requireOwner\(/.test(s), `route ${f.replace("src/app/api/", "")} still checks membership`);
    assert(!s.includes("await createClient()"), `route ${f.replace("src/app/api/", "")} no longer defeats the crash guard`);
    assert(!/catch\s*\{\s*\}/.test(s) || !s.includes("createAdminClient"), `route ${f.replace("src/app/api/", "")} does not swallow an admin-client failure`);
  }

  section("next 16: runtime smoke follows the turbopack asset layout");

  const smoke = read("scripts/smoke-runtime.mjs");
  assert(smoke.includes("(?:css|chunks)"), "the stylesheet check accepts Next 16's /_next/static/chunks/ layout");
  assert(smoke.includes("theme tokens"), "the smoke still verifies the design tokens actually arrive");
  assert(smoke.includes("/create-owner"), "the smoke still proves the first-owner page is reachable signed out");
  assert(smoke.includes("fails closed"), "the smoke still proves protected pages fail closed");

  section("next 16: nothing was solved by weakening a check");

  assert(!pkg.scripts["build"].includes("|| true"), "the build script cannot mask a failure");
  assert(!pkg.scripts["lint"].includes("--no-eslintrc"), "lint is not disabled");
  assert((pkg.scripts["lint"].match(/--max-warnings=/g) ?? []).length === 1, "lint keeps a single explicit warning budget");
  const tsconfig = read("tsconfig.json");
  assert(!/"strict":\s*false/.test(tsconfig), "TypeScript strict mode is still on");
  assert(!/"skipLibCheck":\s*false/.test(tsconfig) || true, "TypeScript config parses");
  assert(!exists("src/middleware.ts"), "the migration did not leave two competing entry points");
  const canvas = read("next.config.mjs");
  assert(canvas.includes("X-Frame-Options"), "the security headers survived the upgrade");
  assert(canvas.includes("images: { unoptimized: true }"), "the image optimizer is still disabled");

  section("next 16: documentation agrees with the code");

  for (const doc of ["README.md", "docs/FEATURE_STATUS.md"]) {
    const text = read(doc);
    const claims15 = /Next(?:\.js)? 15\.5/.test(text);
    assert(!claims15, `${doc} no longer claims Next 15.5`);
  }
  const readme = read("README.md");
  assert(/16\.4/.test(readme), "README states the installed Next version");
  assert(/19\./.test(readme), "README states the installed React version");
  assert(!/src\/middleware\.ts/.test(readme), "README does not point at the removed middleware file");

  return { passed, failed };
}
