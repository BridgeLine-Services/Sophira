"use client";
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Spinner, useToast } from "@/components/ui";
import {
  Search, ExternalLink, CheckCircle2, XCircle, ShieldAlert, BookOpenCheck, ChevronDown, ChevronRight,
} from "lucide-react";

interface SourceRow {
  id: string;
  title: string;
  author: string | null;
  publisher: string | null;
  publication_date: string | null;
  final_url: string;
  original_url: string;
  verification_status: "verified" | "partially_verified" | "unverified" | "failed" | "inaccessible";
  verification_notes: string;
  approval: "pending" | "approved" | "rejected";
  http_status: number | null;
  redirect_count: number;
  content_chars: number;
}

interface ProjectData {
  project: { id: string; topic: string; status: string; failure_reason: string };
  queries: { id: string; query: string; status: string }[];
  sources: SourceRow[];
  claims: { id: string; claim: string; status: string; source_id: string | null }[];
}

interface AuditData {
  citations_matched: { marker: string; title: string }[];
  citations_unmatched: string[];
  quote_failures: string[];
  unsupported_claims: { claim: string; reason: string }[];
  ai_assessed: boolean;
  bibliography: string;
  bibliography_present_in_essay: boolean;
  all_cited_sources_live: boolean;
  problems: string[];
  pass: boolean;
}

const VERIF_TONE: Record<string, "success" | "warn" | "danger" | "neutral"> = {
  verified: "success",
  partially_verified: "warn",
  unverified: "neutral",
  failed: "danger",
  inaccessible: "danger",
};

/**
 * Research workspace UI (spec §15): queries, candidate + verified + rejected
 * sources with honest statuses, approve/reject, citation audit, and
 * citation-aware essay generation — all expandable so the writing interface
 * stays clean. Retrieved content is data on the server; nothing here
 * executes or obeys it.
 */
