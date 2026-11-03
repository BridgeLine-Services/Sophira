/**
 * EVERY SIGNED-IN SEGMENT SAYS IT IS LOADING (2026-11-03, phase 2).
 *
 * The dashboard learned this the hard way on 2026-10-08: a slow session check meant a blank white
 * screen and no explanation. Sixteen other authenticated segments were in exactly that state - the
 * server resolves the session, the page has nothing to render yet, and the member is left looking at
 * nothing on a slow connection.
 *
 * This is a ratchet: every route that renders AppShell (i.e. requires a session) must ship a
 * loading.tsx beside its page.tsx. It does not say the loading state looks good - only that the
 * member is told something is happening rather than shown an empty screen.
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

export function runLoadingStateTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): void {
  section("signed-in segments have a loading state");

  const appDir = "src/app";
  const segments = readdirSync(appDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => existsSync(join(appDir, name, "page.tsx")));

  const shellSegments = segments.filter((name) => {
    try {
      return readFileSync(join(appDir, name, "page.tsx"), "utf8").includes("AppShell");
    } catch {
      return false;
    }
  });

  const missing = shellSegments.filter((name) => !existsSync(join(appDir, name, "loading.tsx")));

  assert(shellSegments.length >= 15, `loading states: signed-in segments were found (${shellSegments.length})`);
  assert(missing.length === 0, `loading states: every signed-in segment has one (${missing.slice(0, 4).join(", ") || "none"} missing)`);

  // A spinner with no words is only marginally better than a blank screen. The dashboard's own
  // pattern is Spinner plus one plain-language line, so that is what is required.
  const wordless = shellSegments.filter((name) => {
    const file = join(appDir, name, "loading.tsx");
    if (!existsSync(file)) return false;
    const src = readFileSync(file, "utf8");
    return !src.includes("<Spinner") || !/<p\b/.test(src);
  });
  assert(wordless.length === 0, `loading states: each one pairs the spinner with plain words (${wordless.slice(0, 4).join(", ") || "none"})`);
}
