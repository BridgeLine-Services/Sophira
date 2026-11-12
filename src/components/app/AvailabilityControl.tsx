"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Spinner } from "@/components/ui";

/**
 * MY AVAILABILITY (2026-11-12, owner spec 3.4).
 *
 * A member's own control for how they appear: Available, Away, Busy, Do Not Disturb. It is
 * deliberately separate from presence, which Sophira works out for itself. Choosing "Busy"
 * does not make someone Online and closing the tab does not clear their choice - the two
 * questions ("is this account connected?" and "what did the person ask me to say?") stay
 * apart, which is exactly how the server computes them.
 *
 * Three honesties are built in:
 *   - nothing is shown as saved until the server has confirmed it, and a refusal is repeated
 *     in the server's own words rather than swallowed;
 *   - when the availability cannot be read at all, the control says so and offers a retry
 *     instead of displaying a default the member never chose;
 *   - the sharing preference says what it actually does - the database lets other signed-in
 *     members read this one row when it is on, and nothing else about them.
 */

const CHOICES = [
  { id: "available", label: "Available", help: "I'm around. Message me." },
  { id: "away", label: "Away", help: "Stepped away for a moment." },
  { id: "busy", label: "Busy", help: "Working. Replies may be slow." },
  { id: "dnd", label: "Do Not Disturb", help: "Please don't interrupt." },
] as const;

type Choice = (typeof CHOICES)[number]["id"];

function isChoice(value: unknown): value is Choice {
  return CHOICES.some((c) => c.id === value);
}

export function AvailabilityControl() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [shareWithMembers, setShareWithMembers] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setUnavailable(null);
    try {
      const res = await fetch("/api/network/presence", { cache: "no-store" });
      if (!res.ok) {
        setUnavailable(
          "Your availability could not be read just now. Nothing has been changed, and your previous choice is still in place.",
        );
        return;
      }
      const body = (await res.json()) as { availability?: unknown; shareWithMembers?: unknown };
      // A value Sophira does not recognise is reported as unreadable rather than quietly
      // replaced with "Available", which would be inventing a choice on the member's behalf.
      if (!isChoice(body.availability)) {
        setUnavailable(
          "Sophira could not tell what your availability is set to. Nothing has been changed.",
        );
        return;
      }
      setChoice(body.availability);
      setShareWithMembers(body.shareWithMembers === true);
    } catch {
      setUnavailable(
        "Your availability could not be read, possibly because the connection dropped. Nothing has been changed.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: Choice, share: boolean) {
    setSaving(true);
    setNotice(null);
    const chosenLabel = CHOICES.find((c) => c.id === next)?.label ?? next;
    try {
      const res = await fetch("/api/network/presence", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ availability: next, share_with_members: share }),
      });
      const body = (await res.json().catch(() => ({}))) as { availability?: unknown; error?: string };
      if (!res.ok) {
        setNotice({
          tone: "bad",
          text: body.error || "Your availability could not be saved. Nothing has been changed.",
        });
        return;
      }
      // Only trust what the server says it stored.
      const stored = isChoice(body.availability) ? body.availability : null;
      if (!stored) {
        setNotice({
          tone: "bad",
          text: "Sophira saved something but could not confirm what. Please reopen this page to see your availability.",
        });
        await load();
        return;
      }
      setChoice(stored);
      setShareWithMembers(share);
      const storedLabel = CHOICES.find((c) => c.id === stored)?.label ?? stored;
      setNotice({
        tone: "ok",
        text:
          storedLabel === chosenLabel
            ? `You now read ${storedLabel} to Sophira's administrators.`
            : `Sophira stored ${storedLabel} instead of ${chosenLabel}.`,
      });
    } catch {
      setNotice({
        tone: "bad",
        text: "Your availability could not be saved, possibly because the connection dropped. Nothing has been changed.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>How you appear</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-ink-soft">
          This is your own choice, and it is separate from whether you are connected. Sophira
          works out Online, Idle and Offline for itself; what you pick here is what you would
          like people to be told.
        </p>

        {loading ? (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <Spinner /> Reading your current choice…
          </p>
        ) : unavailable ? (
          <div className="space-y-2">
            <p className="text-sm text-ink-soft" role="status">{unavailable}</p>
            <Button variant="secondary" onClick={() => void load()}>Try again</Button>
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              {CHOICES.map((c) => {
                const active = choice === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={active}
                    disabled={saving}
                    onClick={() => void save(c.id, shareWithMembers)}
                    className={
                      "rounded-lg border px-3 py-2 text-left transition disabled:opacity-60 " +
                      (active
                        ? "border-accent bg-accent-soft text-ink"
                        : "border-line bg-surface text-ink hover:border-accent")
                    }
                  >
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="block text-xs text-ink-soft">{c.help}</span>
                  </button>
                );
              })}
            </div>

            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-1"
                checked={shareWithMembers}
                disabled={saving}
                onChange={(e) => {
                  // No fallback value: if the current choice is not known, there is nothing
                  // honest to save, and the control is already showing that.
                  if (choice) void save(choice, e.target.checked);
                }}
              />
              <span>
                Let other members see my availability.
                <span className="mt-1 block text-xs text-ink-soft">
                  Only this one line is shared - whether you are Available, Away, Busy or Do Not
                  Disturb. Not your work, not your conversations, not anything else.
                </span>
              </span>
            </label>
          </>
        )}

        {saving && (
          <p className="flex items-center gap-2 text-xs text-ink-soft">
            <Spinner /> Saving…
          </p>
        )}
        {notice && (
          <p
            role="status"
            className={notice.tone === "ok" ? "text-sm text-ink-soft" : "text-sm text-danger"}
          >
            {notice.text}
          </p>
        )}
        <p className="text-xs text-ink-soft">
          Sophira&apos;s administrators can see your availability on the Members page. They cannot
          see your assignments, documents or conversations from there.
        </p>
      </CardContent>
    </Card>
  );
}
