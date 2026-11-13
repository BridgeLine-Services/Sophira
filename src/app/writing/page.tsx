"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AppShell } from "@/components/app/AppShell";
import { ProposalsPanel } from "@/components/app/ProposalsPanel";
import {
  Badge, Button, Card, CardContent, ConfirmDialog, EmptyState, Select, Spinner, useToast,
} from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { PenLine, RefreshCw } from "lucide-react";
import { ProfileVersionHistory } from "@/components/app/ProfileVersionHistory";
import type { WritingProfile, WritingSample } from "@/lib/types";
import { guardedAiFetch } from "@/lib/ai/offline-guard";
import {
  closenessExplanation,
  closenessLabel,
  CONTEXT_DESCRIPTIONS,
  CONTEXT_LABELS,
  parseWritingContext,
  WRITING_CONTEXTS,
  type WritingContext,
} from "@/lib/ai/writing-contexts";

/** A profile row with the two columns migration 0058 added (2026-11-13, directive Part 5). */
type ProfileRow = WritingProfile & { profile_context?: string | null; style_closeness?: number | null };

const REPR_BADGE = {
  preferred: { tone: "success" as const, label: "Preferred" },
  neutral: { tone: "neutral" as const, label: "Neutral" },
  not_representative: { tone: "warn" as const, label: "Not representative" },
};

