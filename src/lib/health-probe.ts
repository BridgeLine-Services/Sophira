/**
 * Deep readiness probe (Phase 2, 2026-11-02).
 *
 * Extracted from /api/health so the setup screen and the endpoint share ONE
 * implementation. Two copies of "is the database answering?" would eventually
 * disagree, and the screen would then contradict the release report.
 *
 * Returns only categorical strings. Never a value, hostname, key, or provider name.
 */
export type CheckResult = "ready" | "unreachable" | "not_configured";
export type DeepChecks = { database: CheckResult; auth: CheckResult };

const CACHE_MS = 60_000;
let cached: { at: number; value: DeepChecks } | null = null;

async function probe(url: string, init: RequestInit): Promise<boolean> {
  try {
    const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deepChecks(): Promise<DeepChecks> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  // Only manifest-declared names (tests/env-manifest forbids undocumented reads).
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

  let value: DeepChecks;
  if (!base) {
    value = { database: "not_configured", auth: "not_configured" };
  } else {
    const headers: Record<string, string> = {};
    if (key) {
      headers.apikey = key;
      headers.Authorization = `Bearer ${key}`;
    }
    // A real read against a real table. RLS still applies, so an empty result is a
    // pass: the question is "does storage answer", not "what is stored".
    const database: CheckResult = (await probe(`${base}/rest/v1/profiles?select=id&limit=1`, { headers }))
      ? "ready"
      : "unreachable";
    const auth: CheckResult = (await probe(`${base}/auth/v1/health`, { headers })) ? "ready" : "unreachable";
    value = { database, auth };
  }

  cached = { at: Date.now(), value };
  return value;
}
