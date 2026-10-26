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
interface Selection { id: string; provider: string; provider_document_id?: string | null; document_title: string | null; scope_description: string | null; status: string; }
interface HistoryEvent { id: string; event_type: string; outcome: string; sequence: number; summary: string; provenance: string; recorded_at: string; provider_revision: string | null; target_section: string | null; has_snapshot: boolean; snapshot_truncated: boolean; }
interface CompareResult { ok: boolean; added: string[]; removed: string[]; unchangedCount: number; truncated: boolean; note: string; }
interface MsVersion { id: string; lastModifiedDateTime: string | null; }

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
  const [historyFor, setHistoryFor] = useState<Selection | null>(null);
  const [historyEvents, setHistoryEvents] = useState<HistoryEvent[]>([]);
  const [historyNote, setHistoryNote] = useState<string | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [msVersions, setMsVersions] = useState<MsVersion[] | null>(null);
  const [msEtag, setMsEtag] = useState<string | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);

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

  const openHistory = useCallback(async (sel: Selection) => {
    const docId = sel.provider_document_id ?? "";
    setHistoryFor(sel); setHistoryEvents([]); setCompare(null); setMsVersions(null); setMsEtag(null); setHistoryNote(null);
    if (!docId) { setHistoryNote("This selection has no stored document id, so Sophira cannot load its history."); return; }
    setHistoryBusy(true);
    try {
      const res = await fetch(`/api/integrations/document-history?provider=${sel.provider}&document_id=${encodeURIComponent(docId)}`);
      const json = (await res.json()) as { ok: boolean; events?: HistoryEvent[]; disclaimer?: string; error?: string };
      if (json.ok) { setHistoryEvents(json.events ?? []); setHistoryNote(json.disclaimer ?? null); }
      else setHistoryNote(json.error ?? "The history could not be loaded.");
    } catch { setHistoryNote("The history could not be loaded."); }
    finally { setHistoryBusy(false); }
  }, []);

  const observeChanges = useCallback(async () => {
    if (!historyFor?.provider_document_id) return;
    setHistoryBusy(true);
    try {
      const res = await fetch("/api/integrations/document-history", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "observe", provider: historyFor.provider, document_id: historyFor.provider_document_id }),
      });
      const json = (await res.json()) as { ok: boolean; changed?: boolean; note?: string; error?: string };
      setHistoryNote(json.ok ? (json.note ?? null) : (json.error ?? "The check failed."));
      await openHistory(historyFor);
    } catch { setHistoryNote("The check failed."); }
    finally { setHistoryBusy(false); }
  }, [historyFor, openHistory]);

  const compareVersions = useCallback(async () => {
    if (!historyFor?.provider_document_id) return;
    setHistoryBusy(true);
    try {
      const res = await fetch(`/api/integrations/document-history?provider=${historyFor.provider}&document_id=${encodeURIComponent(historyFor.provider_document_id)}&compare=1`);
      const json = (await res.json()) as { ok: boolean; compare?: CompareResult; error?: string };
      setCompare(json.compare ?? null);
      if (!json.ok) setHistoryNote(json.error ?? "The comparison could not be loaded.");
    } catch { setHistoryNote("The comparison could not be loaded."); }
    finally { setHistoryBusy(false); }
  }, [historyFor]);

  const createRecoveryCopy = useCallback(async (eventId: string) => {
    if (!window.confirm("Sophira will create a NEW Google Doc from the preserved version. Your original document is not modified. Continue?")) return;
    setHistoryBusy(true);
    try {
      const res = await fetch("/api/integrations/document-history", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recovery_copy", event_id: eventId }),
      });
      const json = (await res.json()) as { ok: boolean; url?: string; note?: string; error?: string };
      if (json.ok && json.url) { setHistoryNote(`Recovery copy created: ${json.url}`); window.open(json.url, "_blank", "noopener"); }
      else setHistoryNote(json.error ?? "The recovery copy could not be created.");
    } catch { setHistoryNote("The recovery copy could not be created."); }
    finally { setHistoryBusy(false); }
  }, []);

  const loadVersions = useCallback(async () => {
    const docId = historyFor?.provider_document_id;
    if (!docId) return;
    setHistoryBusy(true);
    try {
      const res = await fetch(`/api/integrations/microsoft/documents?item_id=${encodeURIComponent(docId)}&versions=1`);
      const json = (await res.json()) as { ok: boolean; item?: { eTag: string | null }; versions?: { ok: boolean; items: MsVersion[]; error: string | null }; error?: string };
      if (json.ok && json.item) { setMsEtag(json.item.eTag); setMsVersions(json.versions?.items ?? []); if (json.versions && !json.versions.ok) setHistoryNote(json.versions.error); }
      else setHistoryNote(json.error ?? "The versions could not be loaded.");
    } catch { setHistoryNote("The versions could not be loaded."); }
    finally { setHistoryBusy(false); }
  }, [historyFor]);

  const restoreVersion = useCallback(async (versionId: string) => {
    const docId = historyFor?.provider_document_id;
    if (!docId || !msEtag) return;
    if (!window.confirm("Restoring this version will REPLACE the current file content in OneDrive. Sophira will keep OneDrive's version history as the recoverable copy. Continue?")) return;
    setHistoryBusy(true);
    try {
      const res = await fetch("/api/integrations/document-history", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore_version", item_id: docId, version_id: versionId, expected_etag: msEtag }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      setHistoryNote(json.ok ? "The version was restored and recorded in history." : (json.error ?? "The restore failed."));
      await loadVersions();
    } catch { setHistoryNote("The restore failed."); }
    finally { setHistoryBusy(false); }
  }, [historyFor, msEtag, loadVersions]);

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
                <span className="flex gap-2">
                  <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => void openHistory(s)}>History</button>
                  <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => void removeSelection(s.id)}>Remove</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {historyFor && (
        <div className="mt-4 rounded-md border border-dashed p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Document history — {historyFor.document_title ?? "Untitled"}</p>
            <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => setHistoryFor(null)}>Close</button>
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">{historyNote ?? "Loading history…"}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="rounded-md border px-2 py-1 text-xs disabled:opacity-50" disabled={historyBusy} onClick={() => void observeChanges()}>Check for changes outside Sophira</button>
            <button type="button" className="rounded-md border px-2 py-1 text-xs disabled:opacity-50" disabled={historyBusy} onClick={() => void compareVersions()}>Compare last two versions</button>
            {historyFor.provider === "microsoft" && (
              <button type="button" className="rounded-md border px-2 py-1 text-xs disabled:opacity-50" disabled={historyBusy} onClick={() => void loadVersions()}>Show OneDrive versions</button>
            )}
          </div>
          {compare && (
            <div className="mt-3 rounded-md border p-2 text-xs">
              <p className="font-medium">{compare.ok ? `Added ${compare.added.length} line(s), removed ${compare.removed.length} line(s).` : "Comparison unavailable."}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">{compare.note}</p>
              {compare.removed.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Removed</p>
                  <ul className="mt-1 space-y-0.5">{compare.removed.slice(0, 40).map((l, i) => <li key={i} className="rounded bg-red-500/10 px-1 font-mono text-[10px]">{l.slice(0, 160)}</li>)}</ul>
                </div>
              )}
              {compare.added.length > 0 && (
                <div className="mt-2">
                  <p className="text-[10px] font-semibold uppercase text-muted-foreground">Added</p>
                  <ul className="mt-1 space-y-0.5">{compare.added.slice(0, 40).map((l, i) => <li key={i} className="rounded bg-emerald-500/10 px-1 font-mono text-[10px]">{l.slice(0, 160)}</li>)}</ul>
                </div>
              )}
              {compare.truncated && <p className="mt-1 text-[10px] text-amber-600">The comparison was truncated for size; open the versions individually for full detail.</p>}
            </div>
          )}
          {msVersions && (
            <div className="mt-3 rounded-md border p-2 text-xs">
              <p className="font-medium">OneDrive versions {msEtag ? "" : "(version check unavailable — restore disabled)"}</p>
              {msVersions.length === 0 && <p className="mt-1 text-[10px] text-muted-foreground">No version history is available for this file.</p>}
              <ul className="mt-1 space-y-1">
                {msVersions.slice(0, 10).map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2">
                    <span className="text-[10px]">{v.lastModifiedDateTime ? new Date(v.lastModifiedDateTime).toLocaleString() : v.id.slice(0, 12)}</span>
                    <button type="button" className="rounded-md border px-2 py-0.5 text-[10px] disabled:opacity-50" disabled={historyBusy || !msEtag} onClick={() => void restoreVersion(v.id)}>Restore this version</button>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-muted-foreground">Restoring replaces the current file content; it is refused if the file changed since this check.</p>
            </div>
          )}
          <ul className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1">
            {historyEvents.length === 0 && <li className="text-[10px] text-muted-foreground">No recorded events yet. Sophira records writes it performs and versions it observes — it cannot see every keystroke in Word or Google Docs.</li>}
            {historyEvents.map((e) => (
              <li key={e.id} className="rounded-md border p-2">
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded bg-muted px-1 py-0.5 uppercase">{e.event_type.replace(/_/g, " ")}</span>
                  <span className={e.outcome === "confirmed" ? "text-emerald-600" : e.outcome === "conflicted" ? "text-amber-600" : "text-muted-foreground"}>{e.outcome}</span>
                  <span className="text-muted-foreground">{new Date(e.recorded_at).toLocaleString()}</span>
                  <span className="rounded bg-muted px-1 py-0.5">{e.provenance}</span>
                </div>
                <p className="mt-1 text-xs">{e.summary}</p>
                {e.target_section && <p className="text-[10px] text-muted-foreground">Section: {e.target_section}</p>}
                {e.has_snapshot && historyFor.provider === "google" && (
                  <button type="button" className="mt-1 rounded-md border px-2 py-0.5 text-[10px] disabled:opacity-50" disabled={historyBusy} onClick={() => void createRecoveryCopy(e.id)}>
                    Create recovery copy from this version{e.snapshot_truncated ? " (truncated)" : ""}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
