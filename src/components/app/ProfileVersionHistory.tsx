"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Badge, Button, Card, CardContent, ConfirmDialog, useToast } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { History, RotateCcw } from "lucide-react";

interface VersionRow {
  id: string;
  target_type: "teacher" | "writing";
  target_id: string;
  version: number;
  change_summary: string;
  source: string;
  snapshot: Record<string, unknown>;
  previous_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  assignment_id?: string | null;
  feedback_id?: string | null;
  approved_at?: string | null;
  created_at: string;
}

const TEACHER_RESTORE_FIELDS = [
  "required_methods", "required_steps", "preferred_notation", "units_sig_figs",
  "formatting_requirements", "citation_requirements", "essay_structure",
  "lab_report_requirements", "preferred_terminology", "show_work_rules",
  "calculator_rules", "allowed_tools", "prohibited_tools",
  "official_instructions", "rubrics", "examples", "corrections", "ai_notes",
] as const;

/**
 * Append-only profile version history with rollback (spec §14).
 * Rollback restores the snapshot's values and records a new version entry,
 * so history is never rewritten.
 */
export function ProfileVersionHistory({ targetType, targetId }: { targetType: "teacher" | "writing"; targetId: string | null }) {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [confirmRollback, setConfirmRollback] = useState<VersionRow | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!targetId) {
      setLoaded(true);
      return;
    }
    const { data } = await supabase
      .from("profile_versions")
      .select("*")
      .eq("target_type", targetType)
      .eq("target_id", targetId)
      .order("created_at", { ascending: false })
      .limit(20);
    setVersions((data as VersionRow[]) ?? []);
    setLoaded(true);
  }, [supabase, targetType, targetId]);

  useEffect(() => {
    load();
  }, [load]);

  async function rollback(v: VersionRow) {
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated.");

      const table = targetType === "teacher" ? "teacher_profiles" : "writing_profiles";
      const { data: current } = await supabase.from(table).select("*").eq("id", targetId!).single();

      // Record the pre-rollback state so history stays append-only.
      const { count } = await supabase
        .from("profile_versions")
        .select("id", { count: "exact", head: true })
        .eq("target_type", targetType)
        .eq("target_id", targetId!);
      await supabase.from("profile_versions").insert({
        user_id: user.id,
        target_type: targetType,
        target_id: targetId!,
        version: (count ?? 0) + 1,
        change_summary: `Rolled back to version ${v.version}`,
        source: "rollback",
        approved_by: user.id,
        snapshot: current ?? {},
      });

      if (targetType === "teacher") {
        const payload: Record<string, unknown> = {};
        for (const f of TEACHER_RESTORE_FIELDS) {
          if (v.snapshot[f] !== undefined) payload[f] = v.snapshot[f];
        }
        payload.change_summary = `Rolled back to version ${v.version}`;
        const { error } = await supabase.from(table).update(payload).eq("id", targetId!);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from(table)
          .update({
            guidance: (v.snapshot.guidance as string) ?? "",
            summary: (v.snapshot.summary as Record<string, unknown>) ?? {},
            status: (v.snapshot.status as "draft" | "approved") ?? "draft",
            version: ((v.snapshot.version as number) ?? 0) + 1,
            change_summary: `Rolled back to version ${v.version}`,
          })
          .eq("id", targetId!);
        if (error) throw new Error(error.message);
      }

      toast("success", `Rolled back to version ${v.version}.`);
      setConfirmRollback(null);
      load();
      router.refresh();
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Rollback failed — nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded || versions.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <History className="h-4 w-4 text-ink-soft" />
        <h3 className="text-sm font-semibold text-ink">Version history</h3>
        <Badge tone="neutral">{versions.length}</Badge>
      </div>
      <p className="mb-3 text-xs text-ink-soft">
        Each approved change snapshots the previous state. Roll back any time — history is kept.
      </p>
      <div className="space-y-2">
        {versions.map((v) => (
          <Card key={v.id}>
            <CardContent className="flex flex-wrap items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  v{v.version} — {v.change_summary || "Profile update"}
                </p>
                <p className="text-xs text-ink-soft">
                  {fmtDateTime(v.created_at)} · {v.source === "rollback" ? "rollback point" : "approved change"}
                  {v.source.startsWith("proposal:") ? " · from an approved proposal" : ""}
                </p>
                {v.previous_values && v.new_values && Object.keys(v.previous_values).length > 0 && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-xs text-accent">What changed</summary>
                    <ul className="mt-1.5 space-y-1.5">
                      {Object.keys(v.previous_values).map((field) => (
                        <li key={field} className="text-xs text-ink-soft">
                          <span className="font-medium text-ink">{field}</span>:
                          <span className="ml-1 line-through decoration-danger/60">
                            {JSON.stringify(v.previous_values?.[field])?.slice(0, 140)}
                          </span>
                          <span className="mx-1">→</span>
                          <span className="text-success">
                            {JSON.stringify(v.new_values?.[field])?.slice(0, 140)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {v.assignment_id && (
                  <Link href={`/assignments/${v.assignment_id}`} className="text-xs text-accent hover:underline">
                    From assignment →
                  </Link>
                )}
              </div>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmRollback(v)}>
                <RotateCcw className="h-4 w-4" /> Roll back to this
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={confirmRollback !== null}
        title="Roll back this profile?"
        message={
          confirmRollback
            ? `The profile goes back to how it was at version ${confirmRollback.version} ("${confirmRollback.change_summary || "approved change"}"). Your current settings are saved to history first, so this is not destructive.`
            : ""
        }
        confirmLabel="Roll back"
        onConfirm={() => confirmRollback && rollback(confirmRollback)}
        onCancel={() => setConfirmRollback(null)}
      />
    </section>
  );
}
