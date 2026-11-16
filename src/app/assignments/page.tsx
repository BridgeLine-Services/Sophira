import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/supabase/require-user";
import { needsDatabaseUpdate } from "@/lib/supabase/missing-object";
import { DatabaseUpdateNotice } from "@/components/system/DatabaseUpdateNotice";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Card, CardContent } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { normalizeRole } from "@/lib/roles";
import {
  buildCentre,
  stateTone,
  type AssignmentLite,
  type CentreEntry,
  type RunLite,
  type SessionLite,
} from "@/lib/assignments/centre";

export const dynamic = "force-dynamic";

/**
 * THE STUDENT ASSIGNMENT CENTRE (2026-11-16, requirement R17 area 6).
 *
 * One place per student: every assignment, the run Sophira made for it, the draft that came out,
 * and what still needs them. Before this the answer was spread over three screens and a memory.
 *
 * What it will not do:
 *   - call a draft "checked" unless the stored run records a final verification of VERIFIED. A
 *     finished run with no check is "Draft, not checked", and one that needs review says so.
 *   - describe an unfinished run with a finished-sounding word. It says which step it reached.
 *   - turn a failed read into a cheerful zero. If a table cannot be read the headline says the
 *     picture is incomplete and no count is presented as fact.
 *
 * All three reads use the signed-in student's own client, so row-level security decides what is
 * visible; there is no admin client on this page.
 */
const SECTIONS: { key: "needsYou" | "readyToOpen" | "preparing" | "untouched"; title: string; blurb: string }[] = [
  { key: "needsYou", title: "Needs you now", blurb: "Stopped runs and drafts that did not pass their check." },
  { key: "readyToOpen", title: "Drafts you can open", blurb: "Finished work, with whether it was checked against the brief." },
  { key: "preparing", title: "Being prepared", blurb: "Sophira is still working. Nothing here is finished yet." },
  { key: "untouched", title: "Nothing yet", blurb: "Assignments with no work, a cancelled run, or a run that did not finish." },
];

