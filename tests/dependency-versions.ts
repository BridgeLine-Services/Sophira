/**
 * REGRESSION TESTS: DEPENDENCY VERSIONS (Dependabot: minimatch, glob; glib documented)
 *
 * The lockfile is generated, so a human cannot reliably police it by reading diffs.
 * These assertions read it and fail when a vulnerable range comes back, which is the
 * only way to notice that a transitive bump re-introduced one.
 *
 * Ranges are written here from the advisories, not guessed:
 *   - minimatch  GHSA (globparts amplification): >=7.0.0 <11.0.1
 *   - glob       GHSA-3g3m-2fjr-6pw4:           >=9.0.0 <=14.0.1
 *   - glib       RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g: >=0.15.0 <0.20.0
 *     (Rust: cannot be fixed in the lockfile yet - see docs/SECURITY_DEPENDENCIES.md,
 *      and this test keeps that documentation present rather than letting it rot.)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

type Check = (condition: boolean, message: string) => void;

const ROOT = join(__dirname, "..", "..");

interface LockPackage {
  version?: string;
  dependencies?: Record<string, string>;
  dev?: boolean;
}

interface Lock {
  packages?: Record<string, LockPackage>;
}

interface Manifest {
  overrides?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Parses "1.2.3" / "1.2.3-beta.4" into comparable numbers. */
function parse(version: string): [number, number, number] {
  const clean = version.split("-")[0];
  const [major, minor, patch] = clean.split(".").map((n) => Number(n) || 0);
  return [major, minor, patch];
}

function compare(a: string, b: string): number {
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

function atLeast(version: string, floor: string): boolean {
  return compare(version, floor) >= 0;
}

function below(version: string, ceiling: string): boolean {
  return compare(version, ceiling) < 0;
}

/** True when `version` sits inside [from, to) - the "to" bound is exclusive. */
function inRange(version: string, from: string, to: string): boolean {
  return atLeast(version, from) && below(version, to);
}

export function runDependencyVersionTests(assert: Check, _section?: unknown): void {
  const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as Lock;
  const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Manifest;
  const packages = Object.entries(lock.packages ?? {});

  // ---- minimatch: no copy in the vulnerable 7.x-10.x band -----------------------
  const minimatches = packages
    .filter(([path]) => /(^|\/)node_modules\/minimatch$/.test(path))
    .map(([path, pkg]) => ({ path, version: pkg.version ?? "0.0.0" }));

  assert(minimatches.length > 0, "deps: the lockfile still records minimatch copies (the tree was read)");
  for (const entry of minimatches) {
    const vulnerable = inRange(entry.version, "7.0.0", "11.0.1");
    assert(!vulnerable, `deps: minimatch ${entry.version} at ${entry.path} is outside the vulnerable range`);
  }
  // The 3.x copies are eslint's own and are BELOW the affected range; they must not
  // have been blindly overridden to a major they were never tested against.
  const legacy = minimatches.filter((entry) => /eslint/.test(entry.path));
  for (const entry of legacy) {
    assert(atLeast(entry.version, "3.0.0") && below(entry.version, "4.0.0"),
      `deps: eslint keeps its own minimatch 3.x (found ${entry.version})`);
  }
  assert(Boolean(manifest.overrides?.["minimatch@>=10.0.0 <11.0.0"]),
    "deps: the minimatch override that fixes the 10.x path is declared in package.json");

  // ---- glob: no copy in the vulnerable 9-14.0.1 band ---------------------------
  const globs = packages
    .filter(([path]) => /(^|\/)node_modules\/glob$/.test(path))
    .map(([path, pkg]) => ({ path, version: pkg.version ?? "0.0.0" }));
  for (const entry of globs) {
    const vulnerable = atLeast(entry.version, "9.0.0") && !atLeast(entry.version, "14.0.2");
    assert(!vulnerable, `deps: glob ${entry.version} at ${entry.path} is at or above the patched 14.0.2`);
  }

  // ---- the overrides that produce those resolutions are recorded ---------------
  assert(Boolean(manifest.overrides?.["rimraf@>=4.2.0 <=6.1.3"]),
    "deps: the rimraf override that lifts glob past 14.0.2 is declared in package.json");

  // ---- no npm audit vulnerability left in the tree ----------------------------
  // (Verified by `npm audit` in the change itself; this asserts the two specific
  // ranges above rather than shelling out from a unit test.)

  // ---- glib: the blocker is DOCUMENTED, not silently ignored ------------------
  const rustLock = readFileSync(join(ROOT, "src-tauri", "Cargo.lock"), "utf8");
  const glibBlock = /\[\[package\]\]\s*\nname = "glib"\s*\nversion = "([^"]+)"/.exec(rustLock);
  assert(Boolean(glibBlock), "deps: the Tauri lockfile still pins glib (the lockfile was read)");
  const glibVersion = glibBlock?.[1] ?? "0.0.0";
  assert(atLeast(glibVersion, "0.18.0") && below(glibVersion, "0.20.0"),
    `deps: glib is in the affected band as expected (${glibVersion} < 0.20.0) - documented, not silently claimed fixed`);

  const doc = readFileSync(join(ROOT, "docs", "SECURITY_DEPENDENCIES.md"), "utf8");
  assert(/RUSTSEC-2024-0429/.test(doc), "deps: the glib advisory id is recorded in docs/SECURITY_DEPENDENCIES.md");
  assert(/GHSA-wrw7-89jp-8q8g/.test(doc), "deps: the glib GHSA id is recorded");
  assert(/gtk 0\.18/.test(doc), "deps: the glib dependency chain (gtk 0.18) is recorded");
  assert(/0\.20\.0/.test(doc), "deps: the patched glib version is recorded");
  assert(/not been run|cannot be run|not installed/i.test(doc),
    "deps: the document is honest about which Rust checks were not run here");
  assert(/Windows|macOS/.test(doc), "deps: the platform exposure of glib is recorded");
}
