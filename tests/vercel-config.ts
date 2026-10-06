/**
 * VERCEL DEPLOYMENT SHAPE (2026-10-06): the repository root is a single
 * Next.js Vercel application; src-tauri remains the desktop app and is
 * never deployed as a Vercel web service.
 */
import { readFileSync, existsSync } from "fs";

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

  // package manager stays npm; build command is the existing one
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts.build === "next build", "vercel: the deployment uses the existing production build script (next build)");
  assert(!pkg.scripts.build.includes("cargo") && !pkg.scripts.build.includes("tauri"),
    "vercel: the web build command never compiles Rust");
}
