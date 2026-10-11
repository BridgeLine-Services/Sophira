"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * DOCUMENT BROWSER + WORKLOAD SELECTION (2026-10-12).
 * The signed-in user browses documents their OWN connected provider
 * account can see, optionally enables read-only Drive browsing (Google),
 * selects a document, and states the workload scope for the AI task.
 * Listed never means writable; every state below is honest.
 */

interface DiscoveredDoc { id: string; title: string; url: string | null; mime: string; shared: boolean; owner: string | null; access: "listed"; }
interface Selection { id: string; provider: string; document_title: string | null; scope_description: string | null; status: string; }

export default function DocumentBrowser() {
  const [provider, setProvider] = useState<"microsoft" | "google">("microsoft");
  const [files, setFiles] = useState<DiscoveredDoc[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [browseEnabled, setBrowseEnabled] = useState<boolean | null>(null);
  const [consentUrl, setConsentUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<DiscoveredDoc | null>(null);
  const [scope, setScope] = useState("");
  const [selections, setSelections] = useState<Selection[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const loadSelections = useCallback(async () => {
    const res = await fetch("/api/integrations/selections");
    const json = (await res.json()) as { ok: boolean; selections?: Selection[] };
    if (json.ok && json.selections) setSelections(json.selections);
  }, []);

  useEffect(() => { void loadSelections(); }, [loadSelections]);

  const browse = useCallback(async (p: "microsoft" | "google") => {
    setBusy(true); setMessage(null); setProvider(p); setFiles([]); setNote(null); setChosen(null);
    try {
      const res = await fetch(`/api/integrations/${p}/files`);
      const json = (await res.json()) as { ok: boolean; files?: DiscoveredDoc[]; note?: string | null; browse_enabled?: boolean; browse_consent_url?: string | null };
      setFiles(json.files ?? []);
      setNote(json.note ?? null);
      if (p === "google") {
        setBrowseEnabled(json.browse_enabled ?? false);
        setConsentUrl(json.browse_consent_url ?? null);
      }
      if (!json.ok) setMessage("The document list could not be loaded — see the note for the exact reason.");
    } catch { setMessage("The document list could not be loaded."); }
    finally { setBusy(false); }
  }, []);

  const enableBrowse = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/google/authorize?intent=browse", { method: "POST" });
      const json = (await res.json()) as { ok: boolean; url?: string };
      if (json.ok && json.url) window.location.href = json.url;
      else setMessage("Drive browsing could not be enabled yet.");
    } catch { setMessage("Drive browsing could not be enabled yet."); }
    finally { setBusy(false); }
  }, []);

  const confirmSelection = useCallback(async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const res = await fetch("/api/integrations/selections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider, provider_document_id: chosen.id, document_title: chosen.title,
          document_url: chosen.url, access_state: "unverified",
          scope_description: scope.trim() || null,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (json.ok) { setMessage(`Selected "${chosen.title}". Sophira will assist only with the scope you stated.`); setChosen(null); setScope(""); await loadSelections(); }
      else setMessage(json.error ?? "The selection could not be saved.");
    } catch { setMessage("The selection could not be saved."); }
    finally { setBusy(false); }
  }, [chosen, provider, scope, loadSelections]);

  const removeSelection = useCallback(async (id: string) => {
    await fetch(`/api/integrations/selections/${id}`, { method: "DELETE" });
    await loadSelections();
  }, [loadSelections]);

  return (
    <div className="mt-6 rounded-lg border p-4">
      <p className="text-sm font-semibold">Documents &amp; workload scope</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Browse documents your connected account can see, pick one, and state the section or questions Sophira should work on. Sophira only ever works for you, within the scope you set.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => void browse("microsoft")}>Browse Microsoft files</button>
        <button type="button" className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50" disabled={busy} onClick={() => void browse("google")}>Browse Google files</button>
      </div>
      {browseEnabled === false && consentUrl && (
        <button type="button" className="mt-2 rounded-md border px-3 py-1.5 text-xs disabled:opacity-50" disabled={busy} onClick={() => void enableBrowse()}>
          Enable Drive browsing (optional — adds read-only consent so shared files appear)
        </button>
      )}
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      {message && <p className="mt-2 text-xs text-amber-600">{message}</p>}
      {files.length > 0 && (
        <ul className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
              <span className="text-sm">
                {f.title}
                {f.shared && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">shared{f.owner ? ` · ${f.owner}` : ""}</span>}
              </span>
              <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => setChosen(f)}>Use this document</button>
            </li>
          ))}
        </ul>
      )}
      {chosen && (
        <div className="mt-3 rounded-md border p-3">
          <p className="text-sm font-medium">{chosen.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">State the workload scope — e.g. &quot;Section A: introduction (first 3 paragraphs)&quot; or &quot;questions 4-6 only&quot;.</p>
          <textarea className="mt-2 w-full rounded-md border p-2 text-sm" rows={2} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="Your assigned section, questions, or deliverables" />
          <div className="mt-2 flex gap-2">
            <button type="button" className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50" disabled={busy} onClick={() => void confirmSelection()}>Confirm scope</button>
            <button type="button" className="rounded-md border px-3 py-1.5 text-sm" onClick={() => { setChosen(null); setScope(""); }}>Cancel</button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Reading a shared document never makes its other sections your work. Non-Sophira collaborators keep using Word or Google normally; Sophira creates no profile for them.</p>
        </div>
      )}
      {selections.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your active workload selections</p>
          <ul className="mt-2 space-y-1.5">
            {selections.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                <span className="text-sm">
                  <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{s.provider}</span>
                  {s.document_title ?? "Untitled"}
                  {s.scope_description && <span className="mt-0.5 block text-xs text-muted-foreground">Scope: {s.scope_description}</span>}
                </span>
                <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => void removeSelection(s.id)}>Remove</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
