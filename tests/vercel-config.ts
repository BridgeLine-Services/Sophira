/**
 * VERCEL DEPLOYMENT SHAPE (2026-10-06): the repository root is a single
 * Next.js Vercel application; src-tauri remains the desktop app and is
 * never deployed as a Vercel web service.
 */
import { readFileSync, existsSync } from "fs";
import { execSync as _exec } from "child_process";
const execSync2 = (cmd: string): string[] => _exec(cmd, { encoding: "utf8" }).split("\n").filter(Boolean);

export function runVercelConfigTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("Vercel: single Next.js service, Tauri desktop app untouched");

  const vc = JSON.parse(readFileSync("vercel.json", "utf8"));

  // The root is pinned as Next.js
  assert(vc.framework === "nextjs", "vercel: the root is pinned to the Next.js framework");

  // NO multi-service configuration, NO Rust service, NO rewrites
  assert(!("services" in vc), "vercel: no multi-service configuration (src-tauri is NOT a Vercel service)");
  assert(!("rewrites" in vc), "vercel: no rewrites (the Next.js app serves all routes)");
  assert(JSON.stringify(vc).indexOf("src-tauri") === -1 && JSON.stringify(vc).indexOf("rust") === -1,
    "vercel: no Rust runtime or src-tauri reference in the deployment config");

  // Web build never depends on Tauri
  const nextConfig = readFileSync("next.config.mjs", "utf8");
  assert(!nextConfig.includes("src-tauri") && !nextConfig.includes("tauri"),
    "vercel: the Next.js build configuration has no Tauri dependency (web build needs no Rust)");

  // Desktop app remains intact and independent of Vercel
  assert(existsSync("src-tauri/tauri.conf.json") && existsSync("src-tauri/Cargo.toml"),
    "tauri: the desktop project keeps its required files in the repository");
  const tauriConf = readFileSync("src-tauri/tauri.conf.json", "utf8");
  assert(tauriConf.includes("com.bridgeline.sophira"), "tauri: the desktop identifier is unchanged");
  assert(!tauriConf.includes("vercel"), "tauri: the desktop app has no Vercel dependency");

  // Nothing in the web source imports the desktop code
  const importers: string[] = [];
  const walk = (dir: string): void => {
    for (const e of require("fs").readdirSync(dir, { withFileTypes: true })) {
      const p = dir + "/" + e.name;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        if (readFileSync(p, "utf8").includes("src-tauri")) importers.push(p);
      }
    }
  };
  walk("src");
  assert(importers.length === 0, "vercel: no web source file imports src-tauri (web and desktop fully separated)");

  // No nested deployment configuration anywhere in the tracked tree
  const { execSync } = require("child_process");
  const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
  const nestedVercel = tracked.filter((f: string) => f.endsWith("vercel.json") && f !== "vercel.json");
  assert(nestedVercel.length === 0, "vercel: no nested vercel.json exists anywhere (only the root config)");
  const nestedPkg = tracked.filter((f: string) => f.endsWith("package.json") && f !== "package.json");
  assert(nestedPkg.length === 0, "vercel: no nested package.json exists anywhere (no monorepo apps; src-tauri uses Cargo.toml, not npm)");
  assert(!tracked.includes("pnpm-workspace.yaml") && !tracked.includes("lerna.json") && !tracked.includes("turbo.json"),
    "vercel: no workspace/monorepo tooling configuration exists");
  const vci = readFileSync(".vercelignore", "utf8");
  assert(vci.includes("src-tauri"), "vercel: .vercelignore keeps the desktop project out of Vercel deployment files entirely");
  assert(existsSync("android/capacitor.config.ts") || existsSync("capacitor.config.ts"),
    "native: the Capacitor mobile shell configuration remains in the repository");

  // SERVICE-TO-SERVICE AUDIT (2026-10-06): Sophira is ONE web application.
  // No backend service exists; the browser never calls a second server and
  // no server-side code calls another service - so NO Vercel service
  // bindings are needed (bindings would only be used from server-side code
  // of the calling service, and there is no caller).
  const srcFiles: string[] = execSync2("git ls-files 'src/**/*.ts' 'src/**/*.tsx'");
  const allSrc = srcFiles.map((f: string) => [f, readFileSync(f, "utf8")] as const);
  assert(!allSrc.some(([, c]) => c.includes("axios")), "audit: no axios client anywhere (no second backend to call)");
  assert(!allSrc.some(([, c]) => c.includes("BACKEND_URL") || c.includes("API_BASE_URL") || c.includes("SERVICE_URL")),
    "audit: no BACKEND_URL/API_BASE_URL/SERVICE_URL - no service-to-service dependency exists");
  assert(!("bindings" in vc), "audit: no Vercel service bindings (nothing to bind - one application only)");
  const localhostHits = allSrc.filter(([, c]) => /(^|[^.A-Za-z])localhost(:|\/|$|\b)/.test(c))
    .filter(([f, c]) => !(f.includes("native-url") && c.includes("a release build cannot point at localhost"))
      && !(f.includes("ServiceWorkerRegister") && c.includes("window.location.hostname")));
  assert(localhostHits.length === 0,
    "audit: no reachable hard-coded localhost URLs in web source (the only matches are the release guard that REJECTS localhost and the dev-only service-worker registration)");
  assert(!execSync2("git ls-files").some((f: string) => f.startsWith("Dockerfile") || f.startsWith("docker-compose")),
    "audit: no Dockerfiles or docker-compose (no container service discovery)");

  // The environment variable catalog covers every variable the code reads
  const envDoc = readFileSync("docs/ENVIRONMENT_VARIABLES.md", "utf8");
  const srcEnvNames = new Set<string>();
  for (const f of srcFiles) srcEnvNames.add(f);
  const allEnv = new Set<string>();
  const addEnv = (code: string): void => { for (const m of Array.from(code.matchAll(/process\.env\.([A-Z_0-9]+)/g))) allEnv.add(m[1]); };
  for (const [f, c] of allSrc) addEnv(c);
  addEnv(readFileSync("src/middleware.ts", "utf8"));
  const undocumented = Array.from(allEnv).filter((n) => n !== "NODE_ENV" && !envDoc.includes(n));
  assert(undocumented.length === 0, "audit: every environment variable the code reads is documented in docs/ENVIRONMENT_VARIABLES.md (missing: " + undocumented.join(", ") + ")");
  assert(envDoc.includes("NEXT_PUBLIC_") && envDoc.includes("SUPABASE_SERVICE_ROLE_KEY") && envDoc.includes("Server-only"),
    "audit: the variable guide separates PUBLIC, SERVER-ONLY, and THIRD-PARTY variables");
  assert(!envDoc.includes("sk-") && !/[a-f0-9]{32,}/i.test(envDoc), "audit: the variable guide contains no secret VALUES");

  // package manager stays npm; build command is the existing one
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts.build === "next build", "vercel: the deployment uses the existing production build script (next build)");
  assert(!pkg.scripts.build.includes("cargo") && !pkg.scripts.build.includes("tauri"),
    "vercel: the web build command never compiles Rust");
}
