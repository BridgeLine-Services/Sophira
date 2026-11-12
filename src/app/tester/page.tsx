import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import { canUseTesterFeatures } from "@/lib/auth/permissions";
import { normalizeRole } from "@/lib/roles";
import { needsDatabaseUpdate } from "@/lib/supabase/missing-object";
import { DatabaseUpdateNotice } from "@/components/system/DatabaseUpdateNotice";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { QaReportForm } from "@/components/tester/QaReportForm";
import { fmtDate } from "@/lib/format";
import { Bug, CheckCircle2, Lightbulb, MessageSquare, ShieldQuestion } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * TESTER WORKSPACE (2026-11-12). The tester role exists in the schema
 * (migration 0048) with restricted access; this is its home. A tester sees
 * ONLY their own reports (RLS); staff triage status server-side. Nothing is
 * fabricated: empty states say so plainly.
 */
const SEVERITY_TONE: Record<string, "neutral" | "warn" | "danger" | "success"> = {
  low: "neutral", medium: "neutral", high: "warn", critical: "danger",
};
const STATUS_LABEL: Record<string, string> = {
  open: "Open", triaged: "Being reviewed", fixed: "Fixed", closed: "Closed", declined: "Declined",
};

export default async function TesterPage() {
  const supabase = createClient();
  const user = await requireUser(supabase);

  const { data: profile } = await supabase.from("profiles").select("id, role, display_name").eq("id", user.id).maybeSingle();
  if (!profile || !canUseTesterFeatures(profile.role)) redirect("/dashboard");

  const { data: reports, error: reportsError } = await supabase
    .from("qa_reports")
    .select("id, kind, title, area, severity, status, created_at, resolution_note")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(25);

  /*
   * 2026-11-12: a missing table is NOT "no reports yet". Supabase returns an error and no
   * rows, and the counts below would confidently read zero. The notice says what is true and
   * tells an Owner the press that fixes it; anyone else is told who to ask.
   */
  if (needsDatabaseUpdate(reportsError)) {
    return (
      <AppShell title="Tester Dashboard" role={profile.role}>
        <DatabaseUpdateNotice
          feature="your QA reports"
          error={reportsError}
          canUpdate={normalizeRole(profile.role) === "owner"}
        />
      </AppShell>
    );
  }

  const rows = reports ?? [];
  const open = rows.filter((r) => r.status === "open" || r.status === "triaged").length;
  const fixed = rows.filter((r) => r.status === "fixed" || r.status === "closed").length;
  const feedback = rows.filter((r) => r.kind === "feedback").length;

  return (
    /*
   * 2026-11-12: the Tester's own home. It stays inside the academic workspace (a Tester is a
   * working member), and the rank is passed to the shell so their menu shows "Tester
   * Dashboard" - never the Owner's or the Co-Owner's, and never at all for an ordinary member.
   */
  <AppShell title="Tester Dashboard" role={profile.role}>
        <div className="dash-page">
          <div className="dash-stack">
            <div className="dash-hero">
              <p className="dash-eyebrow">Tester Dashboard</p>
              <h2 className="dash-hero-title mt-1">Help make Sophira better</h2>
              <p className="dash-hero-sub mt-2 max-w-2xl">Your reports and the workspace you are testing. Nothing here is shared with other members.</p>
            </div>

      <div className="space-y-6">
        <p className="max-w-2xl text-sm text-ink-soft">
          You&apos;re a tester. Use Sophira normally, and when something misbehaves, breaks, or could be better,
          write it down here. Every report is attached to your account, and you can follow its status.
        </p>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Outstanding", value: open, note: "open or being reviewed" },
            { label: "Resolved", value: fixed, note: "fixed or closed" },
            { label: "Feedback", value: feedback, note: "notes you sent us" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <p className="meta-strong">{s.label}</p>
                <p className="mt-1 text-2xl font-semibold text-ink">{s.value}</p>
                <p className="text-xs text-ink-soft">{s.note}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <QaReportForm userId={user.id} />

          <div className="space-y-3">
            <h2 className="meta-strong">Your reports</h2>
            {rows.length === 0 ? (
              <Card>
                <CardContent className="flex items-start gap-3 p-4 text-sm text-ink-soft">
                  <ShieldQuestion className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  <span>Nothing reported yet. When you file your first bug or note, it will appear here with its status.</span>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="divide-y divide-line p-0">
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-start gap-3 p-4">
                      <span className="mt-0.5 shrink-0 text-accent">
                        {r.kind === "bug" ? <Bug className="h-4 w-4" /> : r.kind === "idea" ? <Lightbulb className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-ink">{r.title}</p>
                        <p className="text-xs text-ink-soft">
                          {r.area ? `${r.area} · ` : ""}filed {fmtDate(r.created_at)}
                        </p>
                        {r.resolution_note && <p className="mt-1 text-xs text-ink-soft">Note: {r.resolution_note}</p>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={r.status === "fixed" || r.status === "closed" ? "success" : SEVERITY_TONE[r.severity] ?? "neutral"}>
                          {STATUS_LABEL[r.status] ?? r.status}
                        </Badge>
                        {r.kind === "bug" && <span className="text-[11px] uppercase tracking-wide text-ink-soft">{r.severity}</span>}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-accent" /> How to test well</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm text-ink-soft">
            <p>1. Try the main journeys: sign in, start an assignment, scan a maths problem, open a notebook, and check your settings.</p>
            <p>2. Try them on a phone as well as a computer, and in both light and dark themes.</p>
            <p>3. When something fails, note the exact steps and what you expected instead. Screenshots help if you have them.</p>
            <p>4. Never type a real password into a report, and do not paste anyone else&apos;s private information.</p>
            <p className="pt-1">Curious what&apos;s changing? <Link href="/notifications" className="text-accent hover:underline">Notifications</Link> shows product updates.</p>
          </CardContent>
        </Card>
      </div>
    
          </div>
        </div>
</AppShell>
  );
}
