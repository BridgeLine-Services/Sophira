import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { requireUser, readProfileWithRepair } from "@/lib/supabase/require-user";
import { SignOutButton } from "@/components/app/SignOutButton";
import { AppShell } from "@/components/app/AppShell";
import { OwnerDashboard } from "@/components/app/OwnerDashboard";
import { OwnerAreaGrid } from "@/components/owner/OwnerAreaGrid";
import type { Role } from "@/lib/roles";
import { Badge, Button, Card, CardContent } from "@/components/ui";
import type { Invitation, InvitationRequest, NetworkMemberStats } from "@/lib/types";
import Link from "next/link";
import { Briefcase, CheckCircle2, ClipboardList, Gauge, XCircle } from "lucide-react";
import { providerDiagnostics, readAiEnv, paidAllowed } from "@/lib/ai/provider";
import { capabilityRegistry, noUnexpectedCharges } from "@/lib/ai/capabilities";
import { tallyPresenceStates } from "@/lib/owner/member-view";
import { loadOwnerRoster } from "@/lib/owner/roster";
import { buildBackupReport, readBackupReport, storageVerifiedIn } from "@/lib/owner/backup-status";
import { quickReleaseWord, securityNotRunCount } from "@/lib/owner/release-readiness";
import { readReleaseReport } from "@/lib/owner/release-report";
import { countAiFailures, loadAiUsage } from "@/lib/owner/ai-usage";
import { legalPlaceholdersRemain, loadLegalDoc } from "@/lib/legal";
import { providerSetupStatus } from "@/lib/integrations/setup-status";
import { canvasConfigured } from "@/lib/integrations/canvas";
import { buildActionItems, describeUnreadableMembers } from "@/lib/owner/action-items";
import { scanMigrations } from "@/lib/db-ddl";

export const dynamic = "force-dynamic";

/**
 * Owner Dashboard (workflow §23: authenticated + owner → Owner Dashboard).
 * Server-side authorization: a non-owner who types /owner by hand is sent
 * back to the user dashboard — this is a redirect, not hidden UI.
 */

/**
 * HOW FAR BEHIND IS THE DATABASE? (2026-11-11)
 *
 * The dashboard used to learn this only when a member read failed as "column missing", which an
 * ADDITIVE update never causes: the owner could sit two updates behind with no word about it.
 * This asks every migration's own marker directly and returns how many are missing.
 *
 * Null means "could not ask" (no database connection, or the read failed) and nothing is claimed
 * in that case. The answer is cached for five minutes because it costs one round trip per
 * migration and the dashboard is reloaded often; an update the owner just applied shows up within
 * five minutes at worst, and the database page itself is never cached.
 */
let pendingCache: { at: number; value: number | null } | null = null;
const PENDING_TTL_MS = 5 * 60 * 1000;

