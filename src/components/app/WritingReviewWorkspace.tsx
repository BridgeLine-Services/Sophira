"use client";
/**
 * WRITING REVIEW WORKSPACE (Stage 3, 2026-11-02).
 *
 * Rules this UI enforces, because they are the whole point of the feature:
 *  * The student's ORIGINAL text is never overwritten by a review run.
 *  * Every finding is shown with its evidence and can be accepted or rejected on
 *    its own. Accepting a suggestion that needs judgement does nothing automatic.
 *  * Sophira never claims to have searched the internet and never shows a
 *    similarity percentage, because it has neither.
 */
import { useCallback, useMemo, useState } from "react";
import { ALL_GOALS, applyAcceptedChanges, type ReviewFinding, type WritingGoal } from "@/lib/writing/review";

interface ReviewResponse {
  ok: boolean;
  summary?: string;
  notes?: string[];
  counts?: { originality: number; quality: number; citation: number; fixable: number };
  findings?: ReviewFinding[];
  empty?: boolean;
  error?: string;
  scope?: { compared: number; internetSearch: boolean; detectorUsed: boolean };
}

interface PastedSource {
  id: string;
  title: string;
  content: string;
}

const card = "panel p-4";
const btn = "rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-ink/5 disabled:opacity-50";
const primary = "rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50";

const CATEGORY_LABEL: Record<string, string> = {
  originality: "Compared with your sources",
  quality: "Writing",
  citation: "Citations",
};

