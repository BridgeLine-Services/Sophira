import { readFileSync } from "fs";
import { buildActivity } from "../src/lib/owner-activity";

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
  const dash = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
  assert(dash.includes('id="activity"') && dash.includes("buildActivity({ members, invitations })"),
    "activity: the owner dashboard renders the derived feed");
}
