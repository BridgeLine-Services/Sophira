import { readFileSync } from "fs";

/**
 * DEPLOYMENT ORDER (2026-11-12).
 *
 * The app is deployed by a push; the database is updated when the Owner presses a
 * button. Those two events are not simultaneous, so for some minutes the new code runs
 * against a database that does not yet have the newest tables. That window is not an
 * error state to hide — it is a real state that must be described honestly.
 *
 * The rule this file pins: the new code must DEGRADE, never invent. No presence label
 * may be fabricated, no settings form may claim to be live, and no page may fail to
 * render, just because the migration has not been applied yet.
 *
 * Verified against the live database on 2026-11-11: the four new tables were absent,
 * which is exactly the state this file protects.
 */
export function runDeploymentOrderTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
) {
  const roster = readFileSync("src/lib/owner/roster.ts", "utf8");
  const page = readFileSync("src/app/owner/members/page.tsx", "utf8");
  const panel = readFileSync("src/components/app/MembersPanel.tsx", "utf8");
  const settings = readFileSync("src/components/app/PresenceSettings.tsx", "utf8");
  const route = readFileSync("src/app/api/network/presence-settings/route.ts", "utf8");
  const heartbeat = readFileSync("src/app/api/network/presence/route.ts", "utf8");

  section("1. A database without the presence tables still renders the member list");
  assert(/supabase\.rpc\("network_directory"\)/.test(roster),
    "deploy order: the directory function is the primary read");
  assert(/if \(!directoryError && Array\.isArray\(directory\)\)/.test(roster),
    "deploy order: a missing directory function is treated as a state, not thrown");
  assert(/presenceAvailable = false/.test(roster) && /supabase\.rpc\("network_stats"\)/.test(roster),
    "deploy order: it falls back to network_stats so the list still loads");
  assert(/Presence is not available from this database yet/.test(roster),
    "deploy order: the fallback says presence is unavailable in plain words");
  assert(!/state: "unknown"[\s\S]{0,80}fallback/.test(roster),
    "deploy order: the fallback does not fabricate a presence state");

  section("2. Nothing claims to be live before it is");
  assert(/presenceAvailable=True|presenceAvailable=\{presenceAvailable\}/.test(page),
    "deploy order: the page passes the real availability down to both surfaces");
  assert(/available=\{presenceAvailable\}/.test(page),
    "deploy order: the settings box is told when presence is unavailable");
  assert(/unavailable until the database has the presence tables/.test(settings),
    "deploy order: the settings box states the reason and changes nothing");
  assert(/presence could not be read|could not refresh the member list/i.test(panel),
    "deploy order: the directory panel reports a failed refresh instead of showing stale rows");

  section("3. The endpoints answer instead of crashing");
  assert(/presence: "unavailable"/.test(heartbeat),
    "deploy order: a heartbeat against an older database answers 'unavailable', not a 500");
  assert(!/throw /.test(heartbeat.split("export async function POST")[1]?.split("export async function DELETE")[0] ?? ""),
    "deploy order: the heartbeat path does not throw on a missing function");
  assert(/data \? clampThresholds\(readRow/.test(route),
    "deploy order: missing threshold rows return the published defaults rather than an error page");
  assert(/said|error: problems\[0\]/.test(route),
    "deploy order: a refused save is a sentence, so the Owner is never left guessing");

  section("4. A refused heartbeat is not retried forever");
  {
    const reporter = readFileSync("src/lib/presence/use-presence-reporter.ts", "utf8");
    assert(/stopped = true/.test(reporter) && /presence === "unavailable"/.test(reporter)
        && /res\.status === 403/.test(reporter),
      "deploy order: the tab stops reporting when the server says presence cannot be recorded, or refuses the account");
    assert(/clearInterval\(state\.timer\)/.test(reporter),
      "deploy order: it clears its own interval, so an old database is not polled every 30s per tab");
    assert(/\.catch\(\(\) => \{/.test(reporter) && /if \(body\?\.ok === true\) state\.lastSent = Date\.now\(\)/.test(reporter),
      "deploy order: a genuine network failure is still swallowed, and a failed call is never recorded as a successful beat");
  }

  section("5. The owner is told what to press, in their own words");
  const ownerDoc = readFileSync("docs/WHAT_I_NEED_TO_DO_NEXT.md", "utf8");
  assert(/Update database/.test(ownerDoc),
    "deploy order: the owner checklist names the exact button");
  assert(/\/owner\/database/.test(ownerDoc) && /\/owner\/members/.test(ownerDoc),
    "deploy order: it names both click-by-click addresses");
  // 2026-11-11: this used to pin the literal "50 of 50 pieces are in place", which went stale the
  // moment the chain grew - a stale pin says nothing about the owner's experience. What matters is
  // that the checklist quotes the page's own success line and the words it uses.
  assert(/Up to date/.test(ownerDoc) && /pieces are in place/.test(ownerDoc),
    "deploy order: it says what success looks like, in the page's own wording");
  assert(/Do not paste your password or any key/.test(ownerDoc),
    "deploy order: it repeats the secret-handling rule where it is needed");
}
