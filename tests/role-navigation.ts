/**
 * FOUR RANKS, FOUR DASHBOARDS, ONE DECISION (2026-11-12).
 *
 * What was wrong before this:
 *   - a Co-Owner's "dashboard" entry pointed at /owner/members and was labelled "Owner
 *     Dashboard" (the drawer called it "Members");
 *   - a Tester had no dashboard entry at all, though /tester existed;
 *   - the tablet row rendered the UNFILTERED registry, so a Co-Owner saw Owner-only pages;
 *   - Home was the second item in the workspace menu, not the first;
 *   - Announcements always went "back" to /co-owner, whichever rank opened it;
 *   - the sidebar read `profiles.select(...).limit(1)` - "some profile row" - so under a
 *     directory policy it could read a colleague's rank;
 *   - the Co-Owner page linked to three Owner-only pages that bounce them.
 *
 * These tests are BEHAVIOURAL where they can be: they call the real resolver, the real menu
 * builder and the real role filter, for all four ranks, instead of searching AppShell's text
 * for a formula. The remaining source assertions describe wiring this environment cannot
 * execute (a Client Component needs a browser and a live Supabase client), and each one names
 * the defect it is guarding so it cannot be weakened into a tautology.
 */
import { existsSync, readFileSync } from "fs";
import { dashboardForRole, adminHomeFor, environmentFor, roleLabelFor, staffBackHrefFor, ROLE_DASHBOARDS } from "../src/lib/navigation/role-home";
import { WORKSPACE_SECTIONS, workspaceNavFor } from "../src/lib/navigation/workspace-nav";
import { ownerNavGroupsFor } from "../src/lib/navigation/owner-nav";
import type { Role } from "../src/lib/roles";

const SHELL = "src/components/app/AppShell.tsx";
const read = (p: string) => readFileSync(p, "utf8");
const hrefs = (role: Role | string | null | undefined) => workspaceNavFor(role).map((i) => i.href);
const adminHrefs = (role: Role | string | null) =>
  ownerNavGroupsFor(role).flatMap((g) => g.items.map((i) => i.href));

/** The academic destinations that must survive for every rank. */
const ACADEMIC = ["/dashboard", "/courses", "/notebooks", "/lectures", "/learning", "/notifications", "/offline", "/settings", "/writing/typing"];

