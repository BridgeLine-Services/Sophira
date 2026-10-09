import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { SignOutButton } from "@/components/app/SignOutButton";
import { AppShell } from "@/components/app/AppShell";
import { OwnerDashboard } from "@/components/app/OwnerDashboard";
import { Badge, Button } from "@/components/ui";
import type { Invitation, InvitationRequest, NetworkMemberStats } from "@/lib/types";
import Link from "next/link";
import { Briefcase, Gauge } from "lucide-react";
import { providerDiagnostics, readAiEnv, paidAllowed } from "@/lib/ai/provider";
import { capabilityRegistry, noUnexpectedCharges } from "@/lib/ai/capabilities";

export const dynamic = "force-dynamic";

/**
 * Owner Dashboard (workflow §23: authenticated + owner → Owner Dashboard).
 * Server-side authorization: a non-owner who types /owner by hand is sent
 * back to the user dashboard — this is a redirect, not hidden UI.
 */
export default async function OwnerPage() {
  const supabase = createClient();
  // Shared session validation (redirect-loop fix): a dead session is
  // cleared ONCE and sent to /login — it can never bounce back.
  const user = await requireUser(supabase);

  const { profile, reason: profileReason } = await readProfileWithRepair(supabase, user.id);
  if (!profile) {
    // LOOP-PROOF (fix #2, 2026-10-08): a VALID session with an unresolvable
    // profile previously redirected to /login — which the middleware
    // bounced right back to a guarded page, forever, rendering nothing
    // (the reported "blank dashboard" + endless reload). A valid session is
    // NEVER sent back to /login: the user gets an explicit, visible error
    // and a way out instead of a redirect war.
    return (
      <AppShell title="Account problem">
        <div className="mx-auto max-w-md space-y-3 py-10 text-center">
          <h1 className="text-xl font-semibold text-ink">Your account could not be loaded</h1>
          <p className="text-sm text-ink-soft">
            You are signed in, but your profile record could not be read. This
            is not a password problem — do not keep refreshing. Sign out and
            sign back in; if it persists, the account needs the operator&apos;s
            attention.
          </p>
          {profileReason && (
            <p className="text-xs text-ink-soft" role="note">
              Reason: {profileReason}
            </p>
          )}
          <SignOutButton />
        </div>
      </AppShell>
    );
  }
  if (profile.status === "revoked") redirect("/access-denied");
  if (profile.role !== "owner") redirect("/dashboard");

  const [{ data: members, error: mErr }, { data: invitations }, { data: requests }] = await Promise.all([
    supabase.rpc("network_stats"),
    supabase.from("invitations").select("*").order("created_at", { ascending: false }),
    supabase.from("invitation_requests").select("*").order("created_at", { ascending: false }),
  ]);
  if (mErr || !members) {
    return (
      <AppShell title="Owner Dashboard">
        <p className="text-sm text-ink-soft">
          Statistics are unavailable: {mErr?.message || "unknown error"}. Run migration 0005 in Supabase.
        </p>
      </AppShell>
    );
  }

  const hdrs = await headers();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${hdrs.get("x-forwarded-proto") || "http"}://${hdrs.get("host")}`;

  return (
    <AppShell
      title="Owner Dashboard"
      actions={
        <Link href="/dashboard?view=workspace">
          <Button size="sm" variant="secondary">My workspace</Button>
        </Link>
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm text-ink-soft">
          <Briefcase className="h-4 w-4 text-accent" />
          You manage this private network.
        </span>
        <Badge>owner</Badge>
      </div>
      <NoUnexpectedChargesCard />
      <CapabilityRegistryCard />
      <ProviderDiagnosticsCard />
      <OwnerDashboard
        initialMembers={members as NetworkMemberStats[]}
        initialInvitations={(invitations || []) as Invitation[]}
        initialRequests={(requests || []) as InvitationRequest[]}
        siteUrl={siteUrl}
      />
    </AppShell>
  );
}

/**
 * Owner-only AI provider diagnostics (server-rendered; no API round-trip).
 * Shows the ACTIVE provider, model, cost class, and zero-billing state —
 * honest "Cost unknown" where cost cannot be verified. Contains NO secret
 * values: configuration booleans and reasons only.
 */
function ProviderDiagnosticsCard() {
  const env = readAiEnv();
  const diag = providerDiagnostics(env);
  const rows: [string, string][] = [
    ["Mode", diag.configuredMode],
    ["Active provider", diag.activeProvider ?? "none (Offline mode only)"],
    ["Model", diag.activeModel ?? "n/a"],
    ["Cost class", diag.classification ?? "n/a"],
    ["Paid AI allowed", paidAllowed(env) ? "yes (explicit owner configuration)" : "no — zero-billing policy"],
    ["Monthly budget", `$${env.MONTHLY_AI_BUDGET_USD}`],
    [
      "Estimated cost",
      diag.activeProvider === "gemini"
        ? "Cost unknown — free tier applies while quota lasts; billing state is not verifiable from the server"
        : diag.activeProvider === "openai"
          ? "Cost unknown — paid provider enabled by explicit configuration"
          : "Nothing — on-device model",
    ],
  ];
  return (
    <div className="mb-6 rounded-lg border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <Gauge className="h-4 w-4 text-accent" />
        AI provider diagnostics
      </div>
      <table className="w-full text-sm">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b last:border-b-0">
              <td className="py-1.5 pr-4 text-muted-foreground align-top">{k}</td>
              <td className="py-1.5">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        {Object.entries(diag.reasons).map(([p, r]) => (
          <li key={p}>
            <span className="font-medium">{p}:</span> {r}
          </li>
        ))}
        {diag.notes.map((n, i) => (
          <li key={`note-${i}`}>{n}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Request counts and failure rates: <code>GET /api/provider-status</code> (owner session required; migration 0021).
      </p>
    </div>
  );
}

/**
 * "No Unexpected Charges" SECURITY SETTING (owner view). The state itself is
 * enforced SERVER-SIDE from the environment (ALLOW_PAID_AI /
 * MONTHLY_AI_BUDGET_USD) — deliberately NOT a frontend control, so the
 * browser can never weaken it. This card displays the live state.
 */
function NoUnexpectedChargesCard() {
  const env = readAiEnv();
  const state = noUnexpectedCharges(paidAllowed(env));
  return (
    <div className={`mb-6 rounded-lg border p-4 ${state.enabled ? "border-emerald-600/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold">Security setting: No Unexpected Charges</div>
        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${state.enabled ? "bg-emerald-600/15 text-emerald-700 dark:text-emerald-400" : "bg-destructive/15 text-destructive"}`}>
          {state.enabled ? "ON" : "OFF"}
        </span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{state.detail}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Controlled by the server environment (ALLOW_PAID_AI, MONTHLY_AI_BUDGET_USD), not by the browser — the frontend can
        never enable a paid provider on its own. Rejection happens server-side before any network call.
      </p>
    </div>
  );
}

/**
 * Provider CAPABILITY REGISTRY — displayed BEFORE a provider is activated.
 * Everything the owner needs to decide: cost class, online requirement,
 * multimodal support, context, research tools. No secrets.
 */
function CapabilityRegistryCard() {
  const env = readAiEnv();
  const rows = capabilityRegistry(env);
  return (
    <div className="mb-6 rounded-lg border bg-card p-4">
      <div className="mb-2 text-sm font-semibold">Provider capability registry (shown before activation)</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-xs">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1.5 pr-3">provider</th>
              <th className="py-1.5 pr-3">model</th>
              <th className="py-1.5 pr-3">online</th>
              <th className="py-1.5 pr-3">free tier</th>
              <th className="py-1.5 pr-3">paid capable</th>
              <th className="py-1.5 pr-3">billing required</th>
              <th className="py-1.5 pr-3">multimodal</th>
              <th className="py-1.5 pr-3">max context</th>
              <th className="py-1.5 pr-3">research tools</th>
              <th className="py-1.5">local</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.provider}-${r.model}`} className="border-b last:border-b-0 align-top">
                <td className="py-1.5 pr-3 font-medium">{r.provider}</td>
                <td className="py-1.5 pr-3">{r.model}</td>
                <td className="py-1.5 pr-3">{r.online_required ? "yes" : "no"}</td>
                <td className="py-1.5 pr-3">{r.free_tier ? "yes" : "no"}</td>
                <td className="py-1.5 pr-3">{r.paid_capable ? "yes" : "no"}</td>
                <td className="py-1.5 pr-3">{r.billing_required ? "yes" : "no"}</td>
                <td className="py-1.5 pr-3">{r.multimodal ? "yes" : "no"}</td>
                <td className="py-1.5 pr-3">{r.max_context === null ? "device dependent" : r.max_context.toLocaleString()}</td>
                <td className="py-1.5 pr-3">{r.research_tools ? "yes" : "no"}</td>
                <td className="py-1.5">{r.local ? "yes" : "no"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
        {rows[0]?.notes.slice(0, 1).map((n, i) => (
          <li key={`ln-${i}`}>{n}</li>
        ))}
        <li>Free-tier facts are current, not promises: the provider controls tiering and can change it at any time — under the No Unexpected Charges setting, only models on the verified free-tier list run when paid AI is not allowed.</li>
      </ul>
    </div>
  );
}
