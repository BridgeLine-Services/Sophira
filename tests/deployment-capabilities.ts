/**
 * READINESS HONESTY (Phase 1, 2026-11-02).
 *
 * The release report had to admit that "configured" is not "working". These tests make
 * that distinction permanent: a capability may only say "ready" when a check actually
 * succeeded, an optional integration may never make the app look broken, and every
 * message must be readable by someone who has never heard of an API key.
 */
import { readFileSync } from "node:fs";
import { describeDeploymentCapabilities, evaluateDeploymentReadiness, capabilityLabel } from "../src/lib/deployment";

const STATES = ["ready", "needs_attention", "not_connected", "not_configured", "checking", "unable_to_verify"];
const JARGON = /(supabase|apikey|api key|oauth|\bsql\b|\brls\b|row level|https?:\/\/|econn|pgrst|\b5\d\d\b|\b401\b|\b403\b)/i;

type Health = Record<string, unknown>;
const byKey = (health: Health) =>
  Object.fromEntries(describeDeploymentCapabilities(health).map((c) => [c.key, c]));

const configured: Health = {
  ok: true,
  name: "sophira",
  configuration: { supabase: true, supabase_service_role: true, ai: true, search: true },
};

export function runDeploymentCapabilityTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): void {
  section("deployment readiness (honest capability states)");

  const all = describeDeploymentCapabilities(configured);
  assert(all.every((c) => STATES.includes(c.state)),
    "readiness: every capability resolves to a known state, never a raw boolean");
  assert(all.every((c) => c.label.length > 0 && c.message.length > 20),
    "readiness: every capability carries a label and a real explanatory sentence");
  assert(all.every((c) => !JARGON.test(c.message)),
    "readiness: no capability message contains jargon, a URL, or an HTTP status code");
  assert(all.length === 9, `readiness: all nine capabilities are reported (${all.length})`);

  // Configuration alone must never be reported as proven.
  const shallow = byKey(configured);
  assert(shallow.database.state === "unable_to_verify",
    "readiness: storage without a deep check says 'unable to verify', never 'ready'");
  assert(shallow.auth.state === "unable_to_verify",
    "readiness: sign-in without a deep check says 'unable to verify', never 'ready'");

  // A real check that succeeded is allowed to say ready.
  const deepOk = byKey({ ...configured, checks: { database: "ready", auth: "ready" } });
  assert(deepOk.database.state === "ready" && deepOk.auth.state === "ready",
    "readiness: storage and sign-in report ready only after the deep check passes");

  const deepBad = byKey({ ...configured, checks: { database: "unreachable", auth: "unreachable" } });
  assert(deepBad.database.state === "needs_attention",
    "readiness: an unreachable database is 'needs attention', not 'ready'");
  assert(/not been deleted|nothing/i.test(deepBad.database.message),
    "readiness: an unreachable database reassures the student their work was not deleted");

  // Optional services must never look like a broken application.
  const noSearch = byKey({ ...configured, configuration: { supabase: true, supabase_ai: true, ai: true, search: false } });
  assert(noSearch.research.optional === true && noSearch.research.state === "not_connected",
    "readiness: research not connected is optional, not a failure");
  assert(shallow.research.state === "ready",
    "readiness: research reports ready when a search provider is configured");
  assert(["canvas", "google", "microsoft"].every((k) => shallow[k].optional === true),
    "readiness: Canvas, Google and Microsoft are optional connections");
  assert(shallow.canvas.state === "not_connected",
    "readiness: a deployment cannot claim a student connection it cannot see");

  // Absent AI is a real limitation, but the app is not useless.
  const noAi = byKey({ ok: true, name: "sophira", configuration: { supabase: true, ai: false } });
  assert(noAi.ai.state === "needs_attention", "readiness: missing online AI is 'needs attention'");
  assert(/offline|still work/i.test(noAi.ai.message),
    "readiness: missing online AI says what still works, so nobody thinks the app is dead");

  // Notifications are disclosed, not hidden.
  assert(shallow.notifications.state === "needs_attention",
    "readiness: the missing notification centre is disclosed in the capability list");
  assert(shallow.notifications.optional === true,
    "readiness: missing notifications are optional and do not block readiness");

  // A wrong service must be caught.
  const wrong = byKey({ ok: true, name: "someone-else", configuration: { supabase: true, ai: true } });
  assert(wrong.application.state === "needs_attention",
    "readiness: a different service answering at the URL is flagged, not trusted");

  // The original readiness contract is unchanged.
  const full = evaluateDeploymentReadiness({ ...configured });
  assert(full.ready === true && full.missing.length === 0,
    "readiness: a fully configured deployment is still ready (existing contract preserved)");
  const degraded = evaluateDeploymentReadiness({ ok: true, name: "sophira", configuration: { supabase: false, ai: false } });
  assert(degraded.ready === false && degraded.missing.length > 0,
    "readiness: a degraded deployment is still not ready (existing contract preserved)");
  assert(Array.isArray(full.capabilities) && full.capabilities.length === 9,
    "readiness: the evaluator exposes capabilities alongside the original fields");

  section("deployment readiness (owner-facing setup screen)");

  const labels = STATES.map((state) => capabilityLabel(state as never));
  assert(labels.every((l) => typeof l === "string" && l.length > 3),
    "setup screen: every capability state has an owner-facing label");
  assert(new Set(labels).size === STATES.length,
    "setup screen: the six states map to six distinct labels, so they cannot be confused");
  assert(capabilityLabel("ready") === "Ready" && capabilityLabel("needs_attention") === "Needs attention",
    "setup screen: labels are the plain words the brief asks for");

  const page = readFileSync("src/app/setup/page.tsx", "utf8");
  assert(page.includes("What Sophira checks"),
    "setup screen: the owner sees a 'What Sophira checks' section");
  assert(page.includes("describeDeploymentCapabilities") && page.includes("deepChecks"),
    "setup screen: the section uses the shared readiness rules and the real probe, not its own copy");

  // The owner-facing block must carry no configuration vocabulary. Everything technical
  // belongs in Advanced diagnostics, which is a separate component.
  const start = page.indexOf("capabilities-heading");
  const end = page.indexOf("<SetupWizard", start);
  const block = start >= 0 && end > start ? page.slice(start, end) : "";
  assert(block.length > 200, "setup screen: the capability block is present and substantial");
  assert(!/NEXT_PUBLIC|SUPABASE|process\.env|SQL|migration/i.test(block),
    "setup screen: the capability block contains no variable names, SQL, or migration talk");
  assert(/capabilityLabel/.test(block), "setup screen: statuses are rendered through the shared label mapper");

}