export function runRoleNavigationTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): void {
  // ==== A. The resolver: one dashboard per rank, none for anyone else ====
  section("role-nav: each rank has exactly one dashboard, and only that one");
  {
    assert(dashboardForRole("owner")?.href === "/owner" && dashboardForRole("owner")?.label === "Owner Dashboard",
      "role-nav: the Owner's dashboard is /owner, labelled Owner Dashboard");
    assert(dashboardForRole("co_owner")?.href === "/co-owner" && dashboardForRole("co_owner")?.label === "Co-Owner Dashboard",
      "role-nav: a Co-Owner's dashboard is /co-owner, labelled Co-Owner Dashboard (not Members, not Owner Dashboard)");
    assert(dashboardForRole("tester")?.href === "/tester" && dashboardForRole("tester")?.label === "Tester Dashboard",
      "role-nav: a Tester now HAS a dashboard entry, at /tester, labelled Tester Dashboard");
    assert(dashboardForRole("user") === null,
      "role-nav: an ordinary member is offered no administrative dashboard at all");

    // Fail closed: nothing may be assumed for a value we cannot read.
    for (const unknown of [null, undefined, "", "nonsense", "OWNER", "admin", "superuser"]) {
      assert(dashboardForRole(unknown as never) === null,
        `role-nav: an unknown or missing role (${JSON.stringify(unknown)}) gets NO dashboard entry`);
      assert(adminHomeFor(unknown as never) === "/dashboard",
        `role-nav: an unknown role's "home" is the personal workspace, never an administrative one`);
    }

    // The four dashboards are distinct destinations and each one really exists.
    const destinations = Object.values(ROLE_DASHBOARDS).filter(Boolean).map((d) => d!.href);
    assert(new Set(destinations).size === 3 && destinations.length === 3,
      "role-nav: the three administrative dashboards are three different routes - no rank shares another's home");
    assert(existsSync("src/app/owner/page.tsx") && existsSync("src/app/co-owner/page.tsx") && existsSync("src/app/tester/page.tsx"),
      "role-nav: every dashboard route resolves to a real page");
    assert(ROLE_DASHBOARDS.owner!.label !== ROLE_DASHBOARDS.co_owner!.label &&
      ROLE_DASHBOARDS.co_owner!.label !== ROLE_DASHBOARDS.tester!.label,
      "role-nav: no two ranks share a dashboard LABEL (the old bug showed 'Owner Dashboard' to a Co-Owner)");
  }

  // ==== A2. The panel names the rank (the instruction: "the side panel must identify the
  // account's actual rank"). It never names a rank it has not read. ====
  section("role-nav: the side panel identifies the account's actual rank");
  {
    assert(roleLabelFor("owner") === "Owner" && roleLabelFor("co_owner") === "Co-Owner",
      "role-nav: staff ranks are named in the panel, in plain words");
    assert(roleLabelFor("tester") === "Tester" && roleLabelFor("user") === "Member",
      "role-nav: a Tester is named Tester and an ordinary account is called a Member, not 'User'");
    for (const unknown of [null, undefined, "", "nonsense", "admin", "OWNER", "co-owner"]) {
      assert(roleLabelFor(unknown as never) === null,
        `role-nav: an unreadable rank (${JSON.stringify(unknown)}) prints NO rank label - the panel never guesses`);
    }
    const shell = read(SHELL);
    assert(shell.includes("const rankLabel = roleLabelFor(role)") && (shell.match(/Signed in as/g) ?? []).length === 2,
      "role-nav: the rail and the phone drawer both name the rank (two panels, one answer)");
    assert(shell.includes("{rankLabel && (") && shell.includes("data-rank={role}"),
      "role-nav: the label is drawn only when the rank is known, and carries the raw rank for inspection");
  }

  // ==== B. Home and back destinations ====
  section("role-nav: logo, back button and rank change agree with the resolver");
  {
    assert(adminHomeFor("owner") === "/owner" && adminHomeFor("co_owner") === "/co-owner",
      "role-nav: the logo opens each staff rank's OWN dashboard");
    assert(adminHomeFor("tester") === "/tester" && adminHomeFor("user") === "/dashboard",
      "role-nav: a Tester's logo goes to their dashboard, a member's to their workspace");
    assert(staffBackHrefFor("owner") === "/owner" && staffBackHrefFor("co_owner") === "/co-owner",
      "role-nav: Announcements/QA 'back' returns each rank to its own home, not always to /co-owner");
    assert(environmentFor("owner") === "owner" && environmentFor("co_owner") === "owner",
      "role-nav: both staff ranks work inside the administrative environment");
    assert(environmentFor("tester") === "workspace" && environmentFor("user") === "workspace" &&
      environmentFor(null) === "workspace",
      "role-nav: a Tester and a member work in the academic workspace - a Tester is never given a staff menu");
  }

  // ==== C. The workspace menu, for all four ranks (the sidebar, drawer, tablet row and
  // bottom bar all render THIS list, so this is the real navigation decision) ====
  section("role-nav: the workspace menu shows each rank only its own dashboard");
  {
    const owner = workspaceNavFor("owner");
    assert(owner[0].href === "/owner" && owner[0].label === "Owner Dashboard" && owner[0].kind === "dashboard",
      "role-nav: an Owner's menu starts with their Owner Dashboard");
    assert(!hrefs("owner").includes("/co-owner") && !hrefs("owner").includes("/tester"),
      "role-nav: an Owner is never offered the Co-Owner's or the Tester's dashboard as another entry");

    const co = workspaceNavFor("co_owner");
    assert(co[0].href === "/co-owner" && co[0].label === "Co-Owner Dashboard",
      "role-nav: a Co-Owner's menu starts with the Co-Owner Dashboard at /co-owner");
    assert(!hrefs("co_owner").includes("/owner") && !hrefs("co_owner").includes("/tester"),
      "role-nav: a Co-Owner is never offered the Owner's dashboard");

    const tester = workspaceNavFor("tester");
    assert(tester[0].href === "/tester" && tester[0].label === "Tester Dashboard",
      "role-nav: a Tester's menu starts with their Tester Dashboard");
    assert(!hrefs("tester").includes("/owner") && !hrefs("tester").includes("/co-owner"),
      "role-nav: a Tester is never offered an administrative dashboard");

    const user = workspaceNavFor("user");
    assert(user[0].href === "/dashboard" && user[0].label === "Home",
      "role-nav: an ordinary member's menu begins with Home");
    assert(!user.some((i) => i.kind === "dashboard"),
      "role-nav: an ordinary member's menu contains no dashboard entry");
    assert(!hrefs("user").some((h) => h === "/owner" || h === "/co-owner" || h === "/tester"),
      "role-nav: no administrative route appears anywhere in a member's menu");

    // Unknown role: identical to a member, never to staff.
    assert(workspaceNavFor(null).length === workspaceNavFor("user").length &&
      workspaceNavFor("nonsense")[0].href === "/dashboard" &&
      !workspaceNavFor("nonsense").some((i) => i.kind === "dashboard"),
      "role-nav: a role that has not loaded gets the plain member menu, never a staff one");

    // Exactly one dashboard entry, ever; and the academic menu is untouched for everyone.
    for (const role of ["owner", "co_owner", "tester", "user", "nonsense"] as const) {
      const menu = workspaceNavFor(role);
      assert(menu.filter((i) => i.kind === "dashboard").length <= 1,
        `role-nav: ${role} gets at most ONE dashboard entry (no competing role systems)`);
      for (const href of ACADEMIC) {
        assert(menu.some((i) => i.href === href),
          `role-nav: ${role} keeps the academic destination ${href}`);
      }
      assert(menu[menu.length - 1].href === "/settings",
        `role-nav: ${role}'s academic menu keeps its existing order (Settings last)`);
    }

    // Home first among the ACADEMIC sections - the owner's explicit instruction.
    assert(WORKSPACE_SECTIONS[0].href === "/dashboard" && WORKSPACE_SECTIONS[0].label === "Home",
      "role-nav: Home is the FIRST academic section, not the second");
    const sectionOrder = WORKSPACE_SECTIONS.map((i) => i.href);
    assert(sectionOrder.join("|") === ["/dashboard", "/writing/typing", "/courses", "/notebooks", "/lectures", "/learning", "/notifications", "/offline", "/settings"].join("|"),
      "role-nav: the academic order is Home, Typing Calibration, Courses, Notebooks, Lectures, Learning / Memory, Notifications, Offline, Settings");
    assert(WORKSPACE_SECTIONS.filter((i) => i.href === "/dashboard").length === 1,
      "role-nav: Home appears exactly once (no duplicated destination)");
  }

  // ==== D. The administrative sidebar, per rank ====
  section("role-nav: the staff sidebar gives no rank a link it cannot open");
  {
    const owner = adminHrefs("owner");
    assert(owner.includes("/owner") && !owner.includes("/co-owner") && !owner.includes("/tester"),
      "role-nav: the Owner's staff sidebar has /owner and NOT the Co-Owner or Tester workspace");
    assert(owner.includes("/owner/security") && owner.includes("/owner/database") && owner.includes("/owner/ai-providers"),
      "role-nav: the Owner keeps every Owner-only area, including security, database and AI providers");

    const co = adminHrefs("co_owner");
    assert(co.includes("/co-owner") && co.includes("/owner/members") && co.includes("/owner/invitations") &&
      co.includes("/owner/requests") && co.includes("/owner/qa") && co.includes("/owner/announcements"),
      "role-nav: a Co-Owner gets their dashboard plus the people-facing areas and QA triage");
    assert(!co.includes("/owner"),
      "role-nav: a Co-Owner never sees an Owner Dashboard entry");
    for (const forbidden of ["/owner/security", "/owner/ai-providers", "/owner/integrations", "/owner/database",
      "/owner/backup", "/owner/release-readiness", "/owner/analytics", "/owner/status", "/owner/activity",
      "/owner/features", "/owner/ai-operations", "/tester"]) {
      assert(!co.includes(forbidden),
        `role-nav: a Co-Owner is not offered ${forbidden} (it is Owner-only, so the link would bounce them)`);
    }

    const tester = adminHrefs("tester");
    assert(!tester.some((h) => h.startsWith("/owner")),
      "role-nav: a Tester is offered no /owner destination at all");

    assert(adminHrefs("user").length === 0 && adminHrefs(null).length === 0,
      "role-nav: a member - and a role that has not loaded - gets no administrative entry");

    // No dead links: every destination a Co-Owner is offered must be gated by a page that
    // accepts a Co-Owner. This is the exact drift that shipped (analytics/activity/AI ops).
    const coGated: Record<string, string[]> = {
      "/co-owner": ["isStaff(role)"],
      "/owner/members": ["requireStaffPage"],
      "/owner/invitations": ["requireStaffPage"],
      "/owner/requests": ["requireStaffPage"],
      "/owner/qa": ["canUseTesterFeatures"],
      "/owner/announcements": ["isStaff(role)"],
    };
    for (const [href, gates] of Object.entries(coGated)) {
      const file = `src/app${href}/page.tsx`;
      assert(existsSync(file), `role-nav: ${href} resolves to a real page`);
      if (existsSync(file)) {
        const src = read(file);
        assert(gates.some((g) => src.includes(g)),
          `role-nav: ${href} authorises a Co-Owner server-side (${gates.join(" or ")}) - the link is not a dead end`);
      }
    }
    // And the Owner-only pages a Co-Owner is NOT offered stay Owner-only.
    for (const href of ["/owner/analytics", "/owner/activity", "/owner/ai-operations", "/owner/security", "/owner/database"]) {
      const src = read(`src/app${href}/page.tsx`);
      assert(src.includes("requireOwnerPage"),
        `role-nav: ${href} stays Owner-only (requireOwnerPage) - no staff permission was widened for navigation`);
    }
  }

  // ==== E. All four renderers use the one decision ====
  section("role-nav: every responsive variant uses the same role-aware menu");
  {
    const shell = read(SHELL);
    assert(!/OWNER_NAV_GROUPS\s*\.\s*(flatMap|map)/.test(shell),
      "role-nav: AppShell no longer renders the UNFILTERED registry (the tablet bug)");
    assert((shell.match(/visibleOwnerGroups/g) ?? []).length >= 3,
      "role-nav: the filtered groups feed the rail, the tablet row and the drawer");
    assert((shell.match(/workspaceNavFor\(role\)/g) ?? []).length === 1,
      "role-nav: the workspace menu is built once, from the shared builder, for every renderer");
    assert(shell.includes("{sectionLinks.map(") && shell.includes("const sectionLinks = workspaceLinks.filter(") &&
      (shell.match(/\{sectionLinks\.map\(/g) ?? []).length >= 2,
      "role-nav: the rail and the drawer draw the same filtered section list");
    assert(shell.includes("{workspaceLinks.map(") && shell.includes("{workspaceLinks.filter((n) => n.href !== \"/settings\")"),
      "role-nav: the tablet row and the phone bottom bar draw the same role-aware list");
    assert(!shell.includes('"Owner Dashboard"'),
      "role-nav: AppShell contains no hardcoded dashboard label - every one comes from the resolver");
    assert(shell.includes("dashboardLink &&") && shell.includes("{dashboardLink.label}"),
      "role-nav: the dashboard entry is guarded by the resolver's answer and labelled by it");

    // Loading / unknown: nothing rank-specific is drawn.
    assert(shell.includes("role === null ? (") ,
      "role-nav: the administrative menu draws a plain loading line while the rank is unknown");
    assert(/const \[role, setRole\] = useState<NavRole \| null>\(/.test(shell),
      "role-nav: the rank starts as UNKNOWN, not as a guess");
    assert(shell.includes("role: initialRole") && shell.includes("role={profile.role}") === false,
      "role-nav: the shell accepts the page's server-verified rank as a prop");

    // The role read is by identity, and a failure never promotes anyone.
    assert(shell.includes('.select("role").eq("id", uid)') && !shell.includes('.select("id, role").limit(1)'),
      "role-nav: the shell reads THIS member's role row, not 'some profile row'");
    assert(shell.includes('if (error || !data) {') && shell.includes("if (!roleSettled.current) setRole(null)"),
      "role-nav: an unreadable role fails closed on the first read and never invents staff");
    assert(shell.includes('window.addEventListener("focus", bump)'),
      "role-nav: a rank change made elsewhere is picked up when the member returns to the tab");

    // Every page that reads a profile hands the verified rank to the shell.
    for (const page of ["src/app/dashboard/page.tsx", "src/app/owner/page.tsx", "src/app/co-owner/page.tsx",
      "src/app/tester/page.tsx", "src/app/owner/announcements/page.tsx", "src/app/owner/qa/page.tsx"]) {
      assert(/role=\{(profile\.role|role)\}/.test(read(page)),
        `role-nav: ${page} passes the server-read rank to the shell (no client-side guess, no flash)`);
    }
  }

  // ==== F. The staff pages live in the right environment ====
  section("role-nav: staff pages render inside the environment that matches the rank");
  {
    const announcements = read("src/app/owner/announcements/page.tsx");
    assert(announcements.includes('variant="owner"'),
      "announcements: rendered in the ADMINISTRATIVE environment, not the academic workspace");
    assert(announcements.includes("backHref={staffBackHrefFor(role)}") && !announcements.includes('backHref="/co-owner"'),
      "announcements: back goes to the rank's own home (the hardcoded /co-owner is gone)");
    assert(announcements.includes("const role = normalizeRole(profile?.role)") &&
      !/searchParams|cookies\(\)/.test(announcements),
      "announcements: the environment comes from the server-read profile, so a refresh or a direct URL cannot change it");

    const coOwner = read("src/app/co-owner/page.tsx");
    assert(coOwner.includes('title="Co-Owner Dashboard"') && coOwner.includes('variant="owner"'),
      "co-owner: their page is titled Co-Owner Dashboard and renders in the administrative environment");
    assert(!coOwner.includes('href="/owner/analytics"') && !coOwner.includes('href="/owner/activity"') &&
      !coOwner.includes('href="/owner/ai-operations"'),
      "co-owner: the three Owner-only links that used to bounce a Co-Owner are gone");

    assert(coOwner.includes("announcementsUnreadable") && coOwner.includes("couldn&apos;t be read just now"),
      "co-owner: an unreadable announcements read says so, instead of claiming nothing was ever announced");
    assert(!coOwner.includes("Watch engagement and completion"),
      "co-owner: their responsibilities do not promise a page this rank cannot open");

    const tester = read("src/app/tester/page.tsx");
    assert(tester.includes('title="Tester Dashboard"') && !tester.includes('variant="owner"'),
      "tester: their dashboard is named, and stays in the academic workspace (a Tester is a working member)");

    const qa = read("src/app/owner/qa/page.tsx");
    assert(qa.includes("environmentFor(profile.role)") && qa.includes("staffBackHrefFor(profile.role)"),
      "qa: staff triage renders in the staff environment with the right way back, and a Tester keeps the workspace");

    const ownerPage = read("src/app/owner/page.tsx");
    assert(ownerPage.includes('variant="owner"') && ownerPage.includes("role={profile.role}"),
      "owner: the Owner Dashboard renders the administrative environment with the verified rank");
  }

  // ==== G. Direct-URL authorization: the page gate, per route ====
  section("role-nav: direct URLs are refused by the server, not by hidden links");
  {
    // A hidden link is not security. Each route below must refuse the rank itself.
    const rules: Array<{ route: string; file: string; gate: RegExp; why: string }> = [
      { route: "/owner", file: "src/app/owner/page.tsx", gate: /profile\.role !== "owner"\)\s*redirect\("\/dashboard"\)/, why: "an Owner-only home" },
      { route: "/co-owner", file: "src/app/co-owner/page.tsx", gate: /if \(!isStaff\(role\)\)\s*redirect\("\/dashboard"\)/, why: "staff only" },
      { route: "/tester", file: "src/app/tester/page.tsx", gate: /if \(!profile \|\| !canUseTesterFeatures\(profile\.role\)\)\s*redirect\("\/dashboard"\)/, why: "tester and above" },
      { route: "/owner/security", file: "src/app/owner/security/page.tsx", gate: /requireOwnerPage\(\)/, why: "Owner-only" },
      { route: "/owner/ai-providers", file: "src/app/owner/ai-providers/page.tsx", gate: /requireOwnerPage\(\)/, why: "Owner-only" },
      { route: "/owner/database", file: "src/app/owner/database/page.tsx", gate: /requireOwnerPage\(\)/, why: "Owner-only" },
      { route: "/owner/announcements", file: "src/app/owner/announcements/page.tsx", gate: /if \(!isStaff\(role\)\)\s*redirect\("\/dashboard"\)/, why: "staff only" },
    ];
    for (const rule of rules) {
      const src = read(rule.file);
      assert(rule.gate.test(src),
        `role-nav: ${rule.route} refuses unauthorised ranks server-side (${rule.why})`);
    }
    // The owner-only page gate itself must not have been loosened.
    const ctx = read("src/lib/owner/page-context.ts");
    assert(/if \(profile\.role !== "owner"\) redirect\("\/dashboard"\);/.test(ctx),
      "role-nav: requireOwnerPage still admits the Owner and nobody else");
    assert(/profile\.role !== "owner" && profile\.role !== "co_owner"/.test(ctx),
      "role-nav: requireStaffPage still admits exactly the two staff ranks");

    // /dashboard keeps its existing behaviour for every rank.
    const dashboard = read("src/app/dashboard/page.tsx");
    assert(dashboard.includes('profile.role === "owner" && view !== "workspace"'),
      "role-nav: /dashboard still role-routes only the OWNER (every other rank keeps the workspace)");
  }
}
