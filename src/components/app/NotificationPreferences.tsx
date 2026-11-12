"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Spinner } from "@/components/ui";
import { CATEGORIES, CATEGORY_LABELS, type NotificationCategory } from "@/lib/notifications/store";

/**
 * NOTIFICATION PREFERENCES (2026-11-13).
 *
 * The API for this has existed since 2026-11-02, but nothing in the interface reached it, so
 * a member could never actually turn anything off. This is that control.
 *
 * The honesties it keeps:
 *  - the switches start from what the SERVER stored, never from a guess, and while that read
 *    is in flight the card says it is reading rather than showing everything switched on;
 *  - nothing reads as saved until the save was confirmed, and a failure is repeated in plain
 *    words instead of quietly reverting;
 *  - only categories the member did not touch are left alone. Turning one off never turns
 *    another on, and a category Sophira adds later defaults to on rather than vanishing.
 *  - the email switch is shown because it exists, and the card says plainly that in-app
 *    notices are what Sophira itself delivers, so nobody assumes an email is guaranteed.
 */

type Switches = Record<NotificationCategory, boolean>;

function fromPreferences(categories: Partial<Record<NotificationCategory, boolean>> | undefined): Switches {
  const out = {} as Switches;
  for (const category of CATEGORIES) out[category] = categories?.[category] !== false; // absent means on
  return out;
}

export function NotificationPreferences() {
  const [switches, setSwitches] = useState<Switches | null>(null);
  const [emailEnabled, setEmailEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [saveError, setSaveError] = useState("");

  const load = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      if (!res.ok) throw new Error("read failed");
      const body = (await res.json()) as {
        preferences?: { categories?: Partial<Record<NotificationCategory, boolean>>; email_enabled?: boolean };
      };
      setSwitches(fromPreferences(body.preferences?.categories));
      setEmailEnabled(body.preferences?.email_enabled !== false);
      setSaved("");
    } catch {
      setSwitches(null);
      setLoadError("Sophira couldn't read your notification settings just now. Nothing has changed.");
    } finally {
      setLoading(false);
    }
  };

  // Read once on mount; `load` is deliberately not a dependency, because re-reading on every
  // render would overwrite what the member is in the middle of choosing.
  useEffect(() => {
    void load();
  }, []);

  const toggle = (category: NotificationCategory) => {
    setSwitches((current) => (current ? { ...current, [category]: !current[category] } : current));
    setSaved("");
    setSaveError("");
  };

  const save = async () => {
    if (!switches) return;
    setSaving(true);
    setSaved("");
    setSaveError("");
    try {
      const res = await fetch("/api/notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: switches, email_enabled: emailEnabled }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaved("Saved. These choices apply to new notifications from now on.");
    } catch {
      setSaveError("Sophira couldn't save your choices just now. Nothing was changed — please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-ink-soft" role="status">
            <Spinner /> Reading your notification settings…
          </p>
        ) : !switches ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-ink-soft">{loadError}</p>
            <Button type="button" onClick={load}>Try again</Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <p className="text-sm text-ink-soft">
              Choose what Sophira tells you about. If you switch something off it stops appearing in your
              notifications, but nothing about your account or your work changes.
            </p>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-ink">Tell me about</legend>
              {CATEGORIES.map((category) => (
                <label key={category} className="flex items-start gap-2.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-line"
                    checked={switches[category]}
                    onChange={() => toggle(category)}
                  />
                  <span>{CATEGORY_LABELS[category]}</span>
                </label>
              ))}
            </fieldset>

            <label className="flex items-start gap-2.5 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-line"
                checked={emailEnabled}
                onChange={(event) => {
                  setEmailEnabled(event.target.checked);
                  setSaved("");
                  setSaveError("");
                }}
              />
              <span>
                Also send me email summaries
                <span className="block text-xs text-ink-soft">
                  In-app notifications are what Sophira itself delivers. Email depends on the email service
                  this deployment has configured, so it is not guaranteed.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save notification settings"}</Button>
            </div>
            <p role="status" aria-live="polite" className="text-sm text-ink-soft">{saved}</p>
            {saveError && <p role="alert" className="text-sm text-ink-soft">{saveError}</p>}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
