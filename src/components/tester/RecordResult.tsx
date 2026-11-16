"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { OUTCOME_LABEL, type TestOutcome } from "@/lib/tester/test-library";

/**
 * RECORD WHAT HAPPENED (2026-11-16).
 *
 * One numbered test, four honest answers. "Could not run" is a first-class choice beside passed and
 * failed, because a tester with no account or no key must be able to say so rather than leaving the
 * test looking untested or, worse, ticking it.
 *
 * The server decides whether the result is acceptable. This form only refuses to send an empty one.
 */
const CHOICES: { value: TestOutcome; hint: string }[] = [
  { value: "passed", hint: "It did what the test says it should." },
  { value: "failed", hint: "It did not, or it errored." },
  { value: "blocked", hint: "I could not run it at all (no account, no key, no device)." },
  { value: "skipped", hint: "I chose not to run it this time." },
];

export function RecordResult({ testCaseId, code }: { testCaseId: string; code: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<TestOutcome | "">("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!outcome) {
      setError("Choose what happened first.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/tester/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test_case_id: testCaseId, outcome, notes }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "That could not be saved. Nothing was recorded.");
        return;
      }
      setMessage(data.message ?? `${code} recorded.`);
      setNotes("");
      setOutcome("");
      setOpen(false);
      router.refresh();
    } catch {
      setError("The connection dropped, so nothing was recorded. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      {message ? (
        <p className="text-sm text-success" role="status">
          {message}
        </p>
      ) : null}

      {open ? (
        <div className="mt-2 space-y-2 rounded-lg border border-line p-3">
          <fieldset>
            <legend className="meta-strong">What happened when you ran {code}?</legend>
            <div className="mt-2 space-y-1">
              {CHOICES.map((choice) => (
                <label key={choice.value} className="flex items-start gap-2 text-sm text-ink">
                  <input
                    type="radio"
                    name={`outcome-${testCaseId}`}
                    value={choice.value}
                    checked={outcome === choice.value}
                    onChange={() => setOutcome(choice.value)}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{OUTCOME_LABEL[choice.value]}</span>
                    <span className="block text-ink-soft">{choice.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block text-sm text-ink">
            <span className="meta-strong">Anything worth knowing? (optional)</span>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What you saw, in your own words."
              maxLength={2000}
              className="mt-1"
            />
          </label>

          {error ? (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button onClick={save} disabled={busy || !outcome}>
              {busy ? "Saving…" : "Save the result"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Record a result
        </Button>
      )}
    </div>
  );
}
