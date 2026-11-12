import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { SignOutButton } from "@/components/app/SignOutButton";
import { AppShell } from "@/components/app/AppShell";
import { OwnerDashboard } from "@/components/app/OwnerDashboard";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import type { Invitation, InvitationRequest, NetworkMemberStats } from "@/lib/types";
import Link from "next/link";
import { Briefcase, CheckCircle2, ClipboardList, Gauge, XCircle } from "lucide-react";
import { providerDiagnostics, readAiEnv, paidAllowed } from "@/lib/ai/provider";
import { capabilityRegistry, noUnexpectedCharges } from "@/lib/ai/capabilities";
import { tallyPresenceStates } from "@/lib/owner/member-view";
import { providerSetupStatus } from "@/lib/integrations/setup-status";
import { buildActionItems, describeUnreadableMembers, isMissingDatabasePiece } from "@/lib/owner/action-items";

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
  // 2026-10-08: a statistics failure must NOT take down the whole owner
  // dashboard. The membership table renders empty WITH an explicit,
  // honest banner (never fabricated zeros); invitations, requests, and
  // every management action keep working; the banner names the actual
  // database reason and offers reload as the retry.
  // 2026-11-12: the wording now comes from the shared action-item vocabulary, so the banner and
  // the "Needs attention" card cannot drift into saying different things about the same failure.
  const statsError = mErr || !members
    ? describeUnreadableMembers(mErr?.message ?? "no data returned")
    : null;

  // Owner-only phone directory (0043). A failure here must never hide the
  // member list: phones are a convenience, membership is the record.
  const { data: phones } = await supabase.rpc("network_member_phones");
  const phoneById = new Map<string, string>(
    ((phones ?? []) as Array<{ user_id: string; phone: string }>).map((r) => [r.user_id, r.phone])
  );
  const membersWithPhone: NetworkMemberStats[] = ((members ?? []) as NetworkMemberStats[]).map((m) => ({
    ...m,
    phone: phoneById.get(m.user_id) ?? m.phone ?? null,
  }));

  // WHO IS AT THEIR SCREEN RIGHT NOW (2026-11-12). Read from the same directory function the
  // Members page uses. If it cannot be read, no number is shown at all - "0 online" and
  // "we could not look" are different facts and must never be confused.
  const { data: directoryRows, error: directoryError } = await supabase.rpc("network_directory");
  const presenceLive = !directoryError && Array.isArray(directoryRows);
  const tally = presenceLive ? tallyPresenceStates(directoryRows as Array<{ presence?: { state?: string | null } }>) : null;

  // 2026-11-12: what the Owner actually needs to do, in one honest list. Every input is a real
  // read - a count that could not be read stays null and is reported as unreadable rather than
  // as zero, and a missing database piece is distinguished from a database that is unreachable.
  const directoryMissing = isMissingDatabasePiece(directoryError);
  const suspendedMembers = presenceLive
    ? (directoryRows as Array<{ o_status?: string | null }>).filter((r) => r.o_status === "suspended").length
    : null;
  const setup = providerSetupStatus();
  const pageDiag = providerDiagnostics(readAiEnv());
  const hdrs = await headers();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${hdrs.get("x-forwarded-proto") || "http"}://${hdrs.get("host")}`;

  const actionItems = buildActionItems({
    requestsWaiting: requests ? requests.length : null,
    suspendedMembers,
    databaseOutdated: directoryMissing,
    membersUnreadable: Boolean(statsError),
    aiReady: Boolean(pageDiag.activeProvider),
    microsoftReady: setup.microsoft,
    googleReady: setup.google,
    searchReady: setup.search,
  });

  return (
    <AppShell
      title="Owner Dashboard"
      variant="owner"
      actions={
        <>
        <Link
          href="/owner/health"
          className="flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink shadow-sm hover:border-accent/40"
          title="Your live AI service mode — details on the System Health page"
        >
          <span className={"h-2 w-2 rounded-full " + (pageDiag.activeProvider ? "bg-emerald-500" : "bg-amber-400")} aria-hidden />
          {pageDiag.activeProvider ? "AI service ready" : "Local AI mode"}
        </Link>
        <Link href="/dashboard?view=workspace">
          <Button size="sm" variant="secondary">My Workspace</Button>
        </Link>
        </>
      }
    >
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-2 text-sm text-ink-soft">
          <Briefcase className="h-4 w-4 text-accent" />
          You manage this private network.
        </span>
        <Badge>owner</Badge>
      </div>
      <OwnerOverviewCard
        members={members ?? null}
        invitations={invitations ?? null}
        requests={requests ?? null}
        statsError={statsError}
      />
      {tally && (
        <div className="mb-4">
          <Card><CardContent className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
            <span className="font-medium text-ink">
              {tally.active + tally.online} {(tally.active + tally.online) === 1 ? "member is" : "members are"} active or online right now
            </span>
            <span className="text-ink-soft">
              Active {tally.active} · Online {tally.online} · Idle {tally.idle}
              {tally.away + tally.busy + tally.dnd > 0 && ` · Away or busy ${tally.away + tally.busy + tally.dnd}`}
              {` · Offline ${tally.offline}`}
              {tally.unknown > 0 && ` · Not reported ${tally.unknown}`}
            </span>
            <Link href="/owner/members" className="text-accent hover:underline">See who &rarr;</Link>
          </CardContent></Card>
        </div>
      )}
      <section id="needs-attention" className="scroll-mt-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">
          Needs attention
          {actionItems.length > 0 && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-accent">{actionItems.length}</span>}
        </h2>
        <div className="grid gap-2">
          {actionItems.map((item) => (
            <Card key={item.key}><CardContent className="p-4">
              <p className={"font-medium " + (item.tone === "urgent" ? "text-danger" : "text-ink")}>{item.title}</p>
              <p className="mt-1 text-sm text-ink-soft">{item.body}</p>
              {item.href && (
                <Link href={item.href} className="mt-2 inline-block text-sm text-accent hover:underline">
                  {item.linkLabel ?? "Open"} &rarr;
                </Link>
              )}
            </CardContent></Card>
          ))}
          {/*
            2026-11-12: the five hand-written notices that used to live here (requests, document
            providers, search, membership failure, and the "nothing to do" card) are now produced
            by buildActionItems() in src/lib/owner/action-items.ts. They were the visible part of
            the dashboard's blind spots: a database that had not been updated and suspended members
            had no notice at all, because nothing here could see them. One list, one place to fix,
            and every item carries the same plain-language promise.
          */}
          {actionItems.length === 0 && (
            <Card><CardContent className="p-4">
              <p className="font-medium text-ink">Nothing needs your attention right now.</p>
              <p className="mt-1 text-sm text-ink-soft">
                Everything Sophira can check at the moment answered as expected: no one is waiting
                to join, no account is suspended, and the configured services responded. This is not
                a promise about anything Sophira cannot see - the release gate still lists the
                standing legal-review and device-test items until you complete them.
              </p>
            </CardContent></Card>
          )}
        </div>
      </section>
      <div id="security" className="scroll-mt-4"><NoUnexpectedChargesCard /></div>
      {statsError && (
        <div className="mb-4 rounded-card border border-danger/30 bg-danger/5 p-3" role="alert">
          <p className="text-sm font-medium text-danger">{statsError}</p>
        </div>
      )}
      <OwnerDashboard
        initialMembers={membersWithPhone}
        initialInvitations={(invitations || []) as Invitation[]}
        initialRequests={(requests || []) as InvitationRequest[]}
        siteUrl={siteUrl}
        status={{
          // Every value below is a real configuration or request outcome: no estimate, and an
          // unconfigured optional service is never reported as working.
          aiReady: Boolean(pageDiag.activeProvider),
          microsoft: setup.microsoft,
          google: setup.google,
          search: setup.search,
          membersLoaded: !statsError,
        }}
      />
      <section className="mt-8" aria-labelledby="owner-providers-h">
        <h2 id="owner-providers-h" className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">AI Providers and Models</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Detailed capability registry and live provider diagnostics. Registered capability is not the same as an
          active, verified connection — the diagnostics card shows what is actually configured.
        </p>
        <CapabilityRegistryCard />
        <ProviderDiagnosticsCard />
      </section>
    </AppShell>
  );
}