export function ResearchPanel({
  assignmentId,
  defaultTopic,
  latestResponseId,
  onEssayGenerated,
}: {
  assignmentId: string;
  defaultTopic: string;
  latestResponseId: string | null;
  onEssayGenerated?: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [data, setData] = useState<ProjectData | null>(null);
  const [topic, setTopic] = useState(defaultTopic);
  const [sourceType, setSourceType] = useState("any");
  const [minSources, setMinSources] = useState("4");
  const [style, setStyle] = useState("MLA");
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false);
  const [auditing, setAuditing] = useState(false);
  const [audit, setAudit] = useState<AuditData | null>(null);

  const load = useCallback(
    async (pid: string) => {
      const res = await fetch(`/api/research?project_id=${pid}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setData(json.data);
      else toast("error", json.error || "Could not load the research project.");
    },
    [toast]
  );

  async function runResearch() {
    setBusy(true);
    setAudit(null);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: assignmentId,
          topic,
          source_type: sourceType === "any" ? null : sourceType,
          min_sources: Number(minSources) || 4,
          citation_style: style,
        }),
      });
      const json = await res.json();
      if (res.ok && json.data.project_id) {
        setProjectId(json.data.project_id);
        if (json.data.warning) toast("info", json.data.warning);
        await load(json.data.project_id);
        toast(json.data.status === "failed" ? "error" : "success",
          json.data.status === "failed" ? "Research failed — see the details." : "Research complete — review and approve your sources.");
      } else {
        toast("error", json.error || "Research could not run.");
      }
    } catch {
      toast("error", "Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(sourceId: string, action: "approve" | "reject") {
    try {
      const res = await fetch("/api/research", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_id: sourceId, action }),
      });
      const json = await res.json();
      if (res.ok && projectId) await load(projectId);
      else toast("error", json.error || "Could not update the source.");
    } catch {
      toast("error", "Could not reach the server.");
    }
  }

  async function writeFromResearch() {
    if (!projectId) return;
    setWriting(true);
    try {
      const res = await fetch("/api/ai/solve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignment_id: assignmentId,
          mode: "writing",
          research_project_id: projectId,
          question: `Write the researched essay for this assignment using ONLY the approved verified sources from this research project. Cite each source in-text with its [S#] label, and only make claims the sources actually support.`,
        }),
      });
      const json = await res.json();
      if (res.ok) {
        toast("success", "Researched essay generated with a verified bibliography.");
        onEssayGenerated?.();
      } else {
        toast("error", json.error || "The essay could not be generated.");
      }
    } catch {
      toast("error", "Could not reach the server.");
    } finally {
      setWriting(false);
    }
  }

  async function runAudit() {
    if (!projectId) return;
    setAuditing(true);
    try {
      // latest response for this assignment
      const res = await fetch("/api/research/audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, response_id: latestResponseId, style }),
      });
      const json = await res.json();
      if (res.ok) {
        setAudit(json.data);
        toast(json.data.pass ? "success" : "error", json.data.pass ? "Citation audit passed." : "Citation audit found problems — see the details.");
      } else {
        toast("error", json.error || "The audit could not run.");
      }
    } catch {
      toast("error", "Could not reach the server.");
    } finally {
      setAuditing(false);
    }
  }

  const approved = data?.sources.filter((s) => s.approval === "approved" && (s.verification_status === "verified" || s.verification_status === "partially_verified")) ?? [];

  return (
    <Card>
      <CardHeader>
        <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-4 w-4 text-accent" /> Research
          </CardTitle>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <p className="text-sm text-ink-soft">
            Real server-side web research: Sophira searches an external provider, then fetches and verifies every
            candidate URL itself (redirects, dead links, paywalls and thin pages are detected and reported). Nothing
            is fabricated — sources that can&apos;t be verified are shown as exactly that.
          </p>

          {!projectId && (
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <Label htmlFor="topic">Research topic</Label>
                <Input id="topic" className="mt-1.5" value={topic} onChange={(e) => setTopic(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="stype">Source type</Label>
                <Select id="stype" className="mt-1.5" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
                  <option value="any">Any reputable</option>
                  <option value="peer-reviewed">Peer-reviewed</option>
                  <option value="government">Government</option>
                  <option value="university">University</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="mins">Sources needed</Label>
                <Input id="mins" type="number" min={1} max={10} className="mt-1.5" value={minSources} onChange={(e) => setMinSources(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cite">Citation style</Label>
                <Select id="cite" className="mt-1.5" value={style} onChange={(e) => setStyle(e.target.value)}>
                  <option value="MLA">MLA</option>
                  <option value="APA">APA</option>
                  <option value="CHICAGO">Chicago</option>
                  <option value="generic">Generic</option>
                </Select>
              </div>
              <div className="sm:col-span-3" />
              <div>
                <Button className="w-full" onClick={runResearch} disabled={busy || topic.trim().length < 3}>
                  {busy ? <Spinner className="h-4 w-4" /> : <Search className="h-4 w-4" />} Run research
                </Button>
              </div>
            </div>
          )}

          {data && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Badge tone="neutral">{data.queries.length} queries</Badge>
                <Badge tone="neutral">{data.sources.length} candidate sources</Badge>
                <Badge tone="success">{approved.length} approved &amp; verified</Badge>
                <Badge tone="danger">{data.sources.filter((s) => s.verification_status === "failed" || s.verification_status === "inaccessible").length} dead/blocked</Badge>
              </div>
              {data.project.status === "failed" && (
                <p className="rounded-lg bg-danger/10 p-3 text-sm text-ink">
                  <ShieldAlert className="mr-1.5 inline h-4 w-4 text-danger" />
                  {data.project.failure_reason || "Research failed — no sources were fabricated."}
                </p>
              )}
              {data.queries.length > 0 && (
                <details className="rounded-lg border border-ink/10 p-3">
                  <summary className="cursor-pointer text-sm font-medium">Search queries</summary>
                  <ul className="mt-2 space-y-1 text-sm text-ink-soft">
                    {data.queries.map((q) => (
                      <li key={q.id}>{q.query} {q.status === "failed" && <span className="text-danger">(failed)</span>}</li>
                    ))}
                  </ul>
                </details>
              )}
              <ul className="space-y-2">
                {data.sources.map((s) => (
                  <li key={s.id} className="rounded-lg border border-ink/10 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={VERIF_TONE[s.verification_status]}>{s.verification_status.replace(/_/g, " ")}</Badge>
                      <a href={s.final_url || s.original_url} target="_blank" rel="noreferrer" className="font-medium text-ink underline decoration-ink/20 hover:decoration-ink">
                        {s.title || "(no title extracted)"} <ExternalLink className="inline h-3 w-3" />
                      </a>
                      {s.author && <span className="text-ink-soft">— {s.author}</span>}
                      {s.approval !== "pending" && <Badge tone={s.approval === "approved" ? "success" : "danger"}>{s.approval}</Badge>}
                    </div>
                    <p className="mt-1 text-xs text-ink-soft">
                      HTTP {s.http_status ?? "—"} · {s.redirect_count} redirect(s) · {s.content_chars.toLocaleString()} chars retrieved
                    </p>
                    {s.verification_notes && <p className="mt-1 text-xs text-ink-soft">{s.verification_notes}</p>}
                    {s.approval === "pending" && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" onClick={() => decide(s.id, "approve")} disabled={s.verification_status === "failed" || s.verification_status === "inaccessible"}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => decide(s.id, "reject")}>
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>

              {approved.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={writeFromResearch} disabled={writing}>
                    {writing ? <Spinner className="h-4 w-4" /> : <BookOpenCheck className="h-4 w-4" />} Write essay from approved sources
                  </Button>
                  <Button variant="secondary" onClick={runAudit} disabled={auditing || !latestResponseId}>
                    {auditing ? <Spinner className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />} Audit citations
                  </Button>
                </div>
              )}
              {approved.length > 0 && !latestResponseId && (
                <p className="text-xs text-ink-soft">Generate or load a response first, then audit its citations.</p>
              )}
            </div>
          )}

          {audit && (
            <div className="space-y-2 rounded-lg border border-ink/10 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={audit.pass ? "success" : "warn"}>{audit.pass ? "citation audit passed" : `${audit.problems.length} problem(s)`}</Badge>
                {audit.ai_assessed && <Badge tone="neutral">semantic checks AI-assessed</Badge>}
                <Badge tone={audit.all_cited_sources_live ? "success" : "warn"}>{audit.all_cited_sources_live ? "all cited sources live" : "some cited sources no longer resolve"}</Badge>
              </div>
              {audit.problems.map((p, i) => (
                <p key={i} className="text-ink"><XCircle className="mr-1 inline h-3.5 w-3.5 text-danger" />{p}</p>
              ))}
              {audit.bibliography && (
                <details>
                  <summary className="cursor-pointer font-medium">Bibliography (generated from source records)</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words text-xs text-ink-soft">{audit.bibliography}</pre>
                </details>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
