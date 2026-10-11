"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { RefreshCw } from "lucide-react";

/**
 * Owner System Health panel (2026-10-11). Displays the REAL release-gate
 * result in plain English: what each check means, why it matters, the
 * exact owner action, and the last verification timestamp. The data comes
 * from /api/owner/system-health, which runs the single authoritative
 * gate. Nothing here can mark a blocked check as passed; if the gate
 * cannot run, the panel says so honestly.
 */
interface TranslatedCheck {
  id: number;
  name: string;
  status: string;
  detail: string;
  plain: string;
  why: string;
  group: string;
  ownerAction: string;
  displayState: string;
}

interface HealthData {
  ok: boolean;
  source: string;
  generated_at?: string;
  verdict?: string;
  reason?: string;
  disclaimer?: string;
  counts?: { total: number; pass: number; fail: number; blocked: number; notRun: number };
  checks?: TranslatedCheck[];
  error?: string;
}

const STATE_CLASS: Record<string, string> = {
  Ready: "bg-emerald-100 text-emerald-900",
  "Needs attention": "bg-amber-100 text-amber-900",
  Failed: "bg-red-100 text-red-900",
  "Not verified": "bg-slate-200 text-slate-700",
};

export function SystemHealthPanel() {
  const [data, setData] = useState<HealthData | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/owner/system-health");
      const json = (await res.json()) as HealthData;
      if (!res.ok || json.ok !== true) {
        setErr(json.error ?? "The health check could not run. This is a real failure, not a pass.");
        setData(null);
      } else {
        setData(json);
      }
    } catch {
      setErr("Sophira could not reach the server to run the check.");
      setData(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const groups = new Map<string, TranslatedCheck[]>();
  (data?.checks ?? []).forEach((c) => {
    const list = groups.get(c.group) ?? [];
    list.push(c);
    groups.set(c.group, list);
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg border p-6">
        <h1 className="text-xl font-semibold text-ink">System Health and Release Readiness</h1>
        <p className="mt-1 text-sm text-ink-soft">
          This page runs Sophira&apos;s real release checks and explains the result in plain English.
          Nothing is marked ready unless it was genuinely verified.
        </p>
        <div className="mt-4">
          <Button size="sm" variant="secondary" onClick={() => void run()} disabled={busy}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
            {busy ? "Checking..." : "Check again"}
          </Button>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          {err} You can retry from here; the same checks also run in the project&apos;s continuous
          integration, which produces the full evidence.
        </div>
      )}

      {data && (
        <>
          <div className="rounded-lg border p-6">
            <p className="text-xs uppercase tracking-wide text-ink-soft">Overall release status</p>
            <p
              className={`mt-1 text-2xl font-semibold ${
                data.verdict === "READY FOR RELEASE" ? "text-emerald-700" : "text-red-700"
              }`}
            >
              {data.verdict}
            </p>
            <p className="mt-2 text-sm text-ink-soft">{data.reason}</p>
            {data.counts && (
              <p className="mt-1 text-xs text-ink-soft">
                {data.counts.total} checks total: {data.counts.pass} passed, {data.counts.blocked} blocked,{" "}
                {data.counts.fail} failed, {data.counts.notRun} not run.
              </p>
            )}
            <p className="mt-3 text-xs text-ink-soft">{data.disclaimer}</p>
            {data.generated_at && (
              <p className="mt-1 text-xs text-ink-soft">
                Last checked: {new Date(data.generated_at).toLocaleString()}
              </p>
            )}
          </div>

          {Array.from(groups.entries()).map(([group, list]) => (
            <div key={group} className="rounded-lg border p-6">
              <h2 className="text-base font-semibold text-ink">{group}</h2>
              <div className="mt-3 space-y-4">
                {list.map((c) => (
                  <div key={c.id} className="border-t pt-3 first:border-t-0 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_CLASS[c.displayState] ?? ""}`}
                      >
                        {c.displayState}
                      </span>
                      <span className="text-sm font-medium text-ink">{c.name}</span>
                    </div>
                    <p className="mt-1 text-sm text-ink-soft">{c.plain}</p>
                    <p className="mt-1 text-xs text-ink-soft">
                      <span className="font-medium">Why it matters:</span> {c.why}
                    </p>
                    {c.ownerAction && (
                      <p className="mt-1 text-sm text-ink">
                        <span className="font-medium">What you can do:</span> {c.ownerAction}
                      </p>
                    )}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-ink-soft">Technical detail</summary>
                      <p className="mt-1 text-xs text-ink-soft">{c.detail}</p>
                    </details>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
