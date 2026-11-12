/**
 * THE NAVIGATION SURFACE (2026-11-12).
 *
 * The workspace menu used to be a `const NAV` inside src/components/app/AppShell.tsx, so
 * tests could assert "is /lectures in the navigation?" by reading that one file. The list
 * now lives in src/lib/navigation/workspace-nav.ts, which is what the four renderers read,
 * so a test that wants to know whether a destination is in the menu has to ask BOTH files:
 * the module (the destinations) and the shell (the renderers).
 *
 * This helper is that pairing, in one place, so no suite has to hardcode the split.
 */
import { readFileSync } from "fs";

export const WORKSPACE_NAV_MODULE = "src/lib/navigation/workspace-nav.ts";
export const APP_SHELL = "src/components/app/AppShell.tsx";

/** The whole navigation surface: the shell's renderers plus the single menu module. */
export function readNavSurface(): string {
  return [APP_SHELL, WORKSPACE_NAV_MODULE].map((f) => readFileSync(f, "utf8")).join("\n");
}
