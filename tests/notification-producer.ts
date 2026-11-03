/**
 * NOTIFICATION PRODUCER (2026-11-03).
 *
 * The notification centre was built but empty: nothing raised a notice. Wiring the Canvas
 * sync to raise one is where good intentions usually break things, so these tests pin the
 * two rules that matter — the sync keeps writing only through the user-scoped client, and
 * a notification can never turn a successful sync into a failed one.
 */
import { readFileSync } from "fs";
import * as S from "../src/lib/notifications/store";

type Assert = (condition: boolean, message: string) => void;

export async function runNotificationProducerTests(assert: Assert) {
  const sync = readFileSync("src/lib/integrations/canvas-sync.ts", "utf8");
  const route = readFileSync("src/app/api/integrations/canvas/sync/route.ts", "utf8");

  // Ownership: the sync must NOT hold a service-role client.
  assert(!sync.includes("createAdminClient") && !sync.includes("lib/supabase/admin"),
    "J1: the Canvas sync never imports the service-role client — every write stays user-scoped, so RLS enforces ownership");
  assert(sync.includes("export type CanvasNotifier"),
    "J2: the notifier is injected by the caller, so the sync keeps its own privilege level");

  // Failure isolation.
  assert(/async function safeNotify[\s\S]{0,400}?catch\s*{/.test(sync),
    "J3: a notifier failure is swallowed — a notification must never fail an import that worked");
  assert(sync.includes("if (!notify) return;"),
    "J4: with no notifier (no service key), the sync runs unchanged instead of throwing");

  // The producer fires exactly for the three student-visible events.
  const kinds = (sync.match(/kind: "canvas_assignment_(new|changed)"/g) || []).length;
  assert(kinds === 3, `J5: exactly three Canvas events raise a notice (found ${kinds})`);
  assert(sync.includes("canvasNewKey(a.canvasId)") && sync.includes("canvasChangedKey(a.canvasId"),
    "J6: notices use stable dedupe keys, so re-running a sync is silent");

  // The route is the only place with service role, and only for notifications.
  assert(route.includes("createAdminClient") && route.includes("raiseNotification"),
    "J7: the route supplies the notifier, which is the only place a service-role client exists");
  assert(/notify: admin \? \(input\) => raiseNotification\(admin, memberId, input\)\.then\(\(\) => undefined\) : undefined/.test(route),
    "J8: no service key means no notifier — never a crash, never a silent privilege change");

  // Key semantics.
  assert(S.canvasNewKey(" 101 ") === S.canvasNewKey("101"),
    "J9: a Canvas id is trimmed, so the same assignment cannot notify twice");
  const k1 = S.canvasChangedKey("101", ["Essay", "2026-11-10"]);
  const k2 = S.canvasChangedKey("101", ["Essay", "2026-11-10"]);
  const k3 = S.canvasChangedKey("101", ["Essay", "2026-11-17"]);
  assert(k1 === k2 && k1 !== k3,
    "J10: an identical change reuses its key; a different due date is a genuinely new event");
  assert(S.canvasChangedKey("101", ["x", null]) === S.canvasChangedKey("101", ["x", undefined]),
    "J11: a null and an absent value are one change, not two notices");
  assert(k1.length <= S.LIMITS.dedupe && S.shortHash("abc").length > 0,
    "J12: keys stay inside the stored limit and the hash is non-empty");
}
