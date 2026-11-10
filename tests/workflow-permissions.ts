/**
 * REGRESSION TESTS: WORKFLOW PERMISSIONS (CodeQL #1-#8)
 *
 * A workflow with no `permissions:` block gets the repository default, which for
 * older repositories is write access to contents. Any compromised step then inherits
 * the ability to push, tag and publish releases. These tests pin the intended shape:
 *
 *   - every workflow declares explicit permissions, read-only at the top level;
 *   - ONLY the release job may write contents, because it creates the Release;
 *   - the release pipeline still uploads/downloads artifacts and publishes.
 *
 * Deliberately a line scan rather than a YAML dependency: the shapes asserted here
 * (a top-level block, a job-level override, no stray write) are visible in the text,
 * and a parser failure cannot silently pass these checks.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Check = (condition: boolean, message: string) => void;

const WORKFLOWS = join(__dirname, "..", "..", ".github", "workflows");

/** `permissions:` blocks in a workflow: one per scope ("workflow" or a job name). */
function permissionsBlocks(text: string): Record<string, Record<string, string>> {
  const lines = text.split("\n");
  const blocks: Record<string, Record<string, string>> = {};
  let job = "workflow";
  let inJobs = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^jobs:\s*$/.test(line)) {
      inJobs = true;
      continue;
    }
    if (inJobs) {
      const jobMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
      if (jobMatch) {
        job = jobMatch[1];
        continue;
      }
    }
    if (/^\s*permissions:\s*$/.test(line)) {
      const scope = line.length - line.trimStart().length === 0 ? "workflow" : job;
      const indent = line.length - line.trimStart().length;
      const block: Record<string, string> = {};
      for (let j = i + 1; j < lines.length; j++) {
        const inner = lines[j];
        if (!inner.trim()) continue;
        const innerIndent = inner.length - inner.trimStart().length;
        if (innerIndent <= indent) break;
        const entry = /^([a-z-]+):\s*(\S+)\s*$/.exec(inner.trim());
        if (entry) block[entry[1]] = entry[2];
      }
      blocks[scope] = block;
    }
  }
  return blocks;
}

export function runWorkflowPermissionTests(assert: Check, _section?: unknown): void {
  const files = readdirSync(WORKFLOWS).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  assert(files.length >= 3, `workflows: found the workflow files to check (${files.length})`);

  for (const file of files) {
    const text = readFileSync(join(WORKFLOWS, file), "utf8");
    const blocks = permissionsBlocks(text);

    assert(Boolean(blocks.workflow), `workflows: ${file} declares permissions at the workflow level`);
    const top = blocks.workflow ?? {};
    assert(top.contents === "read", `workflows: ${file} grants contents: read by default`);

    // No blanket write anywhere: not at the top, and job-level overrides must be
    // listed explicitly rather than handed to everything.
    const writeScopes = Object.entries(blocks)
      .filter(([, block]) => block.contents === "write")
      .map(([scope]) => scope);

    if (file === "release.yml") {
      assert(writeScopes.length === 1 && writeScopes[0] === "release",
        `workflows: release.yml grants contents: write to the release job only (got: ${writeScopes.join(",") || "none"})`);
      assert(top.contents !== "write", "workflows: release.yml does not grant top-level write");
      // The release pipeline must keep working: artifacts are uploaded per platform
      // and downloaded by the release job, then published.
      assert(/actions\/upload-artifact/.test(text), "workflows: release.yml still uploads platform artifacts");
      assert(/actions\/download-artifact/.test(text), "workflows: release.yml still downloads artifacts for the release");
      assert(/action-gh-release/.test(text), "workflows: release.yml still publishes the GitHub Release");
      assert(/checksums|SHA256/i.test(text), "workflows: release.yml still produces checksums");
    } else {
      assert(writeScopes.length === 0, `workflows: ${file} grants no write access (got: ${writeScopes.join(",") || "none"})`);
    }

    // Ordinary build/test workflows must not be able to change repository contents.
    if (file === "ci.yml" || file === "migrations.yml") {
      assert(text.includes("runs-on: ubuntu-latest"), `workflows: ${file} still defines runnable jobs`);
      assert(!/git push|gh release create/.test(text), `workflows: ${file} never pushes or publishes`);
    }
  }

  // The migration workflow keeps its self-test, which is what proves the chain is
  // applicable before any database is touched.
  const migrations = readFileSync(join(WORKFLOWS, "migrations.yml"), "utf8");
  assert(/self-test/.test(migrations), "workflows: migrations.yml keeps its self-test step");

  // CI keeps running the full verification suite, not a reduced one.
  const ci = readFileSync(join(WORKFLOWS, "ci.yml"), "utf8");
  assert(/npm test|npm run test/.test(ci), "workflows: ci.yml still runs the test suite");
  assert(/npm run build/.test(ci), "workflows: ci.yml still runs the production build");
}
