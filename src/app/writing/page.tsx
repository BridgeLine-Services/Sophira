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

const REPR_BADGE = {
  preferred: { tone: "success" as const, label: "Preferred" },
  neutral: { tone: "neutral" as const, label: "Neutral" },
  not_representative: { tone: "warn" as const, label: "Not representative" },
};

export default function WritingPage() {
  const supabase = createClient();
  const { toast } = useToast();
  const [profile, setProfile] = useState<WritingProfile | null>(null);
  const [samples, setSamples] = useState<WritingSample[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(() => {
    Promise.all([
      supabase.from("writing_profiles").select("*").order("created_at", { ascending: false }).limit(1),
      supabase.from("writing_samples").select("*").order("created_at", { ascending: false }),
    ]).then(([p, s]) => {
      setProfile((p.data?.[0] as WritingProfile) ?? null);
      setSamples((s.data as WritingSample[]) ?? []);
      setLoaded(true);
    });
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function analyze() {
    setAnalyzing(true);
    try {
      const res = await fetch("/api/ai/analyze-writing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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

  const usable = samples.filter((s) => s.representativeness !== "not_representative");

  return (
    <AppShell
      title="Writing Profile"
      actions={
        <Link href="/writing/new">
          <Button size="sm">+ Add a sample</Button>
        </Link>
      }
    >
      <div className="space-y-6">
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
                <p className="text-xs text-ink-soft">I need at least one sample marked preferred or neutral before I can analyze.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <EmptyState
            icon={<PenLine className="h-6 w-6" />}
            title="No writing profile yet"
            description={'I won\u0027t guess your writing style. Add at least one writing sample marked "preferred" or "neutral", then analyze.'}
            action={<Link href="/writing/new"><Button size="sm">Add a writing sample</Button></Link>}
          />
        )}

        {/* Samples */}
        <section>
          <h2 className="mb-3 text-base font-semibold text-ink">My writing samples</h2>
          {samples.length === 0 ? (
            <EmptyState
              title="No samples yet"
              description="Add essays, discussion posts, or any writing that sounds like you."
              action={<Link href="/writing/new"><Button size="sm">Add your first sample</Button></Link>}
            />
          ) : (
            <div className="space-y-3">
              {samples.map((s) => {
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
  );
}
