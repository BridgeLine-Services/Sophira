/**
 * GITHUB INSTALL CONTRACT (2026-10-06): GitHub is the source of truth for
 * obtaining and running Sophira. npm run setup / setup:ai / verify must
 * exist, be safe, honest about CLOUD vs LOCAL AI, and never leak values.
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";

export function runGitHubInstallTests(assert: (c: boolean, n: string) => void, section: (t: string) => void): void {
  section("GitHub install: clone → setup → run, first-class");

  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert(pkg.scripts.setup === "node scripts/setup.mjs", "install: npm run setup exists");
  assert(pkg.scripts["setup:ai"] === "node scripts/setup-ai.mjs", "install: npm run setup:ai exists");
  assert(pkg.scripts.verify === "node scripts/verify.mjs", "install: npm run verify exists");

  const setup = readFileSync("scripts/setup.mjs", "utf8");
  assert(setup.includes("NEVER overwrite") || setup.includes("never overwrite"),
    "install: setup documents the never-overwrite .env.local contract");
  assert(setup.includes("--self-test"), "install: setup has a self-test");
  assert(!setup.match(/sk-[A-Za-z0-9]{10,}/), "install: setup contains no secret-shaped values");

  const setupAi = readFileSync("scripts/setup-ai.mjs", "utf8");
  assert(setupAi.includes("CLOUD") && setupAi.includes("LOCAL"),
    "install: setup:ai explicitly distinguishes CLOUD vs LOCAL AI");
  assert(setupAi.includes("NOT downloadable from GitHub") || setupAi.includes("NOT packaged"),
    "install: setup:ai never claims cloud models are downloadable from GitHub");
  assert(setupAi.includes("ALLOW_PAID_AI") && setupAi.includes("never enables paid AI") || setupAi.includes("DISABLED by default"),
    "install: setup:ai keeps paid AI disabled by default");
  assert(!setupAi.match(/sk-[A-Za-z0-9]{10,}/), "install: setup:ai contains no secret-shaped values");

  const verify = readFileSync("scripts/verify.mjs", "utf8");
  for (const part of ["gen-env-example.mjs", "verify-deployment.mjs --env-only", "native-url.mjs", "secret-scan.mjs", "next build"]) {
    assert(verify.includes(part), `install: verify checks ${part}`);
  }
  assert(verify.includes("--fast"), "install: verify supports a fast mode without the build");

  // Self-tests actually pass (exec, offline, no values printed)
  const runSelf = (f: string): boolean => {
    try { execSync(`node scripts/${f} --self-test`, { encoding: "utf8", stdio: "pipe" }); return true; } catch { return false; }
  };
  assert(runSelf("setup.mjs"), "install: setup.mjs self-test passes (incl. never-overwrite and value-leak rules)");
  assert(runSelf("setup-ai.mjs"), "install: setup-ai.mjs self-test passes (mode set, safeguards untouched, no value leaks)");

  // README GitHub workflow
  const readme = readFileSync("README.md", "utf8");
  assert(readme.includes("Download ZIP") && readme.includes("git clone https://github.com/BridgeLine-Services/Sophira.git"),
    "install: README explains both ZIP download and git clone");
  assert(readme.includes("npm run setup") && readme.includes("npm run setup:ai") && readme.includes("npm run verify"),
    "install: README uses the real setup/verify commands");
  assert(readme.includes("npm run dev") && readme.includes("localhost:3000"),
    "install: README explains how to start Sophira locally");
  assert(readme.includes("not* inside it") || readme.includes("*not* inside it") || readme.includes("are *not* inside"),
    "install: README honestly states cloud models are not in the repository");
  assert(readme.includes("LOCAL AI") && readme.includes("CLOUD AI"),
    "install: README explains local vs cloud AI");
  assert(readme.includes("Capacitor shell loads the DEPLOYED web app"),
    "install: README explains the mobile shell architecture (GitHub → Next.js → Vercel → Capacitor)");
  assert(readme.includes("NO secrets"),
    "install: README states the mobile shell contains no secrets");

  // Troubleshooting doc covers the mandated topics
  const tr = readFileSync("docs/TROUBLESHOOTING.md", "utf8");
  for (const topic of [
    "Missing `.env.local`", "Missing Gemini API key", "Invalid Supabase configuration",
    "Failed AI requests", "Vercel environment configuration", "Local AI unavailable",
    "Capacitor unable to reach deployed Sophira", "Invalid `SOPHIRA_APP_URL`",
  ]) {
    assert(tr.includes(topic), `install: troubleshooting covers "${topic}"`);
  }
  assert(!tr.match(/sk-[A-Za-z0-9]{10,}/) && !/[a-f0-9]{40,}/i.test(tr),
    "install: troubleshooting contains no secret-shaped values");
}
