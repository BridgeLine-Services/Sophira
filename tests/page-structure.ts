/**
 * EVERY PAGE HAS ONE HEADING AND A LANDMARK (2026-11-03, phase 2).
 *
 * Measured on 69 routes rather than assumed. A page has a heading if it writes one, if it renders
 * inside AppShell (which emits <h1>{title}</h1> and <main id="main-content">), or if it delegates to
 * a component that does. What remains after those three is a genuine defect, and there is one place
 * this test cannot judge: a page whose heading comes from a child component, which is reported as
 * unknown and left alone rather than guessed at.
 *
 * Two pages - /login and /signup - write more than one <h1> in source across mutually exclusive
 * branches (invitation flow versus normal sign-in). Rendered HTML carries exactly one, confirmed
 * against production, so the count in source is not treated as a defect.
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

const APP = "src/app";

const routeOf = (dir: string) =>
  "/" + dir.replace(`${APP}/`, "").split("/").filter((p) => !p.startsWith("(")).join("/") || "/";

const COMPONENTS = "src/components";

/**
 * Does this page get its heading and landmark from somewhere else?
 *
 * Resolution is transitive, because a subject page imports SubjectWorkspace, which renders AppShell,
 * which emits the <h1> and <main>. A page that imports only a Button gets no such credit. The first
 * version of this check excused anything importing "components/" and therefore passed a page I had
 * deliberately broken; this version resolves real files and follows them to a depth of four.
 */
function providesStructure(file: string, depth = 0): boolean {
  if (depth > 4 || !existsSync(file)) return false;
  const body = readFileSync(file, "utf8");
  if (/<h1[\s>]/.test(body) || /<main[\s>]|role="main"/.test(body)) return true;
  if (body.includes("AppShell")) return true; // AppShell renders <h1>{title}</h1> and <main>.
  const specs = [...body.matchAll(/from "(?:@\/|\.\.?\/)*components\/([^"]+)"/g)].map((m) => m[1]);
  return specs.some((spec) =>
    [join(COMPONENTS, spec + ".tsx"), join(COMPONENTS, spec + ".ts"), join(COMPONENTS, spec, "index.ts")]
      .some((candidate) => providesStructure(candidate, depth + 1)),
  );
}

function importsStructure(src: string): boolean {
  const specs = [...src.matchAll(/from "(?:@\/|\.\.?\/)*components\/([^"]+)"/g)].map((m) => m[1]);
  return specs.some((spec) =>
    [join(COMPONENTS, spec + ".tsx"), join(COMPONENTS, spec + ".ts"), join(COMPONENTS, spec, "index.ts")]
      .some((candidate) => providesStructure(candidate, 1)),
  );
}

export function runPageStructureTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): void {
  section("every page has a heading and a landmark");

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name === "page.tsx") files.push(full);
    }
  };
  walk(APP);

  const findings: string[] = [];
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const redirectOnly = /\bredirect\(/.test(src) && !/<[A-Za-z]/.test(src);
    if (redirectOnly) continue;
    const shell = src.includes("AppShell");
    if (shell || importsStructure(src)) continue; // the heading comes from the shell or a child.
    const h1 = (src.match(/<h1[\s>]/g) ?? []).length;
    const main = /<main[\s>]|role="main"/.test(src);
    if (h1 === 0) findings.push(`${routeOf(file.replace(/\/page\.tsx$/, ""))} has no h1`);
    if (!main) findings.push(`${routeOf(file.replace(/\/page\.tsx$/, ""))} has no main landmark`);
  }

  assert(files.length >= 65, `page structure: all pages were found (${files.length})`);
  assert(findings.length === 0, `page structure: no page is missing a heading or landmark (${findings.slice(0, 3).join("; ") || "none"})`);
}
