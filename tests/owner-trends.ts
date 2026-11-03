import { readFileSync } from "fs";
import { buildTrends } from "../src/lib/owner-trends";

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();

export function runOwnerTrendTests(assert: (cond: boolean, msg: string) => void) {
  const t = buildTrends({
    members: [
      { created_at: daysAgo(1), access_revoked_at: null },
      { created_at: daysAgo(90), access_revoked_at: daysAgo(2) },
    ],
    invitations: [{ created_at: daysAgo(3) }, { created_at: daysAgo(60) }],
    requests: [{ created_at: daysAgo(4) }],
    now: NOW,
  });
  assert(t.members.includes("1 person joined"), "trends: only records inside the window are counted");
  assert(t.members.includes("last 30 days"), "trends: the window is stated, not implied");
  assert(t.active.includes("1 joined") && t.active.includes("1 revoked"),
    "trends: the active tile separates arrivals from revocations");
  assert(t.invitations.startsWith("1 sent"), "trends: a 60-day-old invitation is outside the window");
  assert(t.requests.startsWith("1 received"), "trends: requests are counted in the same window");

  const quiet = buildTrends({ members: [], invitations: [], requests: [], now: NOW });
  assert(quiet.members === "No change in the last 30 days",
    "trends: an idle period says so plainly instead of showing a fake +0%");
  assert(quiet.active === "No change in the last 30 days", "trends: the active tile also reports no change");

  const week = buildTrends({ members: [{ created_at: daysAgo(10), access_revoked_at: null }], now: NOW, days: 7 });
  assert(week.members === "No change in the last 7 days", "trends: a custom window is honoured");

  const junk = buildTrends({
    members: [{ created_at: "not-a-date", access_revoked_at: "also-bad" } as never],
    invitations: [{ created_at: "" }],
    now: NOW,
  });
  assert(junk.members === "No change in the last 30 days", "trends: unparseable timestamps are ignored, not guessed");

  const clamped = buildTrends({ members: [], now: NOW, days: 0 });
  assert(clamped.members.includes("last 1 days"), "trends: a nonsensical window is clamped to one day");

  const code = readFileSync("src/lib/owner-trends.ts", "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert(!/token|percent|%/i.test(code),
    "trends: no percentages or token claims, because neither is measured");
  const dash = readFileSync("src/components/app/OwnerDashboard.tsx", "utf8");
  for (const key of ["trends.members", "trends.active", "trends.invitations", "trends.requests"]) {
    assert(dash.includes(`{${key}}`), `trends: the ${key.split(".")[1]} tile shows its line`);
  }
}
