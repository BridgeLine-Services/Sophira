"use client";

import { useCallback, useState } from "react";
import {
  DEFAULT_THRESHOLDS,
  THRESHOLD_BOUNDS,
  THRESHOLD_LABELS,
  type PresenceThresholds,
} from "@/lib/presence/thresholds";

interface Props {
  initial: PresenceThresholds;
  /** Whether presence could actually be read; a settings form is pointless if it could not. */
  available?: boolean;
}

const HELP: Record<keyof PresenceThresholds, string> = {
  heartbeatIntervalSeconds:
    "How often an open tab tells Sophira it is still there. Shorter is more accurate and a little more traffic.",
  connectionTimeoutSeconds:
    "How long a tab can stay silent before the member reads Offline. Must be longer than the report interval, or members flicker.",
  activeThresholdSeconds: "Someone who did something this recently reads Active.",
  idleThresholdSeconds: "Someone quiet for longer than this reads Idle rather than Active.",
  sessionExpirationSeconds: "An old tab is ignored after this long, even if it is still reporting.",
  presenceUpdateIntervalSeconds: "How often the Members page re-reads presence while it is open.",
};

/**
 * PRESENCE SETTINGS (2026-11-12).
 *
 * The six numbers behind every presence label, editable by the Owner. Two rules shape this
 * form: the range for each number is shown rather than discovered by a failed save, and a
 * refusal is repeated in the server's own words, because the server is the one that decides.
 *
 * Nothing here is optimistic. The saved values are the ones the server returned, so the form
 * can never show a setting that was not actually stored.
 */
export function PresenceSettings({ initial, available = true }: Props) {
  const [values, setValues] = useState<PresenceThresholds>(initial);
  const [saved, setSaved] = useState<PresenceThresholds>(initial);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = (Object.keys(values) as Array<keyof PresenceThresholds>).some(
    (key) => values[key] !== saved[key],
  );

  const set = (key: keyof PresenceThresholds, raw: string) => {
    const n = Number(raw);
    setValues((prev) => ({ ...prev, [key]: Number.isFinite(n) ? n : prev[key] }));
    setProblems([]);
    setNotice(null);
  };

  const save = useCallback(async () => {
    setBusy(true);
    setProblems([]);
    setNotice(null);
    try {
      const res = await fetch("/api/network/presence-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholds: values }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        thresholds?: PresenceThresholds;
        error?: string;
        problems?: string[];
      };
      if (!res.ok || !json?.ok) {
        setProblems(json?.problems?.length ? json.problems : [json?.error ?? "Those settings were not saved."]);
        return;
      }
      const next = json.thresholds ?? values;
      setSaved(next);
      setValues(next);
      setNotice("Saved. Every member's presence now follows these numbers.");
    } catch {
      setProblems(["The settings could not be sent just now. Nothing was changed."]);
    } finally {
      setBusy(false);
    }
  }, [values]);

  const reset = () => {
    setValues(DEFAULT_THRESHOLDS);
    setProblems([]);
    setNotice("Defaults loaded into the form. Press Save to apply them.");
  };

  if (!available) {
    return (
      <section className="rounded-card border border-line bg-surface p-4 text-sm text-ink-soft">
        Presence settings are unavailable until the database has the presence tables. Nothing
        here has been changed.
      </section>
    );
  }

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">How quickly members look active or offline</h3>
          <p className="mt-1 max-w-xl text-xs text-ink-soft">
            These are the numbers behind Active, Idle and Offline. Times are in seconds. The
            ranges are shown so you do not have to guess one.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-card"
        >
          Load the defaults
        </button>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {(Object.keys(THRESHOLD_LABELS) as Array<keyof PresenceThresholds>).map((key) => {
          const bounds = THRESHOLD_BOUNDS[key];
          return (
            <label key={key} className="block">
              <span className="text-xs font-medium text-ink">{THRESHOLD_LABELS[key]}</span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={bounds.min}
                  max={bounds.max}
                  step={1}
                  value={values[key]}
                  onChange={(e) => set(key, e.target.value)}
                  className="w-24 rounded-lg border border-line bg-card px-2 py-1.5 text-sm text-ink"
                  aria-describedby={`help-${key}`}
                />
                <span className="text-xs text-ink-soft">
                  seconds, {bounds.min} to {bounds.max}
                </span>
              </div>
              <span id={`help-${key}`} className="mt-1 block text-xs text-ink-soft">
                {HELP[key]}
              </span>
            </label>
          );
        })}
      </div>

      {problems.length > 0 && (
        <ul role="alert" className="mt-3 space-y-1 rounded-card border border-warn/40 bg-warn/10 p-3 text-sm text-ink">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded-card border border-line bg-card p-3 text-sm text-ink">
          {notice}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50"
        >
          {busy ? "Saving…" : dirty ? "Save presence settings" : "Saved"}
        </button>
        <span className="text-xs text-ink-soft">
          Only an Owner can change these.
        </span>
      </div>
    </section>
  );
}
