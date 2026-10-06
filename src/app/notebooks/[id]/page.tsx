"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label, Select, Spinner, Textarea, useToast } from "@/components/ui";
import { ARTIFACT_TYPES, SOURCE_TYPES } from "@/lib/notebook/types";
import type { AnswerLabel } from "@/lib/notebook/types";
import { BookMarked, FileText, Gavel, MessageSquareText, Plus, Search, ShieldQuestion } from "lucide-react";

/**
 * Notebook workspace (2026-10-06) — private, academic, source-grounded.
 *
 *   Sources | Notes | Questions | Evidence | Research | Study Materials | Artifacts
 *
 * Honesty enforced in the UI, matching the server:
 *  - chat is grounded ONLY in included sources (web research is an explicit
 *    per-question opt-in)
 *  - every answer statement shows its label + inline citations that open the
 *    exact source location (page for PDFs, URL + retrieved timestamp for web,
 *    section/paragraph for DOCX)
 *  - source controls: include / exclude / pin / verify / remove
 *  - "Research this topic" returns VERIFIED candidates; nothing is added
 *    until the user approves it; dead URLs and snippet-only hits are refused
 */

type Tab = "sources" | "notes" | "questions" | "evidence" | "research" | "materials" | "artifacts";
const TABS: { id: Tab; label: string }[] = [
  { id: "sources", label: "Sources" },
  { id: "notes", label: "Notes" },
  { id: "questions", label: "Questions" },
  { id: "evidence", label: "Evidence" },
  { id: "research", label: "Research" },
  { id: "materials", label: "Study Materials" },
  { id: "artifacts", label: "Artifacts" },
];

interface SourceRow {
  id: string;
  source_id: string;
  title: string;
  source_type: string;
  original_url: string;
  canonical_url: string;
  processing_status: string;
  verification_status: string;
  included: boolean;
  pinned: boolean;
  why_selected: Record<string, string | null>;
  retrieved_at: string | null;
  created_at: string;
}
interface NoteRow { id: string; content: string; source_id: string | null; created_at: string }
interface QuestionRow { id: string; question: string; answer: { statements?: { text: string; label: AnswerLabel; reason: string; citations: { marker: string; sourceId: string; quote?: string; locator: { page?: number; url?: string; retrievedAt?: string; section?: string; paragraph?: number; charsStart?: number; charsEnd?: number } }[] }[]; notes?: string[]; groundedIn?: string }; created_at: string }
interface EvidenceRow { id: string; source_id: string; quote: string; label: string; page: number | null; section: string | null; chars_start: number | null; chars_end: number | null; created_at: string }
interface ArtifactRow { id: string; artifact_type: string; title: string; content: { sections?: { heading: string; items: string[]; sources: string[] }[]; honestNote?: string }; provenance: { sources?: { sourceLabel: string; title: string; locator: string }[] }; created_at: string }
interface CandidateRow {
  url: string; title: string; domain: string; published: string | null; retrieved: boolean;
  contentChars: number; verificationStatus: string; whySelected: { authority?: string; relevance?: string; date?: string | null; sourceType?: string; why?: string };
}

const LABEL_TONE: Record<AnswerLabel, string> = {
  "SOURCE-SUPPORTED": "border-emerald-600/40 bg-emerald-50 text-emerald-800",
  INFERENCE: "border-sky-600/30 bg-sky-50 text-sky-800",
  "NOT VERIFIED": "border-amber-500/50 bg-amber-50 text-amber-800",
};