export default function WritingPage() {
  const supabase = createClient();
  const { toast } = useToast();
  // THREE PROFILES, ONE PER KIND OF WRITING (directive Part 5). The student switches between
  // them instead of one profile quietly governing every kind of writing they do.
  const [context, setContext] = useState<WritingContext>("academic");
  const [profiles, setProfiles] = useState<Partial<Record<WritingContext, ProfileRow>>>({});
  const [dial, setDial] = useState(70);
  const [savingDial, setSavingDial] = useState(false);
  const [samples, setSamples] = useState<WritingSample[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      // Every profile, not just the newest: the newest row for one kind of writing has no
      // business answering another.
      supabase.from("writing_profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("writing_samples").select("*").order("created_at", { ascending: false }),
    ]).then(([p, s]) => {
      const rows = (p.data ?? []) as ProfileRow[];
      const grouped: Partial<Record<WritingContext, ProfileRow>> = {};
      for (const row of rows) {
        const key = parseWritingContext(row.profile_context);
        if (!grouped[key]) grouped[key] = row;
      }
      setProfiles(grouped);
      const current = grouped[context];
      setDial(typeof current?.style_closeness === "number" ? current.style_closeness : 70);
      setSamples((s.data as WritingSample[]) ?? []);
      setLoaded(true);
    });
  }, [supabase, context]);

  useEffect(() => {
    load();
  }, [load]);

  async function analyze() {
    setAnalyzing(true);
    try {
      const res = await guardedAiFetch("/api/ai/analyze-writing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Scoped to the tab the student is on, so a casual note cannot reshape an essay.
        body: JSON.stringify({ context }),
      });
      const json = await res.json();
      if (res.ok) {
        toast("success", "Analysis ready — review and approve it above.");
        load();
      } else {
        toast("error", json.error || "The analysis failed. Your samples are safe — please try again.");
      }
    } catch {
      toast("error", "Could not reach the server. Your samples are safe — please try again.");
    } finally {
      setAnalyzing(false);
    }
  }

  /**
   * The closeness dial. This is the student's own preference, so it is saved directly -
   * no approval step - and the number shown is always the value the server stored back.
   */
  async function saveDial(next: number) {
    setSavingDial(true);
    try {
      const res = await fetch("/api/writing/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context, closeness: next }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast("error", json.error || "Your setting was not saved.");
        return;
      }
      setDial(json.closeness);
      setProfiles((prev) => ({ ...prev, [context]: { ...(prev[context] ?? ({} as ProfileRow)), style_closeness: json.closeness } }));
    } catch {
      toast("error", "Could not reach the server. Your setting was not saved.");
    } finally {
      setSavingDial(false);
    }
  }

  /** Move a sample to another kind of writing. Reversible, one tap, nothing is deleted. */
  async function changeSampleContext(id: string, next: string) {
    const { error } = await supabase.from("writing_samples").update({ profile_context: next }).eq("id", id);
    if (error) {
      toast("error", "Could not move this sample. Nothing was changed.");
      return;
    }
    setSamples((rows) => rows.map((x) => (x.id === id ? ({ ...x, profile_context: next } as WritingSample) : x)));
    toast("success", "Moved to " + CONTEXT_LABELS[parseWritingContext(next)].toLowerCase() + ".");
  }

  async function changeRepr(id: string, repr: string) {
    const { error } = await supabase
      .from("writing_samples")
      .update({ representativeness: repr })
      .eq("id", id);
    if (error) {
      toast("error", "Could not update: " + error.message);
      return;
    }
    setSamples((s) => s.map((x) => (x.id === id ? { ...x, representativeness: repr as WritingSample["representativeness"] } : x)));
  }

  async function deleteSample(id: string) {
    const { error } = await supabase.from("writing_samples").delete().eq("id", id);
    setConfirmDelete(null);
    if (error) {
      toast("error", "Could not delete: " + error.message);
      return;
    }
    setSamples((s) => s.filter((x) => x.id !== id));
    toast("success", "Sample deleted.");
  }

  const profile = profiles[context] ?? null;
  // Samples of the chosen kind, and of those the ones that may teach a style.
  const forContext = samples.filter((s) => parseWritingContext((s as { profile_context?: string }).profile_context) === context);
  const usable = forContext.filter((s) => s.representativeness !== "not_representative");

  return (
    <>
    <div className="mx-auto mb-3 max-w-3xl rounded-lg border border-line bg-card p-3 text-sm text-ink">
      Want a line-by-line review of one draft?{" "}
      <Link href="/writing/review" className="underline">Open the writing review workspace</Link>.
    </div>
    <AppShell
      subtitle="The writing workspace: plan, draft, review and check your work."
      title="Writing Profile"
      actions={
        <Link href="/writing/new">
          <Button size="sm">+ Add a sample</Button>
        </Link>
      }
    >
      <div className="space-y-6">
        {/* Which kind of writing. Three tabs, plain words, one choice at a time. */}
        <div role="tablist" aria-label="Kind of writing" className="flex flex-wrap gap-2">
          {WRITING_CONTEXTS.map((c) => {
            const selected = c === context;
            return (
              <button
                key={c}
                role="tab"
                aria-selected={selected}
                type="button"
                onClick={() => setContext(c)}
                className={
                  "rounded-lg border px-3 py-1.5 text-sm transition " +
                  (selected ? "border-accent bg-accent/10 font-medium text-ink" : "border-line text-ink-soft hover:text-ink")
                }
              >
                {CONTEXT_LABELS[c]}
                {profiles[c]?.status === "approved" && <span aria-label="approved" className="ml-1.5">&#10003;</span>}
              </button>
            );
          })}
        </div>
        <p className="text-sm text-ink-soft">{CONTEXT_DESCRIPTIONS[context]}</p>

        <ProposalsPanel targetType="writing" />

        {/* Profile card */}
        {!loaded ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : profile ? (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                {profile.status === "approved" ? (
                  <Badge tone="success">Approved</Badge>
                ) : (
                  <Badge tone="warn">Draft (not used for writing yet)</Badge>
                )}
                <span className="text-xs text-ink-soft">Version {profile.version}</span>
              </div>
              {profile.guidance ? (
                <p className="whitespace-pre-wrap text-sm text-ink">{profile.guidance}</p>
              ) : (
                <p className="text-sm text-ink-soft">No guidance yet — analyze your samples and approve the result.</p>
              )}
              {profile.summary && Object.keys(profile.summary).length > 0 && (
                <dl className="mt-2 grid gap-x-6 gap-y-2 rounded-lg bg-ink/[0.02] p-3 sm:grid-cols-2">
                  {Object.entries(profile.summary)
                    .filter(([, v]) => v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-xs font-medium text-ink-soft">
                          {k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                        </dt>
                        <dd className="text-sm text-ink">{String(v)}</dd>
                      </div>
                    ))}
                </dl>
              )}
              <Button variant="secondary" onClick={analyze} disabled={analyzing || usable.length === 0}>
                {analyzing ? (
                  <><RefreshCw className="h-4 w-4 animate-spin" /> Analyzing…</>
                ) : (
                  <><RefreshCw className="h-4 w-4" /> Re-analyze from my samples</>
                )}
              </Button>
              {usable.length === 0 && (
                <p className="text-xs text-ink-soft">
                  I need at least one {CONTEXT_LABELS[context].toLowerCase()} sample marked preferred or neutral before I can analyze.
                </p>
              )}

              {/* How closely to follow this profile. 0 keeps it but does not apply it. */}
              <div className="mt-2 rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label htmlFor="closeness" className="text-sm font-medium text-ink">
                    How closely should Sophira follow your {CONTEXT_LABELS[context].toLowerCase()}?
                  </label>
                  <span className="text-sm text-ink-soft">{closenessLabel(dial)}{savingDial ? " · saving…" : ""}</span>
                </div>
                <input
                  id="closeness"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={dial}
                  onChange={(e) => setDial(Number(e.target.value))}
                  onPointerUp={() => void saveDial(dial)}
                  onKeyUp={() => void saveDial(dial)}
                  onBlur={() => void saveDial(dial)}
                  className="mt-2 w-full"
                  aria-describedby="closeness-help"
                />
                <p id="closeness-help" className="mt-1.5 text-xs text-ink-soft">{closenessExplanation(dial)}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  Your assignment and your teacher always win over these preferences.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <EmptyState
            icon={<PenLine className="h-6 w-6" />}
            title={`No ${CONTEXT_LABELS[context].toLowerCase()} profile yet`}
            description={'I won\u0027t guess your writing style. Add at least one writing sample marked "preferred" or "neutral", then analyze.'}
            action={<Link href="/writing/new"><Button size="sm">Add a writing sample</Button></Link>}
          />
        )}

        {/* Samples */}
        <section>
          <h2 className="mb-3 meta-strong">{CONTEXT_LABELS[context]} samples</h2>
          {forContext.length === 0 ? (
            <EmptyState
              title="No samples yet"
              description={`Nothing here yet. Add ${CONTEXT_LABELS[context].toLowerCase()} that sounds like you, or move one of your other samples into this group.`}
              action={<Link href="/writing/new"><Button size="sm">Add your first sample</Button></Link>}
            />
          ) : (
            <div className="space-y-3">
              {forContext.map((s) => {
                const b = REPR_BADGE[s.representativeness];
                return (
                  <Card key={s.id}>
                    <CardContent className="p-4">
                      <details>
                        <summary className="cursor-pointer">
                          <span className="font-medium text-ink">{s.title}</span>
                          <span className="ml-2 text-xs text-ink-soft">{fmtDate(s.sample_date || s.created_at)}</span>
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">{s.content}</p>
                      </details>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {s.genre && <Badge>{s.genre}</Badge>}
                        <Badge tone="neutral">{CONTEXT_LABELS[parseWritingContext((s as { profile_context?: string }).profile_context)]}</Badge>
                        <Badge tone={b.tone}>{b.label}</Badge>
                        <div className="ml-auto flex items-center gap-2">
                          <Select
                            aria-label="Representativeness"
                            className="w-auto text-sm"
                            value={s.representativeness}
                            onChange={(e) => changeRepr(s.id, e.target.value)}
                          >
                            <option value="preferred">Preferred</option>
                            <option value="neutral">Neutral</option>
                            <option value="not_representative">Not representative</option>
                          </Select>
                          <Select
                            aria-label="Kind of writing"
                            className="w-auto text-sm"
                            value={parseWritingContext((s as { profile_context?: string }).profile_context)}
                            onChange={(e) => void changeSampleContext(s.id, e.target.value)}
                          >
                            {WRITING_CONTEXTS.map((c) => (
                              <option key={c} value={c}>{CONTEXT_LABELS[c]}</option>
                            ))}
                          </Select>
                          <Button variant="ghost" size="sm" className="text-danger" onClick={() => setConfirmDelete(s.id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </section>

        {profile?.id && <ProfileVersionHistory targetType="writing" targetId={profile.id} />}

        <ConfirmDialog
          open={confirmDelete !== null}
          title="Delete this sample?"
          message="It will no longer be used to analyze your writing style."
          confirmLabel="Delete"
          destructive
          onConfirm={() => confirmDelete && deleteSample(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      </div>
    </AppShell>
    </>
  );
}
