/**
 * OUTBOUND WAITS ARE BOUNDED (2026-11-03).
 *
 * A fetch to a provider with no timeout does not fail, it hangs - and the owner sees a spinner with
 * no explanation while the platform eventually kills the request. The invite send and the owner
 * health page both call external services, so every call in both carries a bound, and a stalled
 * provider must surface as the honest "could not be reached" sentence rather than as silence.
 *
 * The behaviour half is tested by replacing global.fetch with a stub that throws a TimeoutError,
 * which is what an AbortSignal.timeout produces. That proves the catch path words a stall
 * correctly, and a second stub proves a real provider confirmation still reports "sent" - so the
 * test cannot pass by making every send fail.
 */
import { readFileSync } from "fs";
import { sendInvitationEmail } from "../src/lib/invitations/email";

export async function runOutboundTimeoutTests(
  assert: (c: boolean, n: string) => void,
  section: (t: string) => void,
): Promise<void> {
  section("outbound waits are bounded, and a stall reads as a failure");

  const bounded = (file: string, expectedCalls: number): boolean => {
    const src = readFileSync(file, "utf8");
    const calls = [...src.matchAll(/await fetch\(/g)].map((m) => m.index ?? 0);
    if (calls.length !== expectedCalls) return false;
    return calls.every((at) => {
      // The options object belongs to this statement; stop at its terminator.
      const stmt = src.slice(at, src.indexOf(");", at) + 2);
      return /signal:\s*AbortSignal\.timeout\(\d+\)/.test(stmt);
    });
  };

  assert(bounded("src/lib/invitations/email.ts", 1),
    "timeouts: the one provider call in the invitation email is bounded");
  assert(bounded("src/app/api/owner/system-health/route.ts", 5),
    "timeouts: all five calls behind the owner health page are bounded (GitHub x4, database x1)");

  // Behaviour: a provider that never answers must read as unreachable, never as sent.
  const realFetch = global.fetch;
  const realKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = "re_test_key_not_a_secret";
  try {
    global.fetch = (async () => {
      const err = new Error("The operation was aborted due to timeout");
      err.name = "TimeoutError";
      throw err;
    }) as unknown as typeof fetch;

    const stalled = await sendInvitationEmail({
      to: "member@example.com", link: "https://example.com/invite", siteUrl: "https://example.com",
    });
    assert(stalled.status === "failed" && /could not be reached/i.test(stalled.reason ?? ""),
      "timeouts: a stalled email provider reports 'could not be reached', never a false 'sent'");

    global.fetch = (async () => ({
      ok: true, status: 200, json: async () => ({ id: "msg_1" }),
    })) as unknown as typeof fetch;

    const sent = await sendInvitationEmail({
      to: "member@example.com", link: "https://example.com/invite", siteUrl: "https://example.com",
    });
    assert(sent.status === "sent" && sent.providerId === "msg_1",
      "timeouts: a real provider confirmation still reports 'sent' with the provider's id");
  } finally {
    global.fetch = realFetch;
    if (realKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = realKey;
  }
}
