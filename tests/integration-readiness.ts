/**
 * INTEGRATION READINESS, OBSERVABLE (2026-11-13, directive Part 13).
 *
 * The Phase 4 report had to write "unknown" for Google, Microsoft and invitation email,
 * because /api/health did not report them and the owner status page could not state them.
 * An owner deciding whether to connect an account should not have to guess.
 *
 * What is pinned here:
 *   - the three capabilities are reported from the SAME functions the features call, so a
 *     status page cannot claim "ready" while the feature is off (or the reverse);
 *   - booleans only: no value, key name or hostname may reach a response or a screen;
 *   - an unknown fact is OMITTED, never rendered as "off";
 *   - turning email off is an optional extra: it must not make the system unhealthy,
 *     because invitations still work by sharing the link.
 */
import { readFileSync } from "fs";
import { buildStatusRows, statusIsHealthy } from "../src/lib/owner-status";
import { providerSetupStatus } from "../src/lib/integrations/setup-status";

type Assert = (condition: boolean, message: string) => void;

export async function runIntegrationReadinessTests(assert: Assert, section: (name: string) => void) {
  section("integration readiness: the owner can see what is on, and nothing is guessed");

  const setup = readFileSync("src/lib/integrations/setup-status.ts", "utf8");
  const health = readFileSync("src/app/api/health/route.ts", "utf8");
  const statusPage = readFileSync("src/app/owner/status/page.tsx", "utf8");
  const rows = readFileSync("src/lib/owner-status.ts", "utf8");

  // ---- one source of truth ------------------------------------------------
  assert(/emailProviderConfigured/.test(setup) && /smsConfigured/.test(setup),
    "readiness: email and SMS come from the delivery layer the invitations actually use");
  assert(/googleConfigured\(\)/.test(setup) && /microsoftConfigured\(\)/.test(setup),
    "readiness: the document connections come from their own provider modules");
  assert(/providerSetupStatus\(\)\.google/.test(health) && /providerSetupStatus\(\)\.microsoft/.test(health) &&
    /providerSetupStatus\(\)\.email/.test(health),
    "health: the three capabilities are reported from providerSetupStatus, not re-derived by hand");
  assert(/google_documents:/.test(health) && /microsoft_documents:/.test(health) && /invitation_email:/.test(health),
    "health: the payload now names the three capabilities the report called unknown");

  // ---- booleans only, never a value --------------------------------------
  for (const banned of ["GOOGLE_CLIENT_SECRET", "MICROSOFT_CLIENT_SECRET", "RESEND_API_KEY", "EMAIL_API_KEY"]) {
    assert(!health.includes(banned), `health: never reads or names ${banned} in the public payload`);
    assert(!statusPage.includes(banned), `status page: never names ${banned}`);
  }
  assert(!/process\.env\.\w+[^)]*\n?.*configuration/.test(health),
    "health: no environment value is echoed into the configuration block");

  // ---- a real answer, right now, in this environment ----------------------
  const live = providerSetupStatus();
  const keys = Object.keys(live).sort().join(",");
  assert(keys === "email,google,microsoft,search,sms", `readiness: all five capabilities are reported (got ${keys})`);
  assert(Object.values(live).every((v) => typeof v === "boolean"),
    "readiness: every capability is a boolean, never a string that could leak a value");

  // ---- the owner's page states it in plain words --------------------------
  assert(/email: setup\.email/.test(statusPage), "status page: passes the real email fact instead of assuming one");
  const stated = buildStatusRows({ aiReady: true, microsoft: false, google: false, search: false, membersLoaded: true, email: true });
  const emailRow = stated.find((r) => r.key === "email");
  assert(Boolean(emailRow) && emailRow!.state === "ready" && /emailed to new members/.test(emailRow!.detail),
    "status page: a configured mail service is stated plainly, with what it means for the owner");
  const offRow = buildStatusRows({ aiReady: true, microsoft: false, google: false, search: false, membersLoaded: true, email: false })
    .find((r) => r.key === "email");
  assert(offRow?.state === "optional_off" && /copy the invitation link/.test(offRow.detail),
    "status page: an unconfigured mail service says what still works, not just that something is missing");
  assert(statusIsHealthy(buildStatusRows({ aiReady: true, microsoft: false, google: false, search: false, membersLoaded: true, email: false })),
    "status page: email switched off never makes an otherwise healthy system look broken");

  // ---- an unknown fact is omitted, never invented -------------------------
  const withoutEmail = buildStatusRows({ aiReady: true, microsoft: false, google: false, search: false, membersLoaded: true });
  assert(!withoutEmail.some((r) => r.key === "email"),
    "status page: when the fact is unknown the row is left out rather than shown as off");
  assert(withoutEmail.map((r) => r.key).join(",") === "members,ai,microsoft,google,search",
    "status page: the existing rows and their order are unchanged");
  assert(/members,ai,microsoft,google,email,search|email === undefined \? \[\]/.test(rows),
    "status page: the email row is slotted between the connections and web search, without reordering the rest");
  assert(withoutEmail.every((r) => r.detail.length > 20 && !/undefined|null|NaN/.test(r.detail)),
    "status page: every row still explains itself in plain language");

  // ---- the report that called these unknown is corrected, not left stale --
  const report = readFileSync("docs/INTEGRATION_READINESS_2026-11-13.md", "utf8");
  assert(/invitation_email|invitation email/i.test(report), "report: still covers invitation email");
  assert(!/Not exposed by `\/api\/health`, so unverified this round/.test(report),
    "report: the 'unverified this round' note is replaced once the probe exists, so the document cannot go stale");
}