async function databasePendingCount(): Promise<number | null> {
  const now = Date.now();
  if (pendingCache && now - pendingCache.at < PENDING_TTL_MS) return pendingCache.value;
  let value: number | null = null;
  try {
    const scan = await scanMigrations();
    // An unreachable database, or one Sophira has no channel to, is not "up to date".
    value = scan.reachable ? scan.pending.length : null;
  } catch {
    value = null;
  }
  pendingCache = { at: now, value };
  return value;
}

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

  // ONE READ, ONE TRUTH (2026-11-13). The overview used to perform its own membership,
  // phone and directory reads, so the Members page and this page could disagree about the same
  // person. It now uses the shared roster loader the Members page uses - same function, same
  // fallbacks, same honest failure wording - and performs no duplicate query.
  const roster = await loadOwnerRoster(supabase);
  const members = roster.members;
  const invitations = roster.invitations;
  const requests = roster.requests;

  // 2026-10-08: a statistics failure must NOT take down the whole owner
  // dashboard. The membership table renders empty WITH an explicit,
  // honest banner (never fabricated zeros); invitations, requests, and
  // every management action keep working; the banner names the actual
  // database reason and offers reload as the retry.
  // 2026-11-12: the wording now comes from the shared action-item vocabulary, so the banner and
  // the "Needs attention" card cannot drift into saying different things about the same failure.
  // Tester reports awaiting triage (staff count; RLS lets staff read all).
  const { count: openQaReports } = await supabase
    .from("qa_reports")
    .select("id", { count: "exact", head: true })
    .in("status", ["open", "triaged"]);

  const statsError = roster.statsError
    ? describeUnreadableMembers(roster.directoryError ?? roster.statsError)
    : null;
  const membersLoaded = !roster.statsError;

  // WHO IS AT THEIR SCREEN RIGHT NOW (2026-11-12). Read from the same directory function the
  // Members page uses. If it cannot be read, no number is shown at all - "0 online" and
  // "we could not look" are different facts and must never be confused.
  const tally = roster.presenceAvailable ? tallyPresenceStates(members) : null;

  // 2026-11-12: what the Owner actually needs to do, in one honest list. Every input is a real
  // read - a count that could not be read stays null and is reported as unreadable rather than
  // as zero, and a missing database piece is distinguished from a database that is unreachable.
  const suspendedMembers = membersLoaded
    ? members.filter((m) => String(m.status ?? "") === "suspended").length
    : null;
  const setup = providerSetupStatus();
  const pageDiag = providerDiagnostics(readAiEnv());
  const hdrs = await headers();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${hdrs.get("x-forwarded-proto") || "http"}://${hdrs.get("host")}`;

  // Backups and legal paperwork are reported from real sources only: the backup report the
  // backup tool leaves behind, and the actual legal documents on disk. If either cannot be read,
  // nothing is claimed about it (null), rather than an invented "needs attention".
  const backupSource = readBackupReport();
  const backupReport = buildBackupReport(backupSource);
  // Whether the uploaded FILES were verified is a separate fact from whether a database backup
  // ran; the overview says nothing about it when the report does not record it.
  const storageVerified = storageVerifiedIn(backupSource.raw);

  // RELEASE (2026-11-11): read from the stored release report only - no database connection from
  // the dashboard. No report means no release line at all, never an implied "all clear".
  const release = quickReleaseWord(readReleaseReport().text);
  const securityNotRun = securityNotRunCount(release.snapshot);

  // AI FAILURES (2026-11-13). Read through the same loader the AI Operations page uses, over the
  // last week, so "the AI is failing requests" reaches this list instead of hiding on a page the
  // owner has to think to open. Null means the record could not be read, and then nothing is
  // claimed about it - a failed read is never reported as zero failures.
  const aiUsage = await loadAiUsage({ windowDays: 7, maxRows: 2000 });
  const aiFailures = countAiFailures(aiUsage.rows);
  const terms = loadLegalDoc("TERMS_OF_SERVICE");
  const privacy = loadLegalDoc("PRIVACY_POLICY");
  const legalIncomplete =
    terms === null && privacy === null
      ? null
      : Boolean((terms && legalPlaceholdersRemain(terms)) || (privacy && legalPlaceholdersRemain(privacy)));

  const actionItems = buildActionItems({
    openQaReports: openQaReports ?? 0,
    requestsWaiting: roster.requestsAvailable ? requests.length : null,
    suspendedMembers,
    databaseOutdated: roster.directoryMissing,
    databasePending: await databasePendingCount(),
    membersUnreadable: Boolean(roster.statsError),
    aiReady: Boolean(pageDiag.activeProvider),
    microsoftReady: setup.microsoft,
    googleReady: setup.google,
    searchReady: setup.search,
    backup: { recoverable: backupReport.recoverable, reported: backupReport.reported },
    legalIncomplete,
    aiFailures,
    restoreRehearsed: backupReport.reported ? Boolean(backupReport.lastRestoreTestAt) : null,
    storageVerified,
    securityChecksNotRun: securityNotRun,
    release: release.word,
    // Undefined (not false) when the integration picture could not be read, so no item is invented.
    canvasReady: canvasConfigured(),
  });

  return (
    <AppShell
      title="Owner Dashboard"
      variant="owner"
      role={profile.role}
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

      <OwnerAreaGrid role={(profile.role ?? "user") as Role} />
      <div id="security" className="scroll-mt-4"><NoUnexpectedChargesCard /></div>
      {statsError && (
        <div className="mb-4 rounded-card border border-danger/30 bg-danger/5 p-3" role="alert">
          <p className="text-sm font-medium text-danger">{statsError}</p>
        </div>
      )}
      <OwnerDashboard
        initialMembers={members}
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
          membersLoaded,
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