export function WritingReviewWorkspace() {
  const [draft, setDraft] = useState("");
  const [goals, setGoals] = useState<WritingGoal[]>(["clarity", "transitions"]);
  const [sources, setSources] = useState<PastedSource[]>([]);
  const [srcTitle, setSrcTitle] = useState("");
  const [srcBody, setSrcBody] = useState("");
  const [result, setResult] = useState<ReviewResponse | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const [rejected, setRejected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const findings = useMemo<ReviewFinding[]>(() => result?.findings ?? [], [result]);

  const revision = useMemo(
    () => (result ? applyAcceptedChanges(draft, findings, accepted) : { text: draft, applied: [], skipped: [] }),
    [draft, findings, accepted, result]
  );

  const toggleGoal = (id: WritingGoal) =>
    setGoals((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));

  const addSource = () => {
    if (srcBody.trim().length === 0) return;
    setSources((s) => [
      ...s,
      { id: `pasted-${s.length + 1}`, title: srcTitle.trim() || `Source ${s.length + 1}`, content: srcBody },
    ]);
    setSrcTitle("");
    setSrcBody("");
  };

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setAccepted([]);
    setRejected([]);
    setConfirmed(false);
    try {
      const res = await fetch("/api/writing/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft, goals, sources }),
      });
      const json = (await res.json()) as ReviewResponse;
      if (!res.ok || !json.ok) {
        setError(json.error ?? "Sophira could not review that draft just now. Nothing was changed.");
        return;
      }
      setResult(json);
    } catch {
      setError("Sophira could not reach the reviewer just now. Your text is untouched — try again in a moment.");
    } finally {
      setBusy(false);
    }
  }, [draft, goals, sources]);

  const accept = (id: string) => {
    setAccepted((a) => (a.includes(id) ? a : [...a, id]));
    setRejected((r) => r.filter((x) => x !== id));
  };
  const reject = (id: string) => {
    setRejected((r) => (r.includes(id) ? r : [...r, id]));
    setAccepted((a) => a.filter((x) => x !== id));
  };

  return (
    <div className="space-y-4">
      <div className={card}>
        <label htmlFor="draft" className="block text-sm font-medium text-ink">
          Your draft
        </label>
        <p className="mb-2 text-xs text-ink-soft">
          Nothing here is submitted anywhere. Sophira reads it, explains what it notices, and waits for your decisions.
        </p>
        <textarea
          id="draft"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={10}
          className="w-full rounded-lg border border-line bg-card p-3 text-[15px] text-ink"
          placeholder="Paste your essay or open an assignment to work on it."
        />
        <p className="mt-1 text-xs text-ink-soft">{draft.trim() ? `${draft.trim().split(/\s+/).length} words` : "Nothing pasted yet"}</p>
      </div>

      <div className={card}>
        <p className="text-sm font-medium text-ink">What would you like help with?</p>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ALL_GOALS.map((g) => (
            <label key={g.id} className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={goals.includes(g.id)} onChange={() => toggleGoal(g.id)} />
              {g.label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-ink-soft">
          Serious problems, such as a missing citation, are always shown even if you did not tick that box.
        </p>
      </div>

      <div className={card}>
        <p className="text-sm font-medium text-ink">Sources to compare against (optional)</p>
        <p className="text-xs text-ink-soft">
          Add the readings your course gave you. Sophira compares your draft only with what you add here. It does not search the internet or any database.
        </p>
        <div className="mt-2 space-y-2">
          <input aria-label="Source title (for example: Smith 2023)"
            value={srcTitle}
            onChange={(e) => setSrcTitle(e.target.value)}
            placeholder="Source title (for example: Smith 2023)"
            className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
          />
          <textarea aria-label="Paste the source text"
            value={srcBody}
            onChange={(e) => setSrcBody(e.target.value)}
            rows={4}
            placeholder="Paste the source text"
            className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
          />
          <button type="button" className={btn} onClick={addSource}>Add this source</button>
        </div>
        {sources.length > 0 && (
          <ul className="mt-2 space-y-1">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center justify-between text-xs text-ink-soft">
                <span>{s.title} · {s.content.trim().split(/\s+/).length} words</span>
                <button type="button" className={btn} onClick={() => setSources((all) => all.filter((x) => x.id !== s.id))}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className={primary} onClick={run} disabled={busy || draft.trim().length === 0}>
          {busy ? "Reviewing…" : "Review my writing"}
        </button>
        {result?.summary && <span className="text-sm text-ink-soft">{result.summary}</span>}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-danger/30 bg-card p-3 text-sm text-danger">
          {error}
        </div>
      )}

      {result?.notes?.map((n) => (
        <p key={n} className="text-xs text-ink-soft">{n}</p>
      ))}

      {result && findings.length === 0 && !result.empty && (
        <div className={card}>
          <p className="text-sm text-ink">Sophira found nothing to change in this draft.</p>
          <p className="mt-1 text-xs text-ink-soft">That means no problem it can see — not a guarantee about your grade.</p>
        </div>
      )}

      {findings.map((f) => {
        const isAccepted = accepted.includes(f.id);
        const isRejected = rejected.includes(f.id);
        return (
          <div key={f.id} className={`${card} ${isRejected ? "opacity-60" : ""}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-soft">{CATEGORY_LABEL[f.category] ?? f.category}</p>
                <p className="mt-1 text-sm text-ink">{f.message}</p>
              </div>
              <span className="shrink-0 rounded px-2 py-0.5 text-[11px] text-ink-soft">
                {f.severity === "high" ? "Worth fixing" : f.severity === "medium" ? "Consider" : "Minor"}
              </span>
            </div>

            {f.passage && (
              <blockquote className="mt-2 border-l-2 border-line pl-3 text-sm text-ink-soft">{f.passage}</blockquote>
            )}

            {f.sourceTitle && (
              <p className="mt-2 text-xs text-ink-soft">
                From <span className="font-medium">{f.sourceTitle}</span>
                {f.sourceUrl ? <span> · <a className="underline" href={f.sourceUrl} target="_blank" rel="noreferrer">open source</a></span> : null}
              </p>
            )}
            {f.sourcePassage && (
              <p className="mt-1 text-xs text-ink-soft">Their wording: “{f.sourcePassage.slice(0, 240)}”</p>
            )}
            {f.advice && <p className="mt-2 text-xs text-ink-soft">{f.advice}</p>}

            <div className="mt-3 flex gap-2">
              {isAccepted ? (
                <span className="text-xs text-success">Accepted{typeof f.replacement === "string" ? " — included in your revision below" : " — you will need to make this edit yourself"}</span>
              ) : isRejected ? (
                <span className="text-xs text-ink-soft">Rejected — your text stays as it is</span>
              ) : (
                <>
                  <button type="button" className={btn} onClick={() => accept(f.id)}>Accept</button>
                  <button type="button" className={btn} onClick={() => reject(f.id)}>Reject</button>
                </>
              )}
            </div>
          </div>
        );
      })}

      {result && findings.length > 0 && (
        <div className={card}>
          <p className="text-sm font-medium text-ink">Your revision so far</p>
          <p className="mt-1 text-xs text-ink-soft">
            Your original text is kept exactly as you wrote it. Nothing replaces it until you press the button below.
          </p>
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-ink/5 p-3 text-sm text-ink">{revision.text}</pre>
          {accepted.length === 0 && (
            <p className="mt-2 text-xs text-ink-soft">No suggestions accepted yet, so this is identical to your original.</p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              className={primary}
              onClick={() => {
                setDraft(revision.text);
                setConfirmed(true);
              }}
              disabled={accepted.length === 0 || revision.text === draft}
            >
              Use this version
            </button>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setAccepted([]);
                setRejected([]);
                setConfirmed(false);
              }}
            >
              Clear my decisions
            </button>
            {confirmed && <span className="text-xs text-success">Your draft now shows the accepted changes. Accepted {accepted.length}.</span>}
          </div>
        </div>
      )}
    </div>
  );
}
