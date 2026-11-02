"use client";
/**
 * GRADUAL INSERTION (Stage 4, 2026-11-02).
 *
 * Lets a student watch a long approved text land in their Google Doc and stay in
 * control: pause, resume, stop, cancel. Progress shown is what GOOGLE confirmed,
 * never an estimate. Stopping keeps whatever was not written as a recovery copy.
 *
 * This is not typing simulation: no artificial delays, no injected mistakes, no
 * invented revision trail. See GRADUAL_DISCLAIMER.
 */
import { useCallback, useMemo, useRef, useState } from "react";

type ChunkResponse = {
  ok: boolean; done?: boolean; conflict?: boolean; stopped?: boolean;
  inserted_chars?: number; remaining_chars?: number; recovery_copy_event_id?: string | null;
  message?: string; error?: string;
};

const card = "rounded-lg border border-line bg-card p-3";
const btn = "rounded-md border border-line px-2.5 py-1.5 text-xs font-medium text-ink-soft hover:bg-ink/5 disabled:opacity-50";

export function GradualInsertPanel({ documentId, documentTitle }: { documentId: string; documentTitle?: string | null }) {
  const [text, setText] = useState("");
  const [heading, setHeading] = useState("");
  const [status, setStatus] = useState<"idle" | "running" | "paused" | "done" | "stopped" | "conflict" | "failed">("idle");
  const [inserted, setInserted] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const paused = useRef(false);
  const stopped = useRef(false);

  const total = text.replace(/\r\n/g, "\n").length;
  const pct = total > 0 ? Math.min(100, Math.floor((inserted / total) * 100)) : 0;

  const progressText = useMemo(() => {
    if (status === "idle") return "Nothing has been written yet.";
    if (status === "running") return `Inserting… ${pct}% (${inserted.toLocaleString()} of ${total.toLocaleString()} characters confirmed by Google).`;
    if (status === "paused") return `Paused at ${pct}%. What was confirmed is already in the document.`;
    if (status === "done") return "Finished. Google confirmed the whole insertion.";
    if (status === "stopped") return `Stopped at ${pct}%. The text already inserted stays in the document.`;
    if (status === "conflict") return "Stopped because the document changed while inserting. Nothing further was written.";
    return `Stopped after an error at ${pct}%. What was written stays in the document.`;
  }, [status, pct, inserted, total]);

  const run = useCallback(async () => {
    paused.current = false;
    stopped.current = false;
    setStatus("running");
    setBusy(true);
    let confirmed = inserted;
    try {
      for (;;) {
        if (paused.current) { setStatus("paused"); break; }
        if (stopped.current) break;
        const res = await fetch("/api/integrations/google/doc-update/gradual", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            document_id: documentId, text, section_heading: heading.trim(),
            inserted_chars: confirmed, max_chunks: 3,
          }),
        });
        const json = (await res.json()) as ChunkResponse;
        if (typeof json.inserted_chars === "number") { confirmed = json.inserted_chars; setInserted(confirmed); }
        if (json.conflict) { setStatus("conflict"); setNote(json.error ?? "The document changed, so Sophira stopped."); break; }
        if (!json.ok) { setStatus("failed"); setNote(json.error ?? "The insertion stopped."); break; }
        if (json.done) { setStatus("done"); setNote(json.message ?? null); break; }
      }
    } catch {
      // A network drop is not data loss: the next Start continues from `inserted`.
      setStatus("failed");
      setNote("The connection dropped. Nothing was lost — press Continue to carry on from where Google confirmed.");
    } finally { setBusy(false); }
  }, [documentId, text, heading, inserted]);

  const pause = useCallback(() => { paused.current = true; setStatus("paused"); }, []);
  const resume = useCallback(() => { void run(); }, [run]);

  const stop = useCallback(async () => {
    stopped.current = true; paused.current = true; setBusy(true);
    try {
      const res = await fetch("/api/integrations/google/doc-update/gradual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: documentId, text, section_heading: heading.trim(), inserted_chars: inserted, action: "stop" }),
      });
      const json = (await res.json()) as ChunkResponse;
      setStatus("stopped");
      setNote(json.message ?? "Stopped. The rest of your text is kept as a recovery copy.");
    } catch {
      setStatus("stopped");
      setNote("Stopped. The rest of your text stays in this box — copy it before you leave the page.");
    } finally { setBusy(false); }
  }, [documentId, text, heading, inserted]);

  const cancel = useCallback(() => {
    stopped.current = true; paused.current = true;
    setStatus("idle"); setInserted(0); setNote("Cancelled. Nothing was written.");
  }, []);

  const running = status === "running";

  return (
    <div className={card}>
      <p className="text-sm font-medium text-ink">Insert text in steps{documentTitle ? ` into “${documentTitle}”` : ""}</p>
      <p className="mt-1 text-xs text-ink-soft">
        Optional. Sophira writes your approved text in a few confirmed steps so you can watch progress and stop at any point.
        Every step is a real change confirmed by Google. Sophira does not imitate typing or add mistakes on purpose.
      </p>

      <label className="mt-2 block text-xs text-ink-soft" htmlFor="gi-text">Text to insert</label>
      <textarea id="gi-text" className="mt-1 w-full rounded-md border border-line bg-paper p-2 text-xs" rows={5}
        value={text} onChange={(e) => setText(e.target.value)} disabled={running || status === "paused"} />

      <label className="mt-2 block text-xs text-ink-soft" htmlFor="gi-heading">Place under which heading? (optional)</label>
      <input id="gi-heading" className="mt-1 w-full rounded-md border border-line bg-paper p-2 text-xs"
        value={heading} onChange={(e) => setHeading(e.target.value)} disabled={running || status === "paused"} />

      <div className="mt-2 h-2 w-full overflow-hidden rounded bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink">{progressText}</p>
      {note && <p className="mt-1 text-xs text-ink-soft">{note}</p>}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {status === "idle" && <button type="button" className={btn} disabled={busy || !text.trim() || !documentId} onClick={() => void run()}>Start</button>}
        {running && <button type="button" className={btn} onClick={pause}>Pause</button>}
        {(status === "paused" || status === "failed") && <button type="button" className={btn} disabled={busy} onClick={resume}>Continue</button>}
        {(running || status === "paused") && <button type="button" className={btn} disabled={busy} onClick={() => void stop()}>Stop and keep a copy</button>}
        {status === "idle" && <button type="button" className={btn} onClick={cancel}>Clear</button>}
      </div>
    </div>
  );
}
