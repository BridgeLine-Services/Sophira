import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/app/AppShell";
import { OwnerDashboard } from "@/components/app/OwnerDashboard";
import { Badge, Button } from "@/components/ui";
import type { Invitation, InvitationRequest, NetworkMemberStats } from "@/lib/types";
import Link from "next/link";
import { Briefcase, Gauge } from "lucide-react";
import { providerDiagnostics, readAiEnv, paidAllowed } from "@/lib/ai/provider";

export const dynamic = "force-dynamic";

/**
 * Owner Dashboard (workflow §23: authenticated + owner → Owner Dashboard).
 * Server-side authorization: a non-owner who types /owner by hand is sent
 * back to the user dashboard — this is a redirect, not hidden UI.
 */
export default async function OwnerPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (!profile) redirect("/login");
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