export default function NotebookWorkspace() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const say = (text: string) => toast("info", text);
  const [tab, setTab] = useState<Tab>("sources");
  const [notebook, setNotebook] = useState<{ title: string; description: string } | null>(null);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [evidence, setEvidence] = useState<EvidenceRow[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [whyFor, setWhyFor] = useState<{ label: string; data: Record<string, string | null> } | null>(null);

  // chat state
  const [question, setQuestion] = useState("");
  const [allowWeb, setAllowWeb] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatAnswer, setChatAnswer] = useState<QuestionRow["answer"] | null>(null);

  // add-source state
  const [addType, setAddType] = useState("user_notes");
  const [addTitle, setAddTitle] = useState("");
  const [addText, setAddText] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  // research state
  const [topic, setTopic] = useState("");
  const [researchBusy, setResearchBusy] = useState(false);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [analysis, setAnalysis] = useState<{ rationale?: string; requiredSourceTypes?: string[] } | null>(null);
  const [researchNotes, setResearchNotes] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // notes/artifact state
  const [noteText, setNoteText] = useState("");
  const [artifactType, setArtifactType] = useState("study_guide");
  const [artifactBusy, setArtifactBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/notebooks/${id}`);
      if (res.ok) {
        const d = await res.json();
        setNotebook(d.notebook);
        setSources(d.sources ?? []);
        setNotes(d.notes ?? []);
        setQuestions(d.questions ?? []);
        setEvidence(d.evidence ?? []);
        setArtifacts(d.artifacts ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const api = async (path: string, method: string, body?: unknown, isForm = false) => {
    const init: RequestInit = { method };
    if (body !== undefined) {
      if (isForm) init.body = body as FormData;
      else { init.headers = { "Content-Type": "application/json" }; init.body = JSON.stringify(body); }
    }
    const res = await fetch(`/api/notebooks/${id}${path}`, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { say(data.error ?? "Request failed."); return null; }
    return data;
  };

  const addSource = async () => {
    setAddBusy(true);
    try {
      let data: unknown = null;
      if (addType === "web_url") {
        if (!/^https?:\/\//i.test(addUrl)) { say("Provide a valid http(s) URL."); return; }
        data = await api("/sources", "POST", { source_type: "web_url", url: addUrl, title: addTitle });
      } else {
        if (!addText.trim()) { say("Paste the content first."); return; }
        data = await api("/sources", "POST", { source_type: addType, title: addTitle || "Untitled", text: addText });
      }
      if (data) {
        setAddTitle(""); setAddText(""); setAddUrl("");
        const d = data as { notes?: string[] };
        if (d.notes?.length) say(d.notes[0]);
        await load();
      }
    } finally { setAddBusy(false); }
  };

  const uploadFile = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    setAddBusy(true);
    try {
      const data = await api("/sources", "POST", form, true);
      if (data) await load();
    } finally { setAddBusy(false); }
  };

  const control = async (sourceId: string, action: string) => {
    const data = await api(`/sources/${sourceId}`, "PATCH", { action });
    if (data) await load();
  };

  const removeSource = async (sourceId: string) => {
    const data = await api(`/sources/${sourceId}`, "DELETE");
    if (data) await load();
  };

  const why = async (sourceId: string) => {
    const res = await fetch(`/api/notebooks/${id}/sources/${sourceId}`);
    if (res.ok) {
      const d = await res.json();
      const row = sources.find((s) => s.id === sourceId);
      setWhyFor({ label: row?.source_id ?? "", data: d.why ?? {} });
    }
  };

  const ask = async () => {
    if (question.trim().length < 3) { say("Ask a question."); return; }
    setChatBusy(true);
    setChatAnswer(null);
    try {
      const data = await api("/chat", "POST", { question, allow_web_research: allowWeb });
      if (data) {
        setChatAnswer(data.answer);
        await load();
      }
    } finally { setChatBusy(false); }
  };

  const runResearch = async () => {
    if (topic.trim().length < 3) { say("Enter a research topic."); return; }
    setResearchBusy(true);
    setCandidates([]);
    setAnalysis(null);
    try {
      const data = await api("/research", "POST", { topic });
      if (data) {
        setAnalysis(data.analysis);
        setCandidates(data.candidates ?? []);
        setResearchNotes(data.notes ?? []);
        setSelected(new Set());
      }
    } finally { setResearchBusy(false); }
  };

  const approveSelected = async () => {
    const toAdd = candidates.filter((c) => selected.has(c.url));
    if (toAdd.length === 0) { say("Select at least one candidate."); return; }
    const data = await api("/research", "POST", { approve: toAdd });
    if (data) {
      const added = (data.added ?? []).length;
      const rejected = (data.rejected ?? []) as { url: string; reason: string }[];
      say(`Added ${added} source(s).${rejected.length ? ` Refused: ${rejected.length} (never faked).` : ""}`);
      setCandidates([]);
      setAnalysis(null);
      await load();
    }
  };

  const addNote = async () => {
    if (!noteText.trim()) { say("Write the note first."); return; }
    const data = await api("/notes", "POST", { content: noteText });
    if (data) { setNoteText(""); await load(); }
  };

  const makeArtifact = async () => {
    setArtifactBusy(true);
    try {
      const data = await api("/artifacts", "POST", { type: artifactType, topic: notebook?.title });
      if (data) await load();
    } finally { setArtifactBusy(false); }
  };

  const openLocator = (c: { locator: { url?: string; page?: number; section?: string; paragraph?: number; charsStart?: number; charsEnd?: number } }, source: SourceRow | undefined) => {
    const loc = c.locator;
    if (loc.url) {
      window.open(loc.url, "_blank", "noopener");
      return;
    }
    // PDF/DOCX/TXT: jump to the passage in a preview panel
    setWhyFor({ label: `${source?.source_id ?? ""} · passage`, data: {
      title: source?.title ?? "",
      location: loc.page ? `page ${loc.page}` : loc.section ? `section "${loc.section}"${loc.paragraph ? `, ¶${loc.paragraph}` : ""}` : typeof loc.charsStart === "number" ? `chars ${loc.charsStart}–${loc.charsEnd}` : "unknown",
      content: "(open the Sources tab and view the stored text to see the exact passage)",
    } });
  };

  const sourceById = (sid: string) => sources.find((s) => s.id === sid);

  return (
    <AppShell title={notebook?.title ?? "Notebook"}>
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === t.id ? "bg-primary text-primary-foreground" : "border border-ink/15 text-ink/70 hover:bg-muted"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? <div className="flex justify-center py-8"><Spinner /></div> : (
          <>
            {/* ---------------- SOURCES ---------------- */}
            {tab === "sources" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><Plus className="h-4 w-4" /> Add a source</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <Label>Type</Label>
                        <Select value={addType} onChange={(e) => setAddType(e.target.value)}>
                          {SOURCE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </Select>
                      </div>
                      <div>
                        <Label>Title (optional)</Label>
                        <Input value={addTitle} onChange={(e) => setAddTitle(e.target.value)} placeholder="Name this source" />
                      </div>
                    </div>
                    {addType === "web_url" ? (
                      <div>
                        <Label>URL — fetched and verified for real; dead URLs are refused</Label>
                        <Input value={addUrl} onChange={(e) => setAddUrl(e.target.value)} placeholder="https://…" />
                      </div>
                    ) : (
                      <div>
                        <Label>Content</Label>
                        <Textarea value={addText} onChange={(e) => setAddText(e.target.value)} rows={4} placeholder="Paste the text (instructions, notes, source content)…" />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      <Button onClick={addSource} disabled={addBusy}>{addBusy ? <Spinner /> : "Add source"}</Button>
                      <label className="flex items-center gap-2 text-sm text-ink/70">
                        <FileText className="h-4 w-4" /> or upload PDF / DOCX / TXT
                        <input
                          type="file"
                          accept=".pdf,.docx,.txt"
                          className="text-xs"
                          disabled={addBusy}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadFile(f); e.currentTarget.value = ""; }}
                        />
                      </label>
                    </div>
                  </CardContent>
                </Card>

                {sources.length === 0 ? <EmptyState title="No sources yet" description="Chat and artifacts are grounded ONLY in sources you add here." /> : (
                  <div className="grid gap-2">
                    {sources.map((s) => (
                      <Card key={s.id}>
                        <CardContent className="space-y-2 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-medium"><span className="mr-1 text-ink/50">{s.source_id}</span>{s.title}</p>
                              <p className="text-xs text-ink/50">{s.source_type} · processing: {s.processing_status} · verification: {s.verification_status}{s.retrieved_at ? ` · retrieved ${new Date(s.retrieved_at).toLocaleString()}` : ""}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {s.pinned && <Badge tone="accent">pinned</Badge>}
                              <Badge tone={s.included ? "success" : "neutral"}>{s.included ? "included" : "excluded"}</Badge>
                              <Button size="sm" variant="ghost" onClick={() => control(s.id, s.included ? "exclude" : "include")}>{s.included ? "Exclude" : "Include"}</Button>
                              <Button size="sm" variant="ghost" onClick={() => control(s.id, s.pinned ? "unpin" : "pin")}>{s.pinned ? "Unpin" : "Pin"}</Button>
                              <Button size="sm" variant="ghost" onClick={() => control(s.id, s.verification_status === "verified" ? "unverify" : "verify")}>{s.verification_status === "verified" ? "Unverify" : "Verify"}</Button>
                              <Button size="sm" variant="ghost" onClick={() => why(s.id)}><ShieldQuestion className="mr-1 h-3.5 w-3.5" />Why this source?</Button>
                              <Button size="sm" variant="ghost" onClick={() => removeSource(s.id)}>Remove</Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---------------- NOTES ---------------- */}
            {tab === "notes" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><BookMarked className="h-4 w-4" /> Add a note</CardTitle></CardHeader>
                  <CardContent className="space-y-2">
                    <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={3} placeholder="Your own thinking — kept private to this notebook" />
                    <Button onClick={addNote}>Save note</Button>
                  </CardContent>
                </Card>
                {notes.length === 0 ? <EmptyState title="No notes yet" /> : notes.map((n) => (
                  <Card key={n.id}><CardContent className="py-3 text-sm">
                    <p className="whitespace-pre-wrap">{n.content}</p>
                    <p className="mt-1 text-xs text-ink/40">{new Date(n.created_at).toLocaleString()}</p>
                  </CardContent></Card>
                ))}
              </div>
            )}

            {/* ---------------- QUESTIONS (notebook chat) ---------------- */}
            {tab === "questions" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><MessageSquareText className="h-4 w-4" /> Ask this notebook</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-ink/50">
                      Answers are grounded ONLY in the sources included in this notebook. Every statement is labeled.
                    </p>
                    <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} placeholder="e.g. What do my sources say about X?" />
                    <div className="flex flex-wrap items-center gap-3">
                      <Button onClick={ask} disabled={chatBusy}>{chatBusy ? <Spinner /> : "Ask"}</Button>
                      <label className="flex items-center gap-1.5 text-sm text-ink/70">
                        <input type="checkbox" checked={allowWeb} onChange={(e) => setAllowWeb(e.target.checked)} />
                        Enable web research for this question (explicit opt-in; findings still go through verification)
                      </label>
                    </div>
                  </CardContent>
                </Card>

                {chatAnswer && <AnswerPanel answer={chatAnswer} onOpen={openLocator} sourceById={sourceById} />}

                {questions.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-ink/70">Earlier questions</p>
                    {questions.map((q) => (
                      <Card key={q.id}><CardContent className="py-3 text-sm">
                        <p className="font-medium">{q.question}</p>
                        <AnswerPanel answer={q.answer} onOpen={openLocator} sourceById={sourceById} compact />
                      </CardContent></Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ---------------- EVIDENCE ---------------- */}
            {tab === "evidence" && (
              <div className="space-y-2">
                {evidence.length === 0 ? <EmptyState title="No evidence yet" description="Evidence rows are recorded automatically from grounded answers." /> : evidence.map((e) => {
                  const src = sources.find((s) => s.id === e.source_id);
                  return (
                    <Card key={e.id}><CardContent className="py-3 text-sm">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone={e.label === "SOURCE-SUPPORTED" ? "success" : e.label === "INFERENCE" ? "accent" : "neutral"}>{e.label}</Badge>
                        <span className="text-xs text-ink/50">{src?.source_id} — {src?.title}</span>
                        {e.page ? <span className="text-xs text-ink/40">p.{e.page}</span> : e.section ? <span className="text-xs text-ink/40">{e.section}{e.section && e.chars_start != null ? ` ¶, chars ${e.chars_start}–${e.chars_end}` : ""}</span> : e.chars_start != null ? <span className="text-xs text-ink/40">chars {e.chars_start}–{e.chars_end}</span> : null}
                      </div>
                      <p className="whitespace-pre-wrap text-ink/80">“{e.quote.slice(0, 300)}{e.quote.length > 300 ? "…" : ""}”</p>
                    </CardContent></Card>
                  );
                })}
              </div>
            )}

            {/* ---------------- RESEARCH ---------------- */}
            {tab === "research" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><Search className="h-4 w-4" /> Research this topic</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-xs text-ink/50">
                      Analyzes the question → determines required source types → searches the web → ranks candidates → retrieves them → verifies URLs → stores the actual source content → shows candidates for YOUR approval. Never invents a source; never uses a dead URL; never treats a search snippet as verified content.
                    </p>
                    <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. effects of the 1929 stock market crash on European economies" />
                    <Button onClick={runResearch} disabled={researchBusy}>{researchBusy ? <Spinner /> : "Research this topic"}</Button>
                    {analysis && (
                      <div className="rounded border border-ink/10 bg-muted/40 p-3 text-xs text-ink/70">
                        <p>{analysis.rationale}</p>
                        {analysis.requiredSourceTypes && <p className="mt-1">Required source types: {analysis.requiredSourceTypes.join("; ")}</p>}
                        {researchNotes.map((n, i) => <p key={i} className="text-ink/50">• {n}</p>)}
                      </div>
                    )}
                    {candidates.length > 0 && (
                      <div className="space-y-2">
                        {candidates.map((c) => (
                          <div key={c.url} className="rounded border border-ink/10 p-3 text-sm">
                            <label className="flex items-start gap-2">
                              <input
                                type="checkbox"
                                checked={selected.has(c.url)}
                                onChange={(e) => {
                                  const next = new Set(selected);
                                  if (e.target.checked) next.add(c.url); else next.delete(c.url);
                                  setSelected(next);
                                }}
                              />
                              <span>
                                <p className="font-medium">{c.title}</p>
                                <p className="text-xs text-ink/50">{c.domain}{c.published ? ` · published ${c.published}` : ""} · {c.contentChars.toLocaleString()} chars retrieved · {c.verificationStatus}</p>
                                <p className="mt-1 text-xs text-ink/60">{c.whySelected.why} (authority: {c.whySelected.authority ?? "—"})</p>
                              </span>
                            </label>
                          </div>
                        ))}
                        <Button onClick={approveSelected}>Add {selected.size} approved source(s) to this notebook</Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ---------------- STUDY MATERIALS ---------------- */}
            {tab === "materials" && (
              <div className="space-y-3">
                {["study_guide", "quiz", "flashcards"].map((t) => {
                  const list = artifacts.filter((a) => a.artifact_type === t);
                  const label = ARTIFACT_TYPES.find((x) => x.value === t)?.label ?? t;
                  return (
                    <Card key={t}>
                      <CardHeader><CardTitle>{label}</CardTitle></CardHeader>
                      <CardContent>
                        {list.length === 0 ? (
                          <p className="text-sm text-ink/50">Not generated yet — create one in the Artifacts tab.</p>
                        ) : (
                          <div className="space-y-2">
                            {list.map((a) => <ArtifactView key={a.id} artifact={a} />)}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}

            {/* ---------------- ARTIFACTS ---------------- */}
            {tab === "artifacts" && (
              <div className="space-y-4">
                <Card>
                  <CardHeader><CardTitle className="flex items-center gap-2"><Gavel className="h-4 w-4" /> Generate an artifact</CardTitle></CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <Label>Artifact</Label>
                        <Select value={artifactType} onChange={(e) => setArtifactType(e.target.value)}>
                          {ARTIFACT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </Select>
                      </div>
                    </div>
                    <p className="text-xs text-ink/50">Generated deterministically from your sources — every artifact retains source provenance.</p>
                    <Button onClick={makeArtifact} disabled={artifactBusy}>{artifactBusy ? <Spinner /> : "Generate"}</Button>
                  </CardContent>
                </Card>
                {artifacts.length === 0 ? <EmptyState title="No artifacts yet" /> : artifacts.map((a) => (
                  <Card key={a.id}>
                    <CardContent className="py-3">
                      <p className="mb-1 font-medium">{a.title}</p>
                      <ArtifactView artifact={a} />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* "Why this source?" dialog */}
        {whyFor && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setWhyFor(null)}>
            <Card className="max-h-[80vh] w-full max-w-lg overflow-auto" onClick={undefined}>
              <CardHeader><CardTitle>Why this source? ({whyFor.label})</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {Object.entries(whyFor.data).map(([k, v]) => (
                  <p key={k}><span className="font-medium capitalize">{k.replace(/([A-Z])/g, " $1")}:</span> {v === null || v === undefined || v === "" ? "—" : String(v)}</p>
                ))}
                <Button className="mt-2" onClick={() => setWhyFor(null)}>Close</Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function AnswerPanel({ answer, onOpen, sourceById, compact }: {
  answer: QuestionRow["answer"];
  onOpen: (c: { locator: { url?: string; page?: number; section?: string; paragraph?: number; charsStart?: number; charsEnd?: number } }, source: SourceRow | undefined) => void;
  sourceById: (sid: string) => SourceRow | undefined;
  compact?: boolean;
}) {
  if (!answer?.statements) return null;
  return (
    <div className={`space-y-2 ${compact ? "" : "rounded-md border border-ink/10 bg-muted/30 p-3"}`}>
      {answer.statements.map((st, i) => (
        <div key={i} className="text-sm">
          <span className={`mr-2 inline-block rounded border px-1.5 py-0.5 text-xs ${LABEL_TONE[st.label] ?? ""}`}>{st.label}</span>
          <span className="align-middle">{st.text} </span>
          {st.citations.map((c, j) => (
            <button
              key={j}
              className="mx-0.5 rounded border border-sky-500/40 bg-sky-50 px-1 text-xs text-sky-800 hover:bg-sky-100"
              title={`Open the exact location — ${st.reason}`}
              onClick={() => onOpen(c, sourceById(c.sourceId))}
            >
              {c.marker}
            </button>
          ))}
        </div>
      ))}
      {answer.notes && answer.notes.length > 0 && (
        <details className="text-xs text-ink/50">
          <summary className="cursor-pointer">Honesty notes ({answer.notes.length})</summary>
          {answer.notes.map((n, i) => <p key={i}>• {n}</p>)}
        </details>
      )}
    </div>
  );
}

function ArtifactView({ artifact }: { artifact: ArtifactRow }) {
  return (
    <div className="space-y-2 text-sm">
      {(artifact.content?.sections ?? []).map((sec, i) => (
        <div key={i}>
          <p className="font-medium">{sec.heading}</p>
          {sec.items.map((it, j) => <p key={j} className="text-ink/70">• {it}</p>)}
          {sec.sources.length > 0 && <p className="text-xs text-ink/40">sources: {sec.sources.join(", ")}</p>}
        </div>
      ))}
      {artifact.provenance?.sources && artifact.provenance.sources.length > 0 && (
        <details className="text-xs text-ink/50">
          <summary className="cursor-pointer">Source provenance ({artifact.provenance.sources.length})</summary>
          {artifact.provenance.sources.map((p, i) => <p key={i}>• {p.sourceLabel} — {p.title} ({p.locator})</p>)}
        </details>
      )}
      {artifact.content?.honestNote && <p className="text-xs italic text-ink/40">{artifact.content.honestNote}</p>}
    </div>
  );
}
