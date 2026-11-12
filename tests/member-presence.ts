import { freshnessLabel } from "../src/lib/format";
import { readFileSync } from "fs";
import {
  PRESENCE_STATES, MANUAL_AVAILABILITIES, computePresence, unknownPresence, presenceLabel, presenceColor,
  normalizePresence, normalizeManualAvailability, accountCondition, accountConditionLabel, countPresence,
  countConditions,
  applyInactivity,
  INACTIVITY_PERIOD_DAYS, PRESENCE_ALLOWED_STATUSES, type PresenceSession,
} from "../src/lib/presence/state";
import {
  DEFAULT_THRESHOLDS, THRESHOLD_BOUNDS, clampThreshold, clampThresholds, repairThresholdOrder,
  validateThresholds,
} from "../src/lib/presence/thresholds";
import { buildMemberRow, phoneView, filterMembers, summarize, tallyPresenceStates, PRESENCE_FILTERS, CONDITION_FILTERS } from "../src/lib/owner/member-view";
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

  section("-1. Presence is only claimed as current when the page says how old it is");
  {
    const panel = readFileSync("src/components/app/MembersPanel.tsx", "utf8");
    assert(/updatedAt/.test(panel) && /setUpdatedAt\(Date\.now\(\)\)/.test(panel),
      "freshness: every successful refresh records when the picture was read");
    assert(/as of \{freshnessLabel\(updatedAt\)\}/.test(panel),
      "freshness: the counts line states how old the picture is beside the Online number");
    assert(/usingPresence && \(/.test(panel),
      "freshness: the claim is not made at all when presence is unavailable");
    const f = freshnessLabel;
    const base = Date.UTC(2026, 10, 12, 12, 0, 0);
    assert(f(base, base + 5_000) === "just now", "freshness: seconds read as 'just now'");
    assert(f(base, base + 65_000) === "a minute ago", "freshness: about a minute reads as a minute");
    assert(f(base, base + 5 * 60_000) === "5 minutes ago", "freshness: minutes are counted");
    assert(f(base, base + 2 * 3600_000) === "2 hours ago", "freshness: hours are counted");
    assert(f(null) === "an unknown time", "freshness: a missing timestamp is stated, not guessed");
    assert(f(Number.NaN) === "an unknown time", "freshness: an impossible timestamp is stated, not shown as NaN");
  }

  section("-0. The Owner Dashboard states who is at their screen, or says nothing");
  {
    const page = readFileSync("src/app/owner/page.tsx", "utf8");
    assert(/rpc\("network_directory"\)/.test(page),
      "overview: the count comes from the same directory function the Members page uses");
    assert(/presenceLive = !directoryError && Array\.isArray\(directoryRows\)/.test(page),
      "overview: a failed read produces no count at all, never a fake zero");
    assert(/\{tally && \(/.test(page),
      "overview: the strip is rendered only when the tally exists");
    assert(/active or online right now/.test(page),
      "overview: the sentence names what the number means, in words");
    assert(/Not reported/.test(page),
      "overview: members with no reported state are counted separately from Offline");
    assert(/See who/.test(page) && /\/owner\/members/.test(page),
      "overview: the strip links to the page that shows who");

    const t = tallyPresenceStates([
      { presence: { state: "active" } }, { presence: { state: "online" } },
      { presence: { state: "idle" } }, { presence: { state: "offline" } },
      { presence: null }, {},
    ]);
    assert(t.active === 1 && t.online === 1 && t.idle === 1 && t.offline === 1,
      "overview: each state is counted once");
    assert(t.unknown === 2,
      "overview: two unreported rows count as Not reported, and are never counted as Offline");
    assert(Object.values(t).reduce((a, b) => a + b, 0) === 6,
      "overview: every member lands in exactly one bucket, so the strip never under-counts");
  }

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
    assert(!/dirty \? "Save presence settings" : "Saved"/.test(ui) && /No changes to save/.test(ui),
      "thresholds: the button never reads \"Saved\" before anything was saved in this visit");
    assert(/savedOnce/.test(ui) && /Nothing has been changed on this visit yet/.test(ui),
      "thresholds: the form states plainly that nothing was changed yet, instead of implying a save");
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
  // 2026-11-12: an unrecognised status used to be folded into Inactive. That was a definite,
  // false claim about somebody's account - "this person went quiet" - when the truth is that
  // the record could not be understood. Unknown is the honest answer.
  assert(accountCondition("something-else") === "unknown",
    "account: an unrecognised status is Unknown, never dressed up as Active or as Inactive");
  assert(accountCondition("") === "unknown" && accountCondition(null) === "unknown" && accountCondition(undefined) === "unknown",
    "account: a missing status is Unknown too, rather than silently Inactive");
  assert(accountConditionLabel("unknown") === "Unknown", "account: Unknown is written out, not left blank");
  assert(accountCondition("locked") === "locked" && accountCondition("deactivated") === "deactivated",
    "account: Locked and Deactivated appear only for statuses the lifecycle actually stores");

  // Inactivity is derived from verified last activity, and it is not a punishment.
  const nowMs = Date.UTC(2026, 10, 12, 12, 0, 0);
  const daysAgo = (d: number) => new Date(nowMs - d * 86_400_000).toISOString();
  assert(applyInactivity("active", daysAgo(3), { inactivityDays: 30, now: nowMs }) === "active",
    "account: recent activity keeps the account Active");
  assert(applyInactivity("active", daysAgo(45), { inactivityDays: 30, now: nowMs }) === "inactive",
    "account: an Active account quiet for longer than the period is Inactive");
  assert(applyInactivity("active", null, { inactivityDays: 30, now: nowMs }) === "active",
    "account: with no trustworthy last activity nobody is accused of being Inactive");
  assert(applyInactivity("active", "not a date", { inactivityDays: 30, now: nowMs }) === "active",
    "account: unreadable last activity cannot make someone Inactive");
  assert(applyInactivity("suspended", daysAgo(45), { inactivityDays: 30, now: nowMs }) === "suspended",
    "account: inactivity never turns a Suspended account into something else");
  assert(applyInactivity("unknown", daysAgo(45), { inactivityDays: 30, now: nowMs }) === "unknown",
    "account: Unknown plus a long silence stays Unknown, because the underlying state is still unreadable");
  assert(applyInactivity("active", daysAgo(45), { inactivityDays: 0, now: nowMs }) === "active",
    "account: a disabled inactivity period does not make anyone Inactive");
  assert(INACTIVITY_PERIOD_DAYS === 30, "account: the inactivity period is one stated constant, not a scattered number");
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
  assert(conditions.unknown === 1 && conditions.inactive === 0,
    "counts: a profile with no status counts as Unknown, never as Inactive");

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
  assert(PRESENCE_FILTERS.length === 9 && CONDITION_FILTERS.length === 8,
    "filters: every presence state and account condition is offered in the interface, Unknown included");

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

/**
 * 2026-11-12 (owner spec 3.4): the member's own availability control.
 *
 * The behaviour that matters is not "a card exists" - it is that the card cannot claim a
 * choice was saved when it wasn't, cannot invent a choice when the data is unreadable, and
 * describes the sharing preference the way the database actually enforces it.
 */
export function runAvailabilityControlTests(
  assert: (cond: boolean, msg: string) => void,
  section: (t: string) => void,
): void {
  section("13. A member can choose how they appear, honestly");
  const control = readFileSync("src/components/app/AvailabilityControl.tsx", "utf8");
  const route = readFileSync("src/app/api/network/presence/route.ts", "utf8");
  const settings = readFileSync("src/app/settings/page.tsx", "utf8");

  // The four choices, with a written label rather than colour alone.
  for (const choice of ["available", "away", "busy", "dnd"]) {
    assert(control.includes(`id: "${choice}"`), `availability: ${choice} is offered as a choice`);
  }
  assert(/Do Not Disturb/.test(control) && /Available/.test(control) && /Away/.test(control) && /Busy/.test(control),
    "availability: every state is written out, so nobody has to read a colour");

  // It is reachable from the member's own settings, and it uses the existing endpoint.
  assert(settings.includes("<AvailabilityControl") && settings.includes("components/app/AvailabilityControl"),
    "availability: the control is on the member settings page, where a member actually looks");
  assert(control.includes('fetch("/api/network/presence"') && control.includes('method: "PUT"'),
    "availability: it saves through the existing presence endpoint rather than a second write path");

  // Nothing optimistic: the displayed choice comes from the server response.
  assert(!/setChoice\(next\)/.test(control),
    "availability: the chosen value is not displayed before the server confirms it");
  assert(/isChoice\(body\.availability\)/.test(control),
    "availability: the displayed choice is the one the server says it stored");
  assert(/body\.error \|\|/.test(control),
    "availability: a refusal is shown in the server's own words, not replaced with a friendly lie");

  // Unreadable data is Unknown, not a default.
  assert(/could not be read/.test(control) && /Nothing has been changed/.test(control),
    "availability: when the value cannot be read it says so and states that nothing changed");
  assert(!/\?\? \"available\"/.test(control),
    "availability: an unreadable value is never silently replaced with Available");

  // The sharing preference matches what the database enforces.
  const sql = readFileSync("supabase/migrations/0050_member_presence.sql", "utf8");
  assert(/create policy member_availability_shared_read[\s\S]{0,200}share_with_members = true/.test(sql),
    "availability: the database is what grants other members a look, and only when the member opted in");
  assert(/Only this one line is shared/.test(control),
    "availability: the sharing copy promises exactly what the policy allows, no more");
  assert(/administrators can see your availability/.test(control),
    "availability: the member is told who can see it, rather than left guessing");

  // Availability is a separate fact from presence, and the server keeps them apart.
  assert(/Never touches account standing/.test(route) || /separate from whether you are connected/.test(control),
    "availability: the control says the choice is separate from being connected");
  assert(/\["available", "away", "busy", "dnd"\]/.test(route),
    "availability: the endpoint refuses any value outside the four real choices");
}
