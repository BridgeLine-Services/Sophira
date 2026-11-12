/**
 * OWNER NAVIGATION BOUNDARY (2026-11-12 production incident).
 *
 * WHAT ACTUALLY BROKE:
 * `src/components/owner/OwnerAreaGrid.tsx` is a Server Component. It imported
 * OWNER_NAV_GROUPS from `src/components/app/AppShell.tsx`, which begins with
 * "use client". A Server Component cannot read a value out of a Client
 * Component: the bundler hands over a client reference (a proxy object), so
 * `OWNER_NAV_GROUPS.map` was not a function and /owner rendered the error
 * boundary (TypeError: h.OWNER_NAV_GROUPS.map is not a function, digest
 * 3954906548). The production build passed — only a real render failed.
 *
 * WHY THESE TESTS ARE DIFFERENT FROM THE OLD ONES:
 * The old owner-nav assertions searched AppShell's source text for the array.
 * That could never have caught this: the array was present and correct. These
 * tests (1) import the real module and check it is a genuine array with
 * renderable icons, (2) enforce the module-boundary RULE across the whole of
 * src, so the same class of mistake is caught wherever it appears, and (3)
 * exercise the role filter as behaviour rather than as text.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OWNER_NAV_GROUPS, ownerNavGroupsFor } from "../src/lib/navigation/owner-nav";
import type { Role } from "../src/lib/roles";

const SHARED = "src/lib/navigation/owner-nav.ts";
const GRID = "src/components/owner/OwnerAreaGrid.tsx";
const SHELL = "src/components/app/AppShell.tsx";

/** Every destination the owner navigation shipped with, in registry order. */
const EXPECTED_HREFS = [
  "/owner",
  "/owner/health",
  "/owner/database",
  "/tester",
  "/co-owner",
  "/owner/announcements",
  "/owner/members",
  "/owner/invitations",
  "/owner/requests",
  "/owner/analytics",
  "/owner/activity",
  "/owner/status",
  "/owner/features",
  "/owner/ai-operations",
  "/owner/backup",
  "/owner/release-readiness",
  "/owner/security",
  "/owner/ai-providers",
  "/owner/integrations",
  "/dashboard?view=workspace",
];

const EXPECTED_HEADINGS = ["Overview", "Network Management", "Monitoring", "Configuration", "Personal"];

const allItems = OWNER_NAV_GROUPS.flatMap((g) => g.items);
const hrefsFor = (role: Role) => ownerNavGroupsFor(role).flatMap((g) => g.items.map((i) => i.href));

/** True when the module's first statement is the "use client" directive. */
function isClientModule(path: string): boolean {
  const head = readFileSync(path, "utf8").slice(0, 400);
  return /^\s*(?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(head);
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** Resolve a project-local import specifier to a file on disk, or null. */
function resolveLocal(from: string, spec: string, root = "."): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(from), spec);
  else return null;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

/**
 * THE RULE, in one place and callable twice: a module WITHOUT "use client" may not
 * import a named DATA value from a module WITH "use client". A Server Component that
 * does receives a client reference instead of the value, which is exactly what threw
 * `OWNER_NAV_GROUPS.map is not a function` in production.
 *
 * `root` is the project root (or a temporary fixture tree in the self-test below), so
 * the same code path is used to check this repository and to prove the check fires on
 * the defect shape.
 */
function boundaryViolations(root: string): string[] {
  const files = sourceFiles(join(root, "src"));
  const clientFiles = new Set(files.filter(isClientModule));
  const violations: string[] = [];
  const importRe = /import\s+(type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;
  for (const file of files) {
    if (clientFiles.has(file)) continue;
    const src = readFileSync(file, "utf8");
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(src))) {
      if (m[1]) continue; // `import type ...` is erased at compile time
      const target = resolveLocal(file, m[3], root);
      if (!target || !clientFiles.has(target)) continue;
      const clause = m[2].trim();
      const names = clause.startsWith("{")
        ? clause.slice(1, -1).split(",").map((x) => x.trim()).filter((x) => x && !x.startsWith("type "))
          .map((x) => (x.split(/\s+as\s+/).pop() ?? "").trim())
        : [(clause.split(/\s+as\s+/).pop() ?? "").trim()];
      for (const name of names) {
        // PascalCase bindings are components (the supported client boundary).
        if (name && !/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
          violations.push(`${file} imports ${name} from the client module ${m[3]}`);
        }
      }
    }
  }
  return violations;
}

export function runOwnerNavBoundaryTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): void {
  // ==== A. The shared registry is real DATA at runtime ====
  section("owner-nav: shared registry is a genuine array on the server");
  {
    // The incident signature: a client reference is an object, not an array.
    assert(Array.isArray(OWNER_NAV_GROUPS),
      "owner-nav: OWNER_NAV_GROUPS is an actual Array at runtime — not a client reference proxy");
    assert(OWNER_NAV_GROUPS.constructor === Array && Object.getPrototypeOf(OWNER_NAV_GROUPS) === Array.prototype,
      "owner-nav: it is a real Array instance (a client reference would fail this even if it lied about length)");
    assert(typeof OWNER_NAV_GROUPS.map === "function" && OWNER_NAV_GROUPS.length === EXPECTED_HEADINGS.length,
      "owner-nav: .map is callable and every group is present — the exact call that threw in production");
    assert(OWNER_NAV_GROUPS.map((g) => g.heading).join("|") === EXPECTED_HEADINGS.join("|"),
      "owner-nav: group headings and their order are unchanged");
    assert(OWNER_NAV_GROUPS.every((g) => Array.isArray(g.items) && g.items.length > 0),
      "owner-nav: every group holds a non-empty items array (no empty group renders)");
    assert(allItems.every((i) => typeof i.href === "string" && i.href.startsWith("/") &&
      typeof i.label === "string" && i.label.trim().length > 0),
      "owner-nav: every item carries a route and a human label");
    const iconMarkup = allItems.map((i) => {
      const icon: unknown = i.icon;
      return typeof icon === "function" || (typeof icon === "object" && icon !== null)
        ? renderToStaticMarkup(createElement(i.icon, { className: "h-4 w-4" }))
        : "";
    });
    assert(iconMarkup.every((m) => m.includes("<svg")),
      "owner-nav: every icon is a real renderable component — the server grid can draw all of them");
    assert(allItems.map((i) => i.href).join("|") === EXPECTED_HREFS.join("|"),
      "owner-nav: all 20 destinations survive extraction, in the original order");
    assert(allItems.filter((i) => i.href.includes("view=workspace")).length === 1,
      "owner-nav: My Workspace appears exactly once");
    assert(new Set(allItems.map((i) => i.href)).size === allItems.length,
      "owner-nav: no duplicate destinations");
    for (const href of allItems.map((i) => i.href)) {
      if (href.startsWith("/owner/")) {
        assert(existsSync(join("src/app/owner", href.slice("/owner/".length), "page.tsx")),
          "owner-nav: " + href + " resolves to a real page");
      }
    }
    assert(existsSync("src/app/tester/page.tsx") && existsSync("src/app/co-owner/page.tsx") &&
      existsSync("src/app/dashboard/page.tsx"),
      "owner-nav: /tester, /co-owner and /dashboard all resolve to real pages");
  }

  // ==== B. Server/client module separation ====
  section("owner-nav: the registry lives outside any client module boundary");
  {
    const shared = readFileSync(SHARED, "utf8");
    const grid = readFileSync(GRID, "utf8");
    const shell = readFileSync(SHELL, "utf8");

    assert(!isClientModule(SHARED),
      "owner-nav: the shared module has no \"use client\" directive — a Server Component may read it");
    assert(!/useState|useEffect|useRef|createClient|localStorage|window\.|document\./.test(shared),
      "owner-nav: the shared module holds no client-only dependency (hooks, browser globals, Supabase client)");
    assert(!/export\s+const\s+OWNER_NAV_GROUPS/.test(shell) && !/heading:\s*"/.test(shell),
      "owner-nav: AppShell no longer defines the registry — one copy, not two");
    assert(/from "@\/lib\/navigation\/owner-nav"/.test(shell) && shell.includes("OWNER_NAV_GROUPS"),
      "owner-nav: AppShell imports the registry from the shared module");
    assert(/from "@\/lib\/navigation\/owner-nav"/.test(grid),
      "owner-nav: OwnerAreaGrid imports from the shared module");
    assert(!/from "@\/components\/app\/AppShell"/.test(grid) && !grid.includes("OWNER_NAV_GROUPS"),
      "owner-nav: OwnerAreaGrid does not reach into the Client Component for data (the production bug)");
    assert(!isClientModule(GRID),
      "owner-nav: OwnerAreaGrid stays a Server Component — no \"use client\" workaround");
    assert(!/use client/.test(grid.split("\n").slice(0, 3).join("\n")),
      "owner-nav: no client directive was added at the top of OwnerAreaGrid");

    // The general rule, enforced repository-wide: a module WITHOUT "use client" may not
    // import a named non-component value from a module WITH "use client". A Server
    // Component that does gets a client reference instead of the value.
    const violations = boundaryViolations(".");
    assert(violations.length === 0,
      "owner-nav: no server module imports a data value from a \"use client\" module" +
      (violations.length ? " — " + violations.slice(0, 3).join("; ") : ""));
  }

  // ==== C. Permission integrity (behaviour, not text) ====
  section("owner-nav: role filtering keeps each role inside its authority");
  {
    assert(hrefsFor("owner").join("|") === EXPECTED_HREFS.join("|"),
      "owner-nav: the Owner sees every destination");
    const coOwner = hrefsFor("co_owner");
    assert(coOwner.length > 0 && coOwner.every((h) => !["/owner/security", "/owner/ai-providers", "/owner/integrations",
      "/owner/activity", "/owner/status", "/owner/backup", "/owner/features", "/owner/ai-operations",
      "/owner/release-readiness"].includes(h)),
      "owner-nav: a Co-Owner never sees an Owner-only area (security, billing, providers, integrations, monitoring)");
    assert(coOwner.includes("/owner/members") && coOwner.includes("/owner/invitations") &&
      coOwner.includes("/owner/requests") && coOwner.includes("/owner/announcements") &&
      coOwner.includes("/co-owner"),
      "owner-nav: a Co-Owner keeps the member-facing destinations");
    const tester = hrefsFor("tester");
    assert(tester.join("|") === "/tester",
      "owner-nav: a Tester gets the testing workspace and nothing else in the owner navigation");
    const user = hrefsFor("user");
    assert(user.length === 0,
      "owner-nav: an ordinary member gains no entry in the owner navigation at all");
    // The Owner-only default must stay the default: an unmarked item is Owner-only.
    const unmarked = allItems.filter((i) => !i.minimum).map((i) => i.href);
    assert(unmarked.length > 0 && unmarked.every((h) => !coOwner.includes(h)),
      "owner-nav: an item with no minimum role is Owner-only, never inherited");
    assert(ownerNavGroupsFor("user").every((g) => g.items.length > 0),
      "owner-nav: no empty group is ever handed to a renderer");
    assert(ownerNavGroupsFor("nonsense").flatMap((g) => g.items.map((i) => i.href)).length === 0,
      "owner-nav: an unrecognised role is treated as the lowest privilege, never as staff");
  }

  // ==== D. Error boundaries stay functional and quiet ====
  section("owner-nav: error boundaries keep recovery and leak nothing");
  {
    const route = readFileSync("src/app/error.tsx", "utf8");
    const global = readFileSync("src/app/global-error.tsx", "utf8");
    assert(isClientModule("src/app/error.tsx") && isClientModule("src/app/global-error.tsx"),
      "errors: both boundaries are client components, as Next requires");
    assert(route.includes("reset()") && route.includes('href="/dashboard"'),
      "errors: the route boundary still offers retry and a dashboard way out");
    assert(global.includes("onClick={reset}") && global.includes('href="/dashboard"') && global.includes("<html"),
      "errors: the last-resort boundary still renders its own document with retry and a way out");
    assert(route.includes("error.digest") && global.includes("digest"),
      "errors: both boundaries offer the opaque reference code when one exists");
    assert(!route.includes("error.stack") && !global.includes("error.stack"),
      "errors: no stack trace is ever shown to a user");
    assert(!/fetch\(/.test(route) && !/fetch\(/.test(global),
      "errors: nothing is transmitted to a third party; reporting reuses Sophira's own QA reports");
    assert(/qa_reports/.test(route) && /try\s*{/.test(route),
      "errors: reporting goes to the existing qa_reports channel and is wrapped so it cannot throw");
    assert(!/console\.log\(error\)/.test(route),
      "errors: the whole error object (which can carry user content) is never logged");
  }

  // ==== E. The boundary check itself is proven to fire ====
  section("owner-nav: the boundary check is proven to catch the defect shape");
  {
    const dir = mkdtempSync(join(tmpdir(), "sophira-nav-"));
    try {
      mkdirSync(join(dir, "src/components/app"), { recursive: true });
      mkdirSync(join(dir, "src/components/owner"), { recursive: true });
      mkdirSync(join(dir, "src/lib/navigation"), { recursive: true });
      writeFileSync(join(dir, "src/components/app/AppShell.tsx"),
        '"use client";\nexport const OWNER_NAV_GROUPS = [{ heading: "Overview", items: [] }];\nexport function AppShell() { return null; }\n');
      // The EXACT shape of the shipped defect: a server module pulling a data constant
      // (and a component, and a type) out of a "use client" module.
      writeFileSync(join(dir, "src/components/owner/OwnerAreaGrid.tsx"),
        'import { OWNER_NAV_GROUPS, AppShell } from "@/components/app/AppShell";\n' +
        'import type { NavRole } from "@/components/app/AppShell";\n' +
        'export const groups = OWNER_NAV_GROUPS.map((g) => g);\nexport const shell = AppShell;\nexport type R = NavRole;\n');
      const found = boundaryViolations(dir);
      assert(found.length === 1 && /OWNER_NAV_GROUPS/.test(found[0]),
        "owner-nav: the check flags the exact production import — a data value crossing a client boundary");
      assert(!found.some((f) => /imports AppShell from/.test(f)),
        "owner-nav: a COMPONENT imported across the boundary is allowed (the supported case), never flagged");
      assert(!found.some((f) => /imports NavRole from/.test(f)),
        "owner-nav: `import type` is erased at compile time, so it is never flagged");
      // And the fixed shape is clean: the same data imported from a shared module.
      writeFileSync(join(dir, "src/components/owner/OwnerAreaGrid.tsx"),
        'import { OWNER_NAV_GROUPS } from "@/lib/navigation/owner-nav";\nexport const groups = OWNER_NAV_GROUPS.map((g) => g);\n');
      writeFileSync(join(dir, "src/lib/navigation/owner-nav.ts"),
        'export const OWNER_NAV_GROUPS = [{ heading: "Overview", items: [] }];\n');
      assert(boundaryViolations(dir).length === 0,
        "owner-nav: the check accepts the same value imported from a shared (non-client) module — no false alarm");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ==== F. The component that crashed actually renders on the server ====
  section("owner-nav: the real area grid renders server-side with real data");
  {
    // OwnerAreaGrid is the component that threw in production. It is compiled by the
    // test build (tests/tsconfig.json), so it can be rendered for real here instead of
    // being inspected as text. `@/` is mapped to the compiled tree for the duration of
    // this block only.
    //
    // What this proves: the grid draws every destination on the SERVER with the real
    // registry, for each role. What it cannot prove on its own: the client-reference
    // proxy only exists inside the Next bundler, so section B's static rule remains the
    // guard that would have caught the original defect.
    const compiledRoot = join(process.cwd(), "tests-dist");
    const gridModule = join(compiledRoot, "src/components/owner/OwnerAreaGrid.js");
    assert(existsSync(gridModule),
      "owner-nav: the area grid is compiled for the test build (npm test compiles tests/tsconfig.json first)");
    if (existsSync(gridModule)) {
      const Module = require("module") as {
        _resolveFilename: (request: string, ...rest: unknown[]) => string;
      };
      const original = Module._resolveFilename as unknown as (request: string, ...rest: unknown[]) => string;
      Module._resolveFilename = function (request: string, ...rest: unknown[]): string {
        const mapped = request.startsWith("@/") ? join(compiledRoot, "src", request.slice(2)) : request;
        return original(mapped, ...rest);
      } as typeof Module._resolveFilename;
      try {
        const grid = require(gridModule) as { OwnerAreaGrid: (props: { role: Role }) => ReturnType<typeof createElement> };
        const draw = (role: Role) =>
          renderToStaticMarkup(createElement(grid.OwnerAreaGrid, { role }) as never);
        const ownerHtml = draw("owner");
        const missing = EXPECTED_HREFS.filter((href) => !ownerHtml.includes(`href="${href}"`));
        assert(missing.length === 0,
          "owner-nav: the Owner's grid renders all 20 destinations on the server" +
            (missing.length ? " — missing " + missing.slice(0, 3).join(", ") : ""));
        assert(EXPECTED_HEADINGS.every((h) => ownerHtml.includes(h)),
          "owner-nav: every group heading renders, in the grid, from the shared registry");
        const coHtml = draw("co_owner");
        assert(coHtml.includes('href="/owner/members"') && coHtml.includes('href="/co-owner"'),
          "owner-nav: a Co-Owner's grid renders the member-facing areas");
        assert(!coHtml.includes('href="/owner/security"') && !coHtml.includes('href="/owner/integrations"'),
          "owner-nav: a Co-Owner's grid never renders an Owner-only area");
        const userHtml = draw("user");
        assert(!userHtml.includes("href="),
          "owner-nav: an ordinary member's grid renders no administrative link at all");
        assert(!ownerHtml.includes("undefined") && !ownerHtml.includes("NaN"),
          "owner-nav: the rendered grid leaks no undefined/NaN (icons and labels all resolved)");
      } finally {
        Module._resolveFilename = original;
      }
    }
  }
}
