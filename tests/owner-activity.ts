import { existsSync, readFileSync } from "fs";
import { buildActivity } from "../src/lib/owner-activity";
import { buildStatusRows, statusIsHealthy } from "../src/lib/owner-status";

const member = (over: Partial<{ user_id: string; display_name: string; email: string | null; created_at: string; access_revoked_at: string | null }> = {}) => ({
  user_id: "u1", display_name: "Ada Lovelace", email: "ada@example.com",
  created_at: "2026-11-01T10:00:00Z", access_revoked_at: null as string | null, ...over,
});
const invite = (over: Partial<{ id: string; email: string; status: string; created_at: string; accepted_at: string | null }> = {}) => ({
  id: "i1", email: "new@example.com", status: "pending",
  created_at: "2026-11-02T09:00:00Z", accepted_at: null as string | null, ...over,
});

export function runOwnerActivityTests(assert: (cond: boolean, msg: string) => void) {
  const basic = buildActivity({ members: [member()], invitations: [invite()] });
  assert(basic.length === 2, "activity: one member and one invitation produce two real events");
  assert(Date.parse(basic[0].at) >= Date.parse(basic[1].at), "activity: newest first");
  assert(basic.some((i) => i.kind === "joined" && i.title.includes("Ada Lovelace")),
    "activity: a join names the person, not just an id");

  const revoked = buildActivity({ members: [member({ access_revoked_at: "2026-11-03T08:00:00Z" })] });
  assert(revoked[0].kind === "revoked" && revoked[0].title.includes("Access revoked"),
    "activity: a revocation is reported first when it is the newest event");

  const noname = buildActivity({ members: [member({ display_name: "", email: "nicy@example.com" })] });
  assert(noname[0].title.includes("nicy@example.com"),
    "activity: a member without a name is identified by their address, never as blank");

  const accepted = buildActivity({ invitations: [invite({ accepted_at: "2026-11-03T07:00:00Z" })] });
  assert(accepted.some((i) => i.kind === "invitation_accepted"),
    "activity: an acceptance is shown as its own event");

  const badDates = buildActivity({
    members: [member({ created_at: "not-a-date", access_revoked_at: null })],
    invitations: [invite({ created_at: "" })],
  });
  assert(badDates.length === 0, "activity: unparseable timestamps are dropped, not rendered as Invalid Date");

  assert(buildActivity({ members: [], invitations: [] }).length === 0,
    "activity: nothing invented when there is nothing to report");

  const many = Array.from({ length: 20 }, (_, n) =>
    member({ user_id: `u${n}`, created_at: new Date(Date.UTC(2026, 10, 1, 0, n)).toISOString() }));
  assert(buildActivity({ members: many, invitations: [] }).length === 8,
    "activity: the panel is capped at a readable length by default");
  assert(buildActivity({ members: many, invitations: [], limit: 5 }).length === 5,
    "activity: an explicit limit is respected");
  assert(buildActivity({ members: many, invitations: [], limit: 0 }).length === 1,
    "activity: a nonsensical limit is clamped rather than returning nothing or everything");
  assert(buildActivity({ members: many, invitations: [], limit: 999 }).length === 20,
    "activity: an oversized limit is clamped to what exists");

  const lib = readFileSync("src/lib/owner-activity.ts", "utf8");
  assert(!/Math\.random|Date\.now\(\)/.test(lib),
    "activity: no simulated or randomly generated events in the feed");
  // 2026-11-03: the feed has its own page now; the derivation itself is unchanged.
  const feed = readFileSync("src/app/owner/activity/page.tsx", "utf8");
  assert(feed.includes("buildActivity({ members, invitations })"),
    "activity: the activity page renders the derived feed");
  const overview = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
  assert(overview.includes('"/owner/activity"') && !overview.includes("buildActivity("),
    "activity: the overview links to the feed instead of duplicating it");

  // ---- System status must never call an unconfigured service "working" ---------
  const off = buildStatusRows({ aiReady: false, microsoft: false, google: false, search: false, membersLoaded: true });
  assert(off.find((r) => r.key === "ai")?.state === "attention",
    "status: a missing AI provider is flagged as needing attention, not hidden");
  assert(off.filter((r) => r.state === "optional_off").length === 3,
    "status: unconfigured optional connections are labelled not set up");
  assert(!statusIsHealthy(off), "status: a missing AI provider makes the system not fully healthy");
  const ok = buildStatusRows({ aiReady: true, microsoft: false, google: false, search: false, membersLoaded: true });
  assert(statusIsHealthy(ok), "status: optional extras switched off never make the system unhealthy");
  const dbDown = buildStatusRows({ aiReady: true, microsoft: true, google: true, search: true, membersLoaded: false });
  assert(dbDown.find((r) => r.key === "members")?.state === "attention" && !statusIsHealthy(dbDown),
    "status: a failed member load is reported as needing attention even when everything else is ready");
  assert(dbDown.every((r) => r.detail.length > 20 && !/undefined|null/.test(r.detail)),
    "status: every row explains itself in plain language");

  // ---- The owner sidebar must reach every section that now exists --------------
  // 2026-11-12: the owner navigation registry is data in src/lib/navigation/owner-nav.ts
  // (moved out of the "use client" shell so a Server Component can read it).
  const shell = readFileSync("src/lib/navigation/owner-nav.ts", "utf8");
  for (const route of ["members", "invitations", "requests", "activity", "status", "security", "ai-providers"]) {
    assert(shell.includes(`"/owner/${route}"`),
      `nav: the owner sidebar links to the dedicated ${route} page`);
    assert(existsSync(`src/app/owner/${route}/page.tsx`),
      `nav: /owner/${route} exists, so the sidebar link cannot 404`);
    const page = readFileSync(`src/app/owner/${route}/page.tsx`, "utf8");
    // 2026-11-12 (owner spec 4.2): a Co-Owner is authorised for the member directory, the
    // invitation screen and the invitation-request screen, so those use the staff gate. Every
    // other owner page keeps the owner-only gate, asserted separately.
    const staffSections = ["members", "invitations", "requests"];
    const expectedGate = staffSections.includes(route)
      ? /requireStaffPage/
      : /requireOwnerPage/;
    assert(expectedGate.test(page),
      `nav: /owner/${route} authorises on the server, not by hiding a link`);
    if (staffSections.includes(route)) {
      const ctx = readFileSync("src/lib/owner/page-context.ts", "utf8");
      assert(/profile\.role !== "owner" && profile\.role !== "co_owner"/.test(ctx),
        "nav: the staff gate accepts an Owner or a Co-Owner and redirects everyone else");
    } else {
      assert(!/requireStaffPage/.test(page),
        `nav: /owner/${route} stays Owner-only — a Co-Owner is not quietly let into ${route}`);
    }
    if (staffSections.includes(route) && route !== "members") {
      assert(/minimum: "co_owner"/.test(shell.slice(shell.indexOf(`"/owner/${route}"`), shell.indexOf(`"/owner/${route}"`) + 240)),
        `nav: /owner/${route} is offered to a Co-Owner in the sidebar, matching the gate that now admits them`);
    }
  }
  assert(shell.includes('heading: "Monitoring"'),
    "nav: the new sections sit in their own group rather than being appended anywhere");

  const panel = readFileSync("src/components/app/MembersPanel.tsx", "utf8");
  assert(panel.includes("postMemberAction") && panel.includes("MemberDirectory"),
    "members page: it reuses the directory and the shared action, not a second implementation");
  assert(panel.includes('role="dialog"') && panel.includes("Yes, remove permanently"),
    "members page: permanent removal stays separately confirmed, never one click");
  const dashSource = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
  assert((dashSource.match(/api\/network\/members/g) ?? []).length === 0,
    "members: the mutation has one implementation, so the two screens cannot drift");

  const actions = readFileSync("src/lib/owner/invitation-actions.ts", "utf8");
  const dashInvites = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8")
    + readFileSync("src/components/app/InvitationsPanel.tsx", "utf8")
    + readFileSync("src/components/app/RequestsPanel.tsx", "utf8");
  assert(!dashInvites.includes('"/api/invitations"') && !dashInvites.includes("decision }"),
    "invitations: the mutations have one implementation, so the overview and the pages cannot drift");
  assert(dashInvites.includes("createInvitationRequest") && dashInvites.includes("decideRequest"),
    "invitations: the UI calls the shared actions rather than its own fetch");
  assert(actions.includes('delivery === "sent") return "Invitation sent."'),
    "invitations: sent is only reported when the provider said sent");
  assert(actions.includes("partially_sent") && actions.includes("not_configured"),
    "invitations: partial and unconfigured delivery each get their own honest wording");
  const invitePage = readFileSync("src/app/owner/invitations/page.tsx", "utf8");
  assert(invitePage.includes("siteUrl") && invitePage.includes("InvitationsPanel"),
    "invitations page: it carries the site URL so a copied link is usable");
  const reqPanel = readFileSync("src/components/app/RequestsPanel.tsx", "utf8");
  assert(!/auto[- ]?approve/i.test(reqPanel),
    "requests: nothing is approved automatically");
}