/**
 * ADMINISTRATIVE OVERVIEW (2026-10-12 UI/UX round): compact status cards
 * built ONLY from real data already loaded on this page — database RPC
 * result, live AI provider diagnostics, the server-side billing policy,
 * and the actual member/invitation/request rows. No fabricated "healthy"
 * states: an unavailable check renders an honest "unknown"/"error".
 */
function OwnerOverviewCard({ members, invitations, requests, statsError }: {
  members: NetworkMemberStats[] | null;
  invitations: Invitation[] | null;
  requests: InvitationRequest[] | null;
  statsError: string | null;
}) {
  const env = readAiEnv();
  const diag = providerDiagnostics(env);
  const cards: Array<{ label: string; value: string; note: string; tone: "ok" | "warn" | "bad" | "info" }> = [
    {
      label: "Database",
      value: statsError ? "Error" : "Connected",
      note: statsError ? "Membership stats failed to load — see the banner below" : "Member statistics loaded successfully",
      tone: statsError ? "bad" : "ok",
    },
    {
      label: "AI provider",
      value: diag.activeProvider ? diag.activeModel ?? diag.activeProvider : "Offline mode",
      note: diag.activeProvider ? "Active provider and model" : "No external AI provider configured — on-device only",
      tone: diag.activeProvider ? "ok" : "info",
    },
    {
      label: "Billing protection",
      value: paidAllowed(env) ? "Paid AI allowed" : "Zero-billing",
      note: paidAllowed(env)
        ? `Owner-configured, monthly budget $${env.MONTHLY_AI_BUDGET_USD}`
        : "No Unexpected Charges policy active — no paid AI can run",
      tone: paidAllowed(env) ? "warn" : "ok",
    },
    {
      label: "Members",
      value: members ? String(members.length) : "unknown",
      note: members ? "Accounts in this private network" : "Could not be loaded",
      tone: members ? "info" : "warn",
    },
    {
      label: "Access requests",
      value: requests ? String(requests.length) : "unknown",
      note: requests && requests.length > 0 ? "Awaiting your review below" : requests ? "No pending requests" : "Could not be loaded",
      tone: requests && requests.length > 0 ? "warn" : "info",
    },
    {
      label: "Invitations",
      value: invitations ? String(invitations.length) : "unknown",
      note: invitations ? "Issued invitations (details below)" : "Could not be loaded",
      tone: "info",
    },
  ];
  return (
    <section id="overview" className="mb-6 scroll-mt-4" aria-labelledby="owner-overview-h">
      <h2 id="owner-overview-h" className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-soft">Administrative overview</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{c.label}</p>
            <p className="mt-1 flex items-center gap-2 text-lg font-semibold">
              {c.tone === "ok" && <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />}
              {c.tone === "warn" && <ClipboardList className="h-4 w-4 text-accent" aria-hidden />}
              {c.tone === "bad" && <XCircle className="h-4 w-4 text-danger" aria-hidden />}
              {c.value}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>
          </div>
        ))}
      </div>
    </section>
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
      <div className="overflow-x-auto rounded-lg border border-line">
      <table className="data-table">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b last:border-b-0">
              <td className="py-1.5 pr-4 text-muted-foreground align-top">{k}</td>
              <td className="py-1.5">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
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
        <table className="data-table w-full min-w-[760px] text-xs">
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
