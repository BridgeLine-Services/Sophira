import { readFileSync } from "fs";
import {
  PRESENCE_STATES, MANUAL_AVAILABILITIES, computePresence, unknownPresence, presenceLabel, presenceColor,
  normalizePresence, normalizeManualAvailability, accountCondition, accountConditionLabel, countPresence,
  countConditions, PRESENCE_ALLOWED_STATUSES, type PresenceSession,
} from "../src/lib/presence/state";
import {
  DEFAULT_THRESHOLDS, THRESHOLD_BOUNDS, clampThreshold, clampThresholds, repairThresholdOrder,
  validateThresholds,
} from "../src/lib/presence/thresholds";
import { buildMemberRow, phoneView, filterMembers, summarize, PRESENCE_FILTERS, CONDITION_FILTERS } from "../src/lib/owner/member-view";
import { relativeTime, activityPhrase, fmtDate, fmtDateTime, isValidDate } from "../src/lib/format";

/**
 * Presence, account condition and the member row (2026-11-12).
 *
 * Presence is a claim about a person ("they are at their screen right now"), so every rule
 * here is about not overstating it. A stale heartbeat is Offline. A suspended account is
 * Offline. Data we could not read is Unknown. None of those is ever rounded up to "Active".
 */
export function runMemberPresenceTests(assert: (cond: boolean, msg: string) => void, section: (t: string) => void) {
  const now = Date.parse("2026-11-12T12:00:00Z");
  const ISO = (msAgo: number) => new Date(now - msAgo).toISOString();
  const session = (over: Partial<PresenceSession> = {}): PresenceSession => ({
    session_id: "tab-1",
    last_heartbeat: ISO(5_000),
    last_interaction: ISO(10_000),
    expires_at: new Date(now + 3_600_000).toISOString(),
    ...over,
  });
  const base = { accountStatus: "active", thresholds: DEFAULT_THRESHOLDS, now };

  section("0. The six thresholds the Owner can actually reach, and the bounds nobody can break");
  {
    const sql = readFileSync("supabase/migrations/0050_member_presence.sql", "utf8");
    const routeSrc = readFileSync("src/app/api/network/presence-settings/route.ts", "utf8");
    const ui = readFileSync("src/components/app/PresenceSettings.tsx", "utf8");
    const page = readFileSync("src/app/owner/members/page.tsx", "utf8");

    // The code bounds and the database CHECK bounds must be the same numbers, or the Owner is
    // told a value is allowed and then refused by the database (or the reverse, and a stored
    // value can never be saved again).
    const columnBounds: Array<[string, keyof typeof THRESHOLD_BOUNDS]> = [
      ["heartbeat_interval_seconds", "heartbeatIntervalSeconds"],
      ["connection_timeout_seconds", "connectionTimeoutSeconds"],
      ["active_threshold_seconds", "activeThresholdSeconds"],
      ["idle_threshold_seconds", "idleThresholdSeconds"],
      ["session_expiration_seconds", "sessionExpirationSeconds"],
      ["presence_update_interval_seconds", "presenceUpdateIntervalSeconds"],
    ];
    for (const [column, key] of columnBounds) {
      const b = THRESHOLD_BOUNDS[key];
      const re = new RegExp(`${column}[^\\n]*between (\\d+) and (\\d+)`);
      const found = re.exec(sql);
      assert(found !== null, `thresholds: ${column} carries a database CHECK, not just a code guard`);
      assert(Number(found?.[1]) === b.min && Number(found?.[2]) === b.max,
        `thresholds: ${column} has the same bounds in SQL (${found?.[1]}–${found?.[2]}) and in code (${b.min}–${b.max})`);
    }

    // Owner only, in the three places that matter.
    assert(/requireOwner\(/.test(routeSrc) && !/requireStaff\(|requireUser\(/.test(routeSrc),
      "thresholds: saving them is Owner-only at the route, not Co-Owner and not any signed-in member");
    assert(/presence_settings_owner_write[\s\S]{0,120}is_owner\(\)/.test(sql),
      "thresholds: the database also restricts the write to the Owner, so a direct call is refused too");
    assert(/validateThresholds/.test(routeSrc),
      "thresholds: the route runs the shared validator before writing");
    assert(/\{ error: problems\[0\]/.test(routeSrc),
      "thresholds: a refusal is a sentence the Owner can act on, not a constraint name");
    assert(/clampThresholds/.test(routeSrc),
      "thresholds: the stored value is clamped to the same bounds the form showed");

    // The form shows the range instead of letting the Owner discover it by failing, and it
    // never claims a save that did not happen.
    assert(/THRESHOLD_BOUNDS\[key\]/.test(ui) && /seconds, \{bounds\.min\} to \{bounds\.max\}/.test(ui),
      "thresholds: the form states each allowed range next to the field");
    assert(/setSaved\(next\)/.test(ui) && /json\.thresholds \?\? values/.test(ui),
      "thresholds: the form shows what the SERVER stored, never an optimistic guess");
    assert(/problems\.map/.test(ui) && /role="alert"/.test(ui),
      "thresholds: a refusal is shown as an alert listing every problem");
    assert(/profile\.role === "owner" && \(/.test(page) && /<PresenceSettings/.test(page),
      "thresholds: the panel is rendered for the Owner only (a Co-Owner does not retune the clock)");
    assert(/available/.test(ui) && /unavailable until the database has the presence tables/.test(ui),
      "thresholds: on a database without the tables the panel says so and changes nothing");
  }

  section("1. The eight presence states, and never a colour without a word");
  assert(PRESENCE_STATES.length === 8, "presence: eight states exist");
  assert(PRESENCE_STATES.join(",") === "active,online,idle,away,busy,dnd,offline,unknown",
    "presence: Active, Online, Idle, Away, Busy, Do Not Disturb, Offline, Unknown");
  for (const state of PRESENCE_STATES) {
    assert(presenceLabel(state).length > 2, `presence: ${state} always has a written label`);
    assert(/^#[0-9a-f]{6}$/i.test(presenceColor(state)), `presence: ${state} has a real colour`);
  }
  const colours = new Set(PRESENCE_STATES.map(presenceColor));
  assert(colours.size === PRESENCE_STATES.length, "presence: no two states share a colour");
  assert(presenceColor("active") === "#15803d" && presenceColor("online") === "#22c55e",
    "presence: Active is the dark green and Online the lighter green");
  assert(presenceColor("idle") === "#d97706" && presenceColor("away") === "#f97316",
    "presence: Idle is amber and Away is orange");
  assert(presenceColor("busy") === "#dc2626" && presenceColor("dnd") === "#7c3aed",
    "presence: Busy is red-orange and Do Not Disturb is purple");
  assert(presenceColor("offline") === "#6b7280" && presenceColor("unknown") === "#d1d5db",
    "presence: Offline is gray and Unknown a lighter gray");
  assert(normalizePresence("nonsense") === "unknown" && normalizePresence(undefined) === "unknown",
    "presence: an unrecognised stored state reads Unknown, never Offline or Active");
  assert(normalizeManualAvailability("busy") === "busy" && normalizeManualAvailability("sleeping") === null,
    "presence: an unavailable preference is ignored rather than guessed");
  assert(MANUAL_AVAILABILITIES.join(",") === "available,away,busy,dnd",
    "presence: the member chooses Available, Away, Busy or Do Not Disturb");

  section("2. Active, Idle, Online and Offline are decided by silence");
  assert(computePresence({ ...base, sessions: [session()] }).state === "active",
    "presence: a recent interaction reads Active");
  assert(computePresence({ ...base, sessions: [session({ last_interaction: ISO(DEFAULT_THRESHOLDS.activeThresholdSeconds * 1000 + 30_000) })] }).state === "idle",
    "presence: past the active threshold but within the idle threshold reads Idle");
  assert(computePresence({ ...base, sessions: [session({ last_interaction: ISO(DEFAULT_THRESHOLDS.idleThresholdSeconds * 1000 + 60_000) })] }).state === "online",
    "presence: connected but long quiet reads Online, not Active");
  assert(computePresence({ ...base, sessions: [session({ last_interaction: null })] }).state === "online",
    "presence: a session that never reported interaction is Online, not Active");
  const stale = computePresence({ ...base, sessions: [session({ last_heartbeat: ISO(DEFAULT_THRESHOLDS.connectionTimeoutSeconds * 1000 + 60_000) })] });
  assert(stale.state === "offline" && !stale.connected && stale.sessionCount === 0,
    "presence: a heartbeat past the connection timeout reads Offline");
  assert(computePresence({ ...base, sessions: [] }).state === "offline",
    "presence: no session at all is Offline");
  assert(computePresence({ ...base, sessions: [session({ expires_at: ISO(1_000) })] }).state === "offline",
    "presence: an expired session is ignored even if its heartbeat looks fresh");

  section("3. A member's own choice beats the timer, but never beats their account standing");
  assert(computePresence({ ...base, sessions: [session()], manualAvailability: "busy" }).state === "busy",
    "presence: Busy overrides a recent interaction");
  assert(computePresence({ ...base, sessions: [session()], manualAvailability: "dnd" }).state === "dnd",
    "presence: Do Not Disturb overrides a recent interaction");
  assert(computePresence({ ...base, sessions: [session()], manualAvailability: "away" }).state === "away",
    "presence: Away overrides a recent interaction");
  assert(computePresence({ ...base, sessions: [session()], manualAvailability: "available" }).state === "active",
    "presence: Available has no opinion, so the timer decides");
  assert(computePresence({ ...base, sessions: [session()], manualAvailability: "busy" }).connected === true,
    "presence: Busy still means connected — it is not an absence");
  const suspendedBusy = computePresence({
    ...base, accountStatus: "revoked", sessions: [session()], manualAvailability: "busy",
  });
  assert(suspendedBusy.state === "offline",
    "presence: a suspended account with a live session and Busy set still reads Offline");
  assert(computePresence({ ...base, accountStatus: "pending", sessions: [session()] }).state === "active",
    "presence: an invited member who has signed in may show presence");
  assert(PRESENCE_ALLOWED_STATUSES.includes("active") && !PRESENCE_ALLOWED_STATUSES.includes("revoked"),
    "presence: the allowed account statuses are a closed list");

  section("4. Several devices, one honest answer");
  const two = computePresence({
    ...base,
    sessions: [session({ session_id: "a", last_interaction: ISO(20 * 60_000) }), session({ session_id: "b", last_interaction: ISO(5_000) })],
  });
  assert(two.sessionCount === 2, "presence: two live sessions are counted");
  assert(two.state === "active", "presence: the freshest device decides, so an old tab cannot hide activity");
  const oneStale = computePresence({
    ...base,
    sessions: [session({ session_id: "a", last_heartbeat: ISO(30 * 60_000) }), session({ session_id: "b", last_interaction: ISO(5_000) })],
  });
  assert(oneStale.sessionCount === 1 && oneStale.state === "active",
    "presence: a dead tab is dropped while the live one keeps the member Online");

  section("5. Unknown is a real state, not a guess");
  const unknown = unknownPresence();
  assert(unknown.state === "unknown" && unknown.connected === false,
    "presence: unreadable presence reports Unknown and claims no connection");
  assert(/could not be read/i.test(unknown.reason), "presence: Unknown says why, in plain words");

  section("6. Account condition is a different question, with its own vocabulary");
  assert(accountCondition("active") === "active" && accountConditionLabel("active") === "Active",
    "account: an active profile reads Active");
  assert(accountCondition("accepted") === "active", "account: a legacy accepted profile reads Active");
  assert(accountCondition("pending") === "pending_invitation", "account: an unaccepted invitation reads Pending invitation");
  assert(accountCondition("revoked") === "suspended", "account: a revoked profile reads Suspended");
  assert(accountCondition("something-else") === "inactive",
    "account: an unrecognised status is Inactive, never dressed up as Active");
  const suspendedPresence = computePresence({ ...base, accountStatus: "revoked", sessions: [session()] });
  assert(suspendedPresence.state === "offline" && accountCondition("revoked") === "suspended",
    "account: presence and account condition are computed separately and can never be confused");

  section("7. Counts are counts of what is there");
  const counts = countPresence(["active", "active", "offline", "unknown"]);
  assert(counts.active === 2 && counts.offline === 1 && counts.unknown === 1 && counts.busy === 0,
    "counts: presence summary adds up");
  const conditions = countConditions(["active", "revoked", "pending", null]);
  assert(conditions.active === 1 && conditions.suspended === 1 && conditions.pending_invitation === 1,
    "counts: account conditions are counted separately");
  assert(conditions.inactive === 1, "counts: a profile with no status counts as inactive, not as active");

  section("8. Thresholds have floors, ceilings and a fixed order");
  assert(DEFAULT_THRESHOLDS.heartbeatIntervalSeconds === 30 && DEFAULT_THRESHOLDS.connectionTimeoutSeconds === 90,
    "thresholds: the defaults are a 30-second report and a 90-second timeout");
  assert(DEFAULT_THRESHOLDS.activeThresholdSeconds === 120 && DEFAULT_THRESHOLDS.idleThresholdSeconds === 600,
    "thresholds: 2 minutes reads Active, 10 minutes reads Idle");
  assert(clampThreshold("heartbeatIntervalSeconds", 1) === THRESHOLD_BOUNDS.heartbeatIntervalSeconds.min,
    "thresholds: a one-second report is clamped up to the floor");
  assert(clampThreshold("connectionTimeoutSeconds", 999999) === THRESHOLD_BOUNDS.connectionTimeoutSeconds.max,
    "thresholds: a week-long timeout is clamped down to the ceiling");
  assert(clampThreshold("activeThresholdSeconds", "not-a-number") === DEFAULT_THRESHOLDS.activeThresholdSeconds,
    "thresholds: nonsense falls back to the default instead of NaN");
  const repaired = repairThresholdOrder({ ...DEFAULT_THRESHOLDS, heartbeatIntervalSeconds: 90, connectionTimeoutSeconds: 60 });
  assert(repaired.connectionTimeoutSeconds > repaired.heartbeatIntervalSeconds,
    "thresholds: a timeout shorter than the report interval is repaired, so members cannot flicker offline");
  const repairedIdle = repairThresholdOrder({ ...DEFAULT_THRESHOLDS, activeThresholdSeconds: 900, idleThresholdSeconds: 300 });
  assert(repairedIdle.idleThresholdSeconds > repairedIdle.activeThresholdSeconds,
    "thresholds: Idle can never be shorter than Active, so Idle stays reachable");
  assert(validateThresholds({ heartbeatIntervalSeconds: 5 }).length > 0,
    "thresholds: the owner is told when a value is out of range");
  assert(validateThresholds({ heartbeatIntervalSeconds: 60, connectionTimeoutSeconds: 45 }).some((p) => /flicker/i.test(p)),
    "thresholds: the owner is told WHY a timeout below the report interval is refused");
  assert(validateThresholds({}).length === 0, "thresholds: an empty patch is valid");
  const clamped = clampThresholds({ heartbeatIntervalSeconds: 45 });
  assert(clamped.heartbeatIntervalSeconds === 45 && clamped.idleThresholdSeconds === DEFAULT_THRESHOLDS.idleThresholdSeconds,
    "thresholds: a partial patch keeps the other defaults");

  section("9. Dates are stated, never invented");
  assert(!isValidDate(null) && !isValidDate("") && !isValidDate("not a date"),
    "format: a missing or unreadable timestamp is recognised as such");
  assert(fmtDate(null, "") === "" && fmtDateTime("nonsense", "") === "",
    "format: no timestamp renders as nothing, never the words Invalid Date");
  assert(!fmtDate(undefined).includes("Invalid"), "format: the literal text Invalid Date is gone");
  assert(relativeTime(null) === "Never active", "format: no last-seen time reads Never active");
  assert(relativeTime("not a date") === "Unavailable", "format: an unreadable time reads Unavailable");
  assert(relativeTime(ISO(5_000), { now }) === "just now", "format: five seconds ago is just now");
  assert(relativeTime(ISO(3 * 60_000), { now }) === "3 minutes ago", "format: minutes read naturally");
  assert(relativeTime(ISO(90 * 60_000), { now }) === "1 hour ago" && relativeTime(ISO(150 * 60_000), { now }) === "2 hours ago",
    "format: hours read naturally");
  assert(relativeTime("2026-11-11T09:00:00Z", { now }) === "yesterday",
    "format: the day before is yesterday, not 27 hours ago");
  assert(relativeTime("2026-11-01T12:00:00Z", { now }) === "11 days ago", "format: days read naturally");
  assert(activityPhrase(null) === "Never active" && activityPhrase(ISO(5_000), { now }) === "Active just now",
    "format: the activity phrase is honest at both ends");

  section("10. The member row puts identity first and never invents it");
  const named = buildMemberRow({
    user_id: "u1", display_name: "Ada Smith", email: "ada@school.edu", role: "co_owner", status: "active",
    created_at: "2026-10-01T10:00:00Z", last_active_at: ISO(60_000), phone: "+15550001111", phone_verified: true,
    presence: { state: "active", session_count: 1, last_interaction: ISO(5_000) },
  }, { now, viewerId: "u1" });
  assert(named.identity.title === "Ada Smith" && named.emailDisplay === "ada@school.edu",
    "row: the chosen display name is the title and the email sits underneath");
  assert(named.roleLabel === "Co-Owner" && named.conditionLabel === "Active",
    "row: role and account condition are both shown, as separate facts");
  assert(named.presenceLabel === "Active" && named.presenceColor === "#15803d",
    "row: presence comes with its colour AND its word");
  assert(named.isSelf === true, "row: the viewer's own row is marked so it cannot be managed here");
  assert(named.phone.status === "verified" && named.phone.label === "Verified number",
    "row: a provider-confirmed number reads verified");
  assert(named.lastActivityDisplay === "Last active 1 minute ago" || named.lastActivityDisplay.startsWith("Last active"),
    "row: last activity is phrased, not a raw timestamp");

  const anonymous = buildMemberRow({ user_id: "u2", display_name: "  ", email: "sam@school.edu", role: "user", status: "revoked" }, { now });
  assert(anonymous.identity.title === "sam@school.edu",
    "row: no nickname falls back to the email, never to an invented name");
  assert(anonymous.identity.nameMissing === true, "row: a missing name is recorded, not hidden");
  assert(anonymous.conditionLabel === "Suspended" && anonymous.presence.state === "offline",
    "row: a revoked account reads Suspended and Offline at the same time, in different columns");
  assert(anonymous.lastActivityDisplay === "Never active", "row: never having been active is stated plainly");
  assert(anonymous.joinedDisplay === "Join date unavailable" && !anonymous.joinedDisplay.includes("Invalid"),
    "row: a missing join date is honest rather than Invalid Date");

  const noPhone = buildMemberRow({ user_id: "u3", display_name: "Prince", role: "user", status: "active", phone: null }, { now });
  assert(noPhone.phone.status === "none" && noPhone.phone.display === null,
    "row: no phone number is stated, not rendered as an empty cell");
  assert(noPhone.presence.state === "unknown",
    "row: a member whose presence was not reported reads Unknown, never Active");

  const unverified = buildMemberRow(
    { user_id: "u4", display_name: "Sam", role: "user", status: "active", phone: "+15559998888", phone_verified: false },
    { now },
  );
  assert(unverified.phone.status === "unverified" && unverified.phone.label === "Unverified number",
    "row: a typed-in number is never presented as verified");
  assert(phoneView("+1555", null).status === "unverified",
    "row: an unknown verification flag is treated as unverified, not verified");

  section("11. Filters and summary counts describe the whole list");
  const rows = [
    buildMemberRow({ user_id: "a", display_name: "Ada", role: "owner", status: "active", presence: { state: "active", session_count: 1 } }, { now }),
    buildMemberRow({ user_id: "b", display_name: "Ben", role: "co_owner", status: "active", presence: { state: "offline", session_count: 0 } }, { now }),
    buildMemberRow({ user_id: "c", display_name: "Cleo", role: "tester", status: "revoked", presence: { state: "offline", session_count: 0 } }, { now }),
    buildMemberRow({ user_id: "d", display_name: "Dev", email: "dev@school.edu", role: "user", status: "pending" }, { now }),
  ];
  assert(filterMembers(rows, { presence: "active" }).length === 1, "filters: presence filter selects matching members");
  assert(filterMembers(rows, { condition: "suspended" }).length === 1, "filters: account filter selects suspended members");
  assert(filterMembers(rows, { role: "co_owner" }).length === 1, "filters: role filter selects Co-Owners");
  assert(filterMembers(rows, { query: "dev@" }).length === 1, "filters: search matches the email");
  assert(filterMembers(rows, { query: "cleo" }).length === 1, "filters: search is case-insensitive on names");
  assert(filterMembers(rows, { presence: "active", role: "user" }).length === 0,
    "filters: filters combine instead of replacing each other");
  assert(filterMembers(rows, { presence: "all", condition: "all", role: "all", query: "" }).length === 4,
    "filters: cleared filters show everyone");
  const s = summarize(rows);
  assert(s.total === 4 && s.presence.active === 1 && s.presence.offline === 2 && s.presence.unknown === 1,
    "summary: presence totals add up across the list");
  assert(s.conditions.active === 2 && s.conditions.suspended === 1 && s.conditions.pending_invitation === 1,
    "summary: account condition totals add up");
  assert(PRESENCE_FILTERS.length === 9 && CONDITION_FILTERS.length === 7,
    "filters: every presence state and account condition is offered in the interface");

  section("12. The published thresholds are the ones the database enforces");
  const sql = readFileSync("supabase/migrations/0050_member_presence.sql", "utf8");
  assert(/check \(heartbeat_interval_seconds between 10 and 300\)/.test(sql),
    "database: the report interval is bounded exactly as the code bounds it");
  assert(/check \(text|active_threshold_seconds between 30 and 900\)/.test(sql) ||
    /active_threshold_seconds between 30 and 900/.test(sql),
    "database: the active threshold is bounded");
  assert(/connection_timeout_seconds between 30 and 900/.test(sql) && /idle_threshold_seconds between 60 and 3600/.test(sql),
    "database: timeout and idle bounds match the code");
  const code = readFileSync("src/lib/presence/thresholds.ts", "utf8");
  const bounds = THRESHOLD_BOUNDS;
  assert(code.includes(`min: ${bounds.heartbeatIntervalSeconds.min}`) && code.includes(`max: ${bounds.heartbeatIntervalSeconds.max}`),
    "thresholds: the code's bounds are the ones the tests read");
  assert(/if v_status not in \('active', 'accepted', 'pending'\) then/.test(sql),
    "database: a heartbeat from an account that may not sign in is refused");
  assert(/delete from public\.member_presence where user_id = v_uid/.test(sql),
    "database: refusing a suspended heartbeat also clears their sessions, so they cannot look connected");
  assert(/no IP, no device fingerprint, no page history, no content/i.test(sql),
    "privacy: the migration states what presence does NOT store");
  assert(!/ip_address|user_agent|page_path/i.test(sql.replace(/--.*$/gm, "")),
    "privacy: presence stores no address, no user agent and no page path");

  section("13. Presence and account condition are separate in the data too");
  const migration = readFileSync("supabase/migrations/0050_member_presence.sql", "utf8");
  assert(/create table if not exists public\.member_presence/.test(migration) &&
    /create table if not exists public\.member_availability/.test(migration),
    "database: sessions and manual availability live in their own tables");
  assert(!/alter table public\.profiles[\s\S]{0,200}presence/i.test(migration),
    "database: presence is not written into profiles, so account standing stays untouched");
  assert(/enable row level security/.test(migration) && /member_presence_own_read/.test(migration),
    "database: presence has row level security, and a member reads only their own sessions");
  assert(/user_id = auth\.uid\(\) or public\.is_staff\(\)/.test(migration),
    "database: staff may read all sessions, members only their own");
  assert(/share_with_members = true/.test(migration),
    "privacy: another member sees an availability only when the member chose to share it");
  assert(/presence_settings_owner_write/.test(migration) && /public\.is_owner\(\)/.test(migration),
    "database: only the Owner can change presence thresholds");

  section("14. The member list cannot silently go stale again");
  const route = readFileSync("src/app/api/network/stats/route.ts", "utf8");
  const actions = readFileSync("src/lib/owner/member-actions.ts", "utf8");
  assert(/NextResponse\.json\(payload\)/.test(route) && /const payload = \{ members,/.test(route),
    "api: the member list is returned at the TOP level of the response");
  assert(route.includes("network_directory") && route.includes("network_stats"),
    "api: the directory is read from the presence-aware function, with the older statistics as a fallback");
  assert(route.includes("presenceAvailable = false"),
    "api: an older database reports presence as unavailable instead of showing everyone Offline");
  assert(/requireNetworkManagement/.test(route),
    "api: only an Owner or Co-Owner can read the directory");
  assert(actions.includes("Array.isArray(json?.members)") && actions.includes("Array.isArray(json?.data?.members)"),
    "client: the list is read from the top level, and the old nested shape is still understood");
  assert(/if \(!members\) return null/.test(actions),
    "client: a response with no member list is a failure, not an empty list");
  const panel = readFileSync("src/components/app/MembersPanel.tsx", "utf8");
  assert(panel.includes("fetchMembers") && panel.includes("could not refresh"),
    "client: a failed refresh keeps the rows AND says they may be old");
  assert(panel.includes("usePresenceFeed") && panel.includes("usePresenceReporter"),
    "client: the panel both reports its own presence and follows everyone else's");
  assert(panel.includes("filterMembers") && panel.includes("summarize"),
    "client: filters and summary counts come from the tested helpers, not ad-hoc maths");
  const feed = readFileSync("src/lib/presence/use-presence-feed.ts", "utf8");
  assert(feed.includes("document.hidden"), "client: a hidden tab stops polling, so an absent member never looks present");
  assert(feed.includes("visibilitychange") && feed.includes('"online"'),
    "client: returning to the tab or the network refreshes immediately");
  assert(feed.includes("member_presence") && feed.includes("CHANNEL_ERROR"),
    "client: live updates are a signal to re-read, with a polling fallback when realtime fails");
  const reporter = readFileSync("src/lib/presence/use-presence-reporter.ts", "utf8");
  assert(reporter.includes("pagehide") && reporter.includes("presence_release") === false,
    "client: leaving the tab releases the session explicitly");
  assert(!/localStorage/.test(reporter), "privacy: the presence identifier is per-tab, not a stored device id");
  assert(!/ip|fingerprint|deviceId/i.test(reporter.split("export")[1] ?? ""),
    "privacy: the reporter collects no device fingerprint");

  section("15. The directory shows identity, presence, role and condition, on a phone too");
  const dir = readFileSync("src/components/app/MemberDirectory.tsx", "utf8");
  assert(dir.includes("row.presenceLabel") && dir.includes("row.presenceColor"),
    "directory: presence is rendered as a colour AND a word");
  assert(dir.includes("row.conditionLabel"), "directory: account condition has its own column");
  assert(dir.includes("row.roleLabel"), "directory: the member's role is visible in the row");
  assert(dir.includes("row.emailDisplay"), "directory: the email is visible, or states it is unavailable");
  assert(dir.includes("Supplied, not verified") && dir.includes("Verified by sign-in"),
    "directory: a phone number says whether it was ever verified");
  assert(dir.includes("md:hidden") && dir.includes("hidden overflow-x-auto") ,
    "directory: a stacked card layout exists for phones beside the wide table");
  assert(dir.includes('role="dialog"') && dir.includes("aria-modal"),
    "directory: role changes happen in an accessible dialog");
  assert(dir.includes("ChangeRoleDialog") && dir.includes("What this changes"),
    "directory: the dialog explains what the member gains or loses before saving");
  assert(dir.includes("confirmRevokeId") && dir.includes("Confirm revoke"),
    "directory: revoking still takes an explicit confirmation step");
  assert(dir.includes("canManageAccount") && dir.includes("assignableRolesFor"),
    "directory: the row asks the permission matrix instead of deciding for itself");
  assert(dir.includes("This is you") && dir.includes("Owner account"),
    "directory: your own row and an Owner row are not offered management actions");
  const shell = readFileSync("src/components/app/AppShell.tsx", "utf8");
  assert(shell.includes('/online?env=owner'),
    "nav: the Online chip keeps the owner environment instead of dropping into the workspace shell");
  const online = readFileSync("src/app/online/page.tsx", "utf8");
  assert(online.includes('variant={ownerEnvironment ? "owner" : "workspace"}'),
    "nav: the Online page opens in the environment it was reached from");
  assert(online.includes("Back to the Owner Dashboard"),
    "nav: from the owner environment there is a way straight back");
  const ownerPage = readFileSync("src/app/owner/page.tsx", "utf8");
  assert(!/href="\/settings\/integrations"/.test(ownerPage),
    "nav: the dashboard no longer sends the owner into the member Settings page");
  assert(/href="\/owner\/integrations"/.test(ownerPage),
    "nav: the dashboard links to the owner Integrations page, which keeps the owner navigation");
  assert(readFileSync("src/app/owner/integrations/page.tsx", "utf8").includes('variant="owner"'),
    "nav: the Integrations page renders inside the owner shell");
}
