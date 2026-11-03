/**
 * NO API ROUTE MAY BE SILENTLY PRERENDERED (2026-11-03).
 *
 * In the App Router a GET route handler with no dynamic API is evaluated at build time and its
 * response reused. For a route that reads member data that is a privacy defect, not a performance
 * one: the cached response is served to whoever asks next.
 *
 * Scanned, not assumed: of the 84 API routes, 37 declare neither `force-dynamic` nor `revalidate`,
 * and every one of those either exports no GET at all (POST-only) or reads cookies/headers/request,
 * which forces dynamic rendering anyway. So there are no offenders today - and this test exists so
 * that the next GET route added without either cannot become one.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

export function runApiDynamicTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): void {
  section("api routes cannot be silently prerendered");

  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.ts") files.push(full);
    }
  };
  walk("src/app/api");

  const offenders = files.filter((file) => {
    const src = readFileSync(file, "utf8");
    const hasGet = /export\s+(async\s+function\s+GET|const\s+GET)\b/.test(src);
    if (!hasGet) return false; // POST/PUT/DELETE handlers are never statically cached.
    const declares = /export\s+const\s+(dynamic|revalidate)\b/.test(src);
    // Reading any of these marks the route dynamic in Next's own analysis.
    const readsRequest = /createClient\(|cookies\(|headers\(|NextRequest|\brequest\b|\breq\b/.test(src);
    return !declares && !readsRequest;
  });

  assert(files.length >= 80, `api dynamic: all API routes were found (${files.length})`);
  assert(offenders.length === 0,
    `api dynamic: no GET route can be served from the build-time cache (${offenders.slice(0, 3).join(", ") || "none"})`);
}
