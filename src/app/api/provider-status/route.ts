import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwner } from "@/lib/supabase/guard";
import { providerDiagnostics, readAiEnv, paidAllowed } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * OWNER-ONLY provider diagnostics (spec: admin/provider diagnostics screen).
 * Returns configuration state and usage counts — NEVER secret values.
 * Costs are reported as "Cost unknown" where they cannot be determined
 * reliably; nothing here claims "$0".
 */
export async function GET() {
  const supabase = createClient();
  const guard = await requireOwner(supabase);
  if (!guard.ok) return guard.response;

  const diag = providerDiagnostics(readAiEnv());

  // Current-month usage counts (service-role-free read: owner via RPC-free
  // select is blocked by RLS on provider_usage, so aggregate server-side
  // through the service-role client if it is configured).
  let usage: { provider: string; model: string; requests: number; ok: number; failed: number }[] = [];
  let usageNote = "";
  try {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();
    const since = new Date();
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    const { data, error } = await admin
      .from("provider_usage")
      .select("provider, model, ok")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(5000);
    if (error) {
      usageNote = `usage table unavailable (${error.message})`;
    } else {
      const agg = new Map<string, { provider: string; model: string; requests: number; ok: number; failed: number }>();
      for (const r of data ?? []) {
        const k = `${r.provider}|${r.model}`;
        const a = agg.get(k) ?? { provider: r.provider, model: r.model, requests: 0, ok: 0, failed: 0 };
        a.requests += 1;
        if (r.ok) a.ok += 1;
        else a.failed += 1;
        agg.set(k, a);
      }
      usage = Array.from(agg.values());
    }
  } catch (e) {
    usageNote = `usage tracking unavailable: ${(e as Error).message}`;
  }

  // Honest cost display: we cannot verify any provider's billing state from
  // here, so costs are "Cost unknown" rather than a fabricated "$0".
  const cost =
    diag.activeProvider === "gemini"
      ? "Cost unknown — Gemini free tier applies while quota lasts; whether a billing account is attached to the Google project cannot be verified from the server"
      : diag.activeProvider === "openai"
        ? "Cost unknown — paid provider enabled by explicit owner configuration"
        : "No remote provider active — on-device model costs nothing to run";

  const remainingQuota =
    diag.activeProvider === "gemini"
      ? "Unknown — Google does not expose remaining free-tier quota through the API; rate-limit errors are surfaced honestly when hit"
      : "n/a";

  return NextResponse.json({
    diagnostics: {
      activeProvider: diag.activeProvider,
      model: diag.activeModel,
      classification: diag.classification,
      configuredMode: diag.configuredMode,
      candidates: diag.candidates,
      reasons: diag.reasons,
      notes: diag.notes,
    },
    billing: {
      paidAllowed: paidAllowed(readAiEnv()),
      monthlyBudgetUSD: readAiEnv().MONTHLY_AI_BUDGET_USD,
      paidKeyPresent: diag.openaiKeyPresent,
      geminiKeyPresent: diag.geminiConfigured,
    },
    usage,
    usageNote,
    cost,
    remainingQuota,
  });
}
