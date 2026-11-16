import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_REQUIREMENTS, REQUIREMENT_STATUSES } from "../src/lib/governance/product-spec";
import {
  ACTIVITY_THROTTLE_SECONDS, ACTIVITY_THROTTLE_MS, ACTIVITY_OUTCOMES, isActivityOutcome,
  shouldRecordActivity, nextActivityValue, describeActivityOutcome, activitySummaryLines,
} from "../src/lib/presence/activity";

/**
 * LAST ACTIVE AND LIVE PRESENCE (2026-11-15).
 *
 * The Owner reported the exact symptom this file exists to prevent: presence said Active, the
 * heartbeat was running, and Last Active said four days ago. Both numbers were true of
 * different columns, and only one column was ever being fed.
 *
 * So the rules pinned here are about honesty first:
 *   - a meaningful interaction advances the account record, and nothing else does;
 *   - the write is throttled atomically, so eight tabs cannot produce eight writes;
 *   - the identity comes from auth.uid() and can never be supplied by the browser;
 *   - a failure is reported as a failure, never as a write that did not happen;
 *   - presence and account activity stay two separate answers, not one blended one.
 *
 * These are source-level and pure-function assertions. They prove what the code and the
 * migration SAY and DECIDE; a live signed-in pass is still required to prove the deployed
 * behaviour, and that is reported separately rather than claimed here.
 */
