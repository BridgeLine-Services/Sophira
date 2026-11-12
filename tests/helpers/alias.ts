/**
 * LET THE TEST RUNNER RESOLVE "@/..." (2026-11-12).
 *
 * The suites are compiled to plain CommonJS and run by Node, which knows nothing about the
 * tsconfig `paths` mapping. So a test could import pure modules only - as soon as it touched
 * a real Server Component (which imports "@/components/ui", "@/lib/..."), the run died with
 * MODULE_NOT_FOUND. That is why the released defect ("OWNER_NAV_GROUPS.map is not a
 * function") was pinned by reading source text instead of rendering the component.
 *
 * This hook maps "@/x" to the compiled src/x, so a suite can render the REAL component with
 * renderToStaticMarkup and assert what a reader would actually see. It is imported first in
 * tests/run.ts, before any suite that needs it.
 */
import Module from "module";
import { join } from "path";

const DIST_ROOT = join(__dirname, "..", "..");

type Resolver = (request: string, ...rest: unknown[]) => string;
const moduleWithResolver = Module as unknown as { _resolveFilename: Resolver };
const original = moduleWithResolver._resolveFilename;

moduleWithResolver._resolveFilename = function resolve(request: string, ...rest: unknown[]): string {
  if (typeof request === "string" && request.startsWith("@/")) {
    return original.call(this, join(DIST_ROOT, "src", request.slice(2)), ...rest);
  }
  return original.call(this, request, ...rest);
};

export const ALIAS_ROOT = DIST_ROOT;