function EntryRow({ entry }: { entry: CentreEntry }) {
  const title = (entry.assignment.title ?? "").trim() || "Untitled assignment";
  return (
    <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-2">
          <Link href={`/assignments/${entry.assignment.id}`} className="text-sm font-medium text-ink hover:text-accent hover:underline">
            {title}
          </Link>
          <Badge tone={stateTone(entry.state)}>{entry.label}</Badge>
        </p>
        <p className="mt-1 text-sm text-ink-soft">{entry.detail}</p>
        {entry.assignment.subject ? (
          <p className="mt-1 text-xs text-ink-soft">{entry.assignment.subject}</p>
        ) : null}
        {entry.limitations.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">
            {entry.limitations.map((line) => (
              <li key={line}>Recorded limitation: {line}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-1 text-xs text-ink-soft">
          {entry.updated ? `Last activity ${fmtDate(entry.updated)}` : "No activity recorded"}
          {entry.runCount > 1 ? ` · ${entry.runCount} runs` : ""}
        </p>
      </div>
      <div className="flex shrink-0 gap-3 text-sm">
        {entry.run ? (
          <Link href="/writing/autonomous" className="text-accent hover:underline">
            {entry.state === "preparing" ? "Watch the run" : "See the run"}
          </Link>
        ) : null}
        <Link href={`/assignments/${entry.assignment.id}`} className="text-accent hover:underline">
          Open
        </Link>
      </div>
    </div>
  );
}

export default async function AssignmentCentrePage() {
  const supabase = createClient();
  const user = await requireUser(supabase);

  const { data: profile } = await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle();

  const [assignmentsResult, runsResult, sessionsResult] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, title, subject, status, course_id, teacher_id, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("assignment_runs")
      .select("id, assignment_id, state, step_index, total_steps, final_verification, findings, last_error, updated_date, created_date")
      .eq("user_id", user.id)
      .order("updated_date", { ascending: false })
      .limit(300),
    supabase
      .from("essay_sessions")
      .select("id, assignment_id, title, status, final_verification, updated_at, created_at")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(300),
  ]);

  if (needsDatabaseUpdate(assignmentsResult.error)) {
    return (
      <AppShell subtitle="Every assignment, the work done for it, and what still needs you." title="Assignments" role={profile?.role ?? null}>
        <DatabaseUpdateNotice
          feature="your assignments"
          error={assignmentsResult.error}
          canUpdate={normalizeRole(profile?.role) === "owner"}
        />
      </AppShell>
    );
  }

  // A missing runs table is not "no runs": it means the newest work cannot be seen at all.
  const runsMissing = needsDatabaseUpdate(runsResult.error);

  const centre = buildCentre({
    assignments: assignmentsResult.error ? null : ((assignmentsResult.data ?? []) as AssignmentLite[]),
    runs: runsResult.error ? null : ((runsResult.data ?? []) as RunLite[]),
    sessions: sessionsResult.error ? null : ((sessionsResult.data ?? []) as SessionLite[]),
  });

  return (
    <AppShell subtitle="Every assignment, the work done for it, and what still needs you." title="Assignments" role={profile?.role ?? null}>
      <div className="dash-page">
        <div className="dash-stack">
          <div className="dash-hero">
            <p className="dash-eyebrow">Assignment centre</p>
            <h2 className="dash-hero-title mt-1">Where all your work stands</h2>
            <p className="dash-hero-sub mt-2 max-w-2xl">
              Every assignment with the run Sophira made and the draft that came out of it. A draft is only called
              checked when the final check actually passed.
            </p>
          </div>

          <div className="space-y-6">
            {runsMissing ? (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-ink">The newest work cannot be shown yet.</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    The database is missing a table this screen needs, so anything Sophira prepared is hidden rather
                    than counted as nothing.
                    {normalizeRole(profile?.role) === "owner" ? " Press Update database on the setup screen to add it." : " Ask an owner to press Update database on the setup screen."}
                  </p>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardContent className="p-4">
                <h3 className="meta-strong">Where your work stands</h3>
                <p className="mt-1 text-sm text-ink">{centre.headline}</p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    { label: "Assignments", value: centre.summary.total, note: centre.summary.incomplete ? "may be incomplete" : "in your workspace" },
                    { label: "Need you", value: centre.summary.needsYou, note: "stopped or to review" },
                    { label: "Checked drafts", value: centre.summary.checked, note: "passed the final check" },
                    { label: "Not started", value: centre.summary.notStarted, note: "nothing prepared yet" },
                  ].map((s) => (
                    <div key={s.label}>
                      <p className="meta-strong">{s.label}</p>
                      <p className="mt-0.5 text-2xl font-semibold text-ink">
                        {centre.summary.incomplete && s.label !== "Assignments" && runsMissing ? "—" : s.value}
                      </p>
                      <p className="text-xs text-ink-soft">{s.note}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {centre.entries.length === 0 && !centre.summary.incomplete ? (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-ink">You have no assignments yet.</p>
                  <p className="mt-1 text-sm text-ink-soft">
                    Add one and everything done for it, the run, the draft and the check, will appear here.
                  </p>
                  <p className="mt-3 text-sm">
                    <Link href="/assignments/new" className="text-accent hover:underline">
                      Add your first assignment &rarr;
                    </Link>
                  </p>
                </CardContent>
              </Card>
            ) : (
              SECTIONS.filter((section) => centre[section.key].length > 0).map((section) => (
                <section key={section.key} aria-labelledby={`centre-${section.key}`}>
                  <h3 id={`centre-${section.key}`} className="meta-strong">
                    {section.title}
                  </h3>
                  <p className="mb-2 mt-0.5 text-xs text-ink-soft">{section.blurb}</p>
                  <Card>
                    <CardContent className="divide-y divide-line p-0">
                      {centre[section.key].map((entry) => (
                        <EntryRow key={entry.assignment.id} entry={entry} />
                      ))}
                    </CardContent>
                  </Card>
                </section>
              ))
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