export function runDashboardActivityTests(assert: (cond: boolean, msg: string) => void, section: (t: string) => void) {
  const ROOT = join(__dirname, "..", "..");
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  const migration = read("supabase/migrations/0060_member_activity_sync.sql");
  const original = read("supabase/migrations/0050_member_presence.sql");
  const route = read("src/app/api/network/presence/route.ts");
  const dashboard = read("src/app/dashboard/page.tsx");
  const markers = read("scripts/migration-markers.mjs");
  const directory = read("supabase/migrations/0051_directory_privacy_and_staff_invitations.sql");

  /** The part of 0060 that is the function body, so comments cannot satisfy an assertion. */
  const fnBody = migration.slice(migration.indexOf("create or replace function public.presence_heartbeat"));

  section("1. A meaningful interaction advances the account record");
  {
    assert(/create or replace function public\.presence_heartbeat/.test(migration),
      "0060 replaces the existing heartbeat rather than adding a second way to be present");
    assert(/update public\.profiles\s+set last_active_at = now\(\)/.test(migration),
      "the heartbeat writes the caller's own last_active_at");
    assert(/where id = v_uid/.test(fnBody),
      "the row written is the authenticated caller's, taken from auth.uid() inside the function");
    assert(/v_uid uuid := auth\.uid\(\)/.test(fnBody),
      "identity comes from auth.uid(), not from an argument");
    assert(!/p_user_id|p_profile_id|p_target_user/.test(fnBody),
      "no function parameter lets a browser name whose profile is written");
    assert(/if coalesce\(p_interacted, false\) then/.test(fnBody),
      "only a claimed meaningful interaction can advance the timestamp");
  }

  section("2. A passive heartbeat does not advance the account record");
  {
    const upsert = fnBody.indexOf("insert into public.member_presence");
    const gate = fnBody.indexOf("if coalesce(p_interacted, false) then");
    const update = fnBody.indexOf("update public.profiles");
    assert(upsert > -1 && gate > upsert && update > gate,
      "the session is written first, unconditionally; the profile only inside the interaction gate");
    assert(/last_interaction = case when coalesce\(p_interacted, false\) then now\(\)\s+else public\.member_presence\.last_interaction end/.test(fnBody),
      "a non-interacting beat keeps the previous interaction time instead of inventing one");
    assert(/v_activity text := 'idle'/.test(fnBody),
      "a beat with no interaction claimed starts, and stays, 'idle'");
  }

  section("3. Repeated interactions inside the window do not write again");
  {
    assert(new RegExp(`interval '${ACTIVITY_THROTTLE_SECONDS} seconds'`).test(migration),
      `the database window is ${ACTIVITY_THROTTLE_SECONDS} seconds, matching the shared constant`);
    assert(ACTIVITY_THROTTLE_MS === ACTIVITY_THROTTLE_SECONDS * 1000,
      "the millisecond constant is derived from the second constant, not typed twice");
    assert(/last_active_at is null or last_active_at <= now\(\) - v_window/.test(fnBody),
      "the throttle is the WHERE clause, so it is atomic under concurrent tabs");
    assert(/if found then\s+v_activity := 'recorded';\s+else\s+v_activity := 'throttled';/.test(fnBody),
      "the outcome distinguishes a real write from one the throttle skipped");
    const updateBlock = fnBody.slice(fnBody.indexOf("update public.profiles"), fnBody.indexOf("exception when others"));
    assert(!/p_session_id/.test(updateBlock),
      "the profile write is per member, not per tab, so multiple sessions cannot multiply it");

    const now = Date.parse("2026-11-15T12:00:00Z");
    assert(shouldRecordActivity(null, now) === true, "a member with no recorded activity gets their first write");
    assert(shouldRecordActivity(undefined, now) === true, "a missing value is treated like never recorded");
    assert(shouldRecordActivity("not a date", now) === true, "an unreadable value is repaired rather than frozen");
    assert(shouldRecordActivity(new Date(now - 30_000).toISOString(), now) === false, "30 seconds ago is inside the window");
    assert(shouldRecordActivity(new Date(now - 59_000).toISOString(), now) === false, "59 seconds ago is inside the window");
  }

  section("4. An interaction after the window advances the timestamp");
  {
    const now = Date.parse("2026-11-15T12:00:00Z");
    assert(shouldRecordActivity(new Date(now - 60_000).toISOString(), now) === true, "exactly one minute is old enough");
    assert(shouldRecordActivity(new Date(now - 4 * 86_400_000).toISOString(), now) === true,
      "four days stale is exactly the Owner's report: the next interaction must write");
    assert(shouldRecordActivity(new Date(now + 90_000).toISOString(), now) === true,
      "a future value (clock skew) is repaired on the next interaction instead of blocking writes forever");
    assert(shouldRecordActivity(new Date(now - 60_000).toISOString(), Number.NaN) === false,
      "with no reliable clock, nothing is written rather than a guessed time");
    const value = nextActivityValue(new Date(now - 120_000).toISOString(), now);
    assert(value === new Date(now).toISOString(), "the value offered for writing is the interaction time");
    assert(nextActivityValue(new Date(now - 1_000).toISOString(), now) === null,
      "nothing is offered for writing inside the window");
  }

  section("5. A user cannot update another user's timestamp");
  {
    assert(/security definer/.test(fnBody), "the function is SECURITY DEFINER, so it is not the caller's row-level access that decides");
    assert(/set search_path = public, pg_temp/.test(fnBody), "the definer function pins its search path, as 0050 already did");
    assert((fnBody.match(/where id = v_uid/g) ?? []).length >= 1, "the only row predicate is the authenticated identity");
    assert(!/where id = \$|where id = p_/.test(fnBody), "no argument can become the row predicate");
    assert(/revoke all on function public\.presence_heartbeat\(text, boolean\) from public, anon;/.test(fnBody),
      "the replacement revokes the same grantees 0050 revoked");
    assert(/grant execute on function public\.presence_heartbeat\(text, boolean\) to authenticated;/.test(fnBody),
      "execute is granted to authenticated only, exactly as before");
    assert(!/grant[^;]*to anon/i.test(migration), "nothing in 0060 is granted to anon");
    assert(!/grant[^;]*service_role/i.test(migration), "no new service-role power is introduced");
  }

  section("6. A suspended account cannot establish presence or activity");
  {
    const refusal = fnBody.indexOf("account not permitted");
    const upsert = fnBody.indexOf("insert into public.member_presence");
    const update = fnBody.indexOf("update public.profiles");
    assert(refusal > -1, "the suspension refusal is preserved from 0050");
    assert(refusal < upsert && refusal < update,
      "the refusal happens before any session or activity write, so neither can happen for a suspended account");
    assert(/delete from public\.member_presence where user_id = v_uid;/.test(fnBody),
      "a suspended account's leftover sessions are cleared, so it cannot look connected");
    assert(/if v_status not in \('active', 'accepted', 'pending'\) then/.test(fnBody),
      "the permitted statuses are unchanged from 0050, not widened");
  }

  section("7. Multiple browser sessions work correctly");
  {
    assert(/on conflict \(user_id, session_id\) do update/.test(fnBody),
      "each tab keeps its own session row exactly as before");
    assert(/select count\(\*\) into v_sessions[\s\S]{0,120}where user_id = v_uid and expires_at > now\(\);/.test(fnBody),
      "the session count is still computed from live rows");
    assert(/'sessions', v_sessions/.test(fnBody), "the count is still returned, so a tab can see its siblings");
    assert(/make_interval\(secs => v_expiry\)/.test(fnBody), "expiry still comes from the owner's configured setting");
  }

  section("8. A failed write is never reported as activity");
  {
    assert(/exception when others then\s+v_activity := 'failed';/.test(fnBody),
      "an error is caught and named, not swallowed into a success");
    assert(/raise warning/.test(fnBody),
      "the failure reaches the database's function log, so an administrator can diagnose it");
    assert(/v_activity text := 'idle'/.test(fnBody), "with no interaction claimed, the outcome starts as 'idle'");
    assert(ACTIVITY_OUTCOMES.length === 4 && ACTIVITY_OUTCOMES.join(",") === "idle,recorded,throttled,failed",
      "exactly four outcomes exist, and no screen can invent a fifth");
    assert(isActivityOutcome("recorded") && !isActivityOutcome("connected") && !isActivityOutcome(undefined),
      "only the database's own words are accepted from a response");
    const failed = describeActivityOutcome("failed");
    assert(/could not be recorded/.test(failed) && /work is unaffected/.test(failed) && /last one that was saved/.test(failed),
      "a failure says plainly that nothing was invented, and that the work still stands");
    const throttled = describeActivityOutcome("throttled");
    assert(!/fail|error|could not/i.test(throttled),
      "a throttled write is described as normal, not as a fault");
  }

  section("9. Presence still expires, and the two answers stay separate");
  {
    assert(/expires_at = now\(\) \+ make_interval\(secs => v_expiry\)/.test(fnBody),
      "the heartbeat still pushes expiry forward, so a live tab does not expire");
    assert(/coalesce\(v_expiry, 3600\)/.test(fnBody), "the default expiry is unchanged");
    assert(/Distinct from live presence/.test(migration),
      "the migration states, in the column comment, that the two are different answers");
    assert(/member_presence/.test(migration) && /last_active_at/.test(migration),
      "both concepts are named in the same change, so neither was replaced by the other");
  }

  section("10. Last Active and Live Presence remain two columns, two answers");
  {
    assert(/o_last_active_at/.test(directory), "the staff directory still returns last active");
    assert(/case[\s\S]{0,900}'offline'/.test(directory), "the staff directory still computes live presence separately");
    const lines = activitySummaryLines({ presenceLabel: "Active", lastActivityDisplay: "Last active 6 minutes ago" });
    assert(lines.presence === "Active" && lines.lastActive === "Last active 6 minutes ago",
      "a row can show both at once, and they may legitimately differ");
    const unavailable = activitySummaryLines({ presenceLabel: "Unknown", lastActivityDisplay: "", activityUnavailable: true });
    assert(unavailable.lastActive === "Last active unavailable",
      "a column that could not be read is stated as unavailable, not as a zero or a guess");

    // The exact bug, as a regression: an active person with an old record must be representable.
    const now = Date.parse("2026-11-15T12:00:00Z");
    const fourDaysStale = new Date(now - 4 * 86_400_000).toISOString();
    assert(shouldRecordActivity(fourDaysStale, now) === true,
      "the reported case is now impossible to leave unfixed: the next interaction writes");
  }

  section("11. The change is additive, numbered after the chain, and reversible");
  {
    const files = readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();
    assert(files.includes("0060_member_activity_sync.sql"),
      "0060 is in the chain, and a later migration never removes it");
    assert(files.includes("0050_member_presence.sql") && files.includes("0051_directory_privacy_and_staff_invitations.sql"),
      "the applied migrations it supersedes are still in the chain");
    assert(!/create table/i.test(migration), "it creates no table");
    assert(!/alter table/i.test(migration), "it alters no table");
    assert(!/drop (table|column|policy|function)/i.test(migration), "it drops nothing");
    assert(/ROLLBACK/.test(migration), "rollback is documented in the migration itself");
    assert(/00[0-9][0-9]_member_activity_sync/.test(markers) || /0060_member_activity_sync\.sql/.test(markers),
      "the mandatory marker exists, so CI can prove this migration really applied");
    assert(/p\.prosrc like '%last_active_at%'/.test(markers),
      "the marker reads the function body, so it is false until the replacement is installed");
    // 0050 must not have been edited to sneak the change in: its heartbeat has no activity word.
    assert(!/v_activity/.test(original), "migration 0050 was not edited to add this behaviour");
    assert(!/update public\.profiles[\s\S]{0,80}last_active_at/.test(original),
      "0050's heartbeat still does not write the account record, which is what 0060 changes");
  }

  section("12. Every role reaches the same mechanism, and the API is honest about it");
  {
    assert(/isActivityOutcome/.test(route) && /activity\b/.test(route),
      "the presence route passes the database's own outcome through");
    assert(/const activity = isActivityOutcome\(result\.activity\) \? result\.activity : "idle";/.test(route),
      "an older database with no activity field reports 'idle', never a write");
    assert(/return NextResponse\.json\(\{ ok: true, sessions: result\.sessions \?\? 1, activity \}\);/.test(route),
      "the response carries presence and activity as separate fields");
    // The reporter is started by the shared application shell, so it is not a per-page concern.
    const shell = read("src/components/app/AppShell.tsx");
    assert(/usePresenceReporter/.test(shell),
      "the heartbeat that now records activity runs in the shell every authenticated screen uses");
    const start = shell.indexOf("usePresenceReporter({");
    const call = shell.slice(start, shell.indexOf("});", start) + 3);
    assert(/enabled: Boolean\(userId\)/.test(call),
      "the beat is enabled by being signed in, not by which dashboard is open");
    assert(!/role|isStaff|canUseTesterFeatures|is_owner/.test(call),
      "no role condition can leave one of the four roles without activity");
  }

  section("13. Requirement R17 exists, and does not claim what is not built");
  {
    const r17 = PRODUCT_REQUIREMENTS.find((r) => r.id === "R17");
    assert(Boolean(r17), "R17 is registered beside the other requirements");
    const spec = r17!;
    assert(spec.group === "Dashboards", "R17 sits in the dashboards group, not in a new one");
    assert((REQUIREMENT_STATUSES as readonly string[]).includes(spec.status),
      `R17 uses an agreed status word (${spec.status})`);
    assert(spec.status === "PARTIALLY IMPLEMENTED",
      "R17 is not marked complete while the Co-Owner queue, Tester library and assignment centre are unbuilt");
    assert(/plain language/i.test(spec.statement) && /privacy/i.test(spec.statement) && /rollback/i.test(spec.statement),
      "R17 states the twelve acceptance areas a non-technical reader asked for, in their terms");
    assert(spec.evidence.some((e) => e.includes("0060")), "R17's evidence names the migration, not just the code");
    assert(spec.evidence.some((e) => e.includes("db:verify:local")),
      "R17's evidence distinguishes real-database verification from offline tests");
    assert(Boolean(spec.remaining) && /not built/i.test(spec.remaining!),
      "what is not built is named rather than implied");
    assert(/signed-in pass/i.test(spec.remaining!),
      "the live gap is stated, so nothing here reads as live-verified");

    const doc = read("docs/PRODUCT_REQUIREMENTS.md");
    assert(/### R17 — /.test(doc), "the document carries the same requirement, so code and document cannot drift");
    for (const area of ["Accurate activity across all four roles", "Consistent live presence", "Co-Owner operational queue", "Tester test-case library", "Student assignment centre", "Preserved academic privacy", "Documented rollback"]) {
      assert(doc.includes(area), `R17's acceptance area "${area}" is written down, not only summarised`);
    }
    const r12 = PRODUCT_REQUIREMENTS.find((r) => r.id === "R12");
    assert(Boolean(r12) && /R17/.test(r12!.remaining ?? ""),
      "R12 points at R17 for accuracy instead of claiming it");
  }

  section("14. The student dashboard's own write is a throttled fallback, not a duplicate");
  {
    assert(/ACTIVITY_THROTTLE_MS/.test(dashboard), "the dashboard uses the same window as the heartbeat");
    assert(/\.or\(`last_active_at\.is\.null,last_active_at\.lte\.\$\{activityFloor\}`\)/.test(dashboard),
      "the dashboard only writes when the stored value is genuinely older than the window");
    assert(/last_active_at: new Date\(\)\.toISOString\(\)/.test(dashboard),
      "the value written is still the current time, so the fallback behaves as it always did");
    assert(/heartbeat records the same thing moments later/.test(dashboard),
      "the fallback says in the code why a failure here costs nothing");
  }
}
