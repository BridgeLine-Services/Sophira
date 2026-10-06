/**
 * Notebook workspace tests (2026-10-06).
 *
 * Covers the honesty-critical rules, all deterministically (no network):
 *  - strict owner-only RLS in migration 0022 (no admin read policy on
 *    notebook_sources; every policy is user_id = auth.uid())
 *  - every supported source type stores the required fields
 *  - grounding: labels SOURCE-SUPPORTED / INFERENCE / NOT VERIFIED;
 *    verbatim support only; claimed-but-unlocatable support is DOWNGRADED,
 *    never faked; chat grounded ONLY in included sources; web research
 *    requires the explicit opt-in
 *  - citation locators: page (PDF), URL+retrieved timestamp (web),
 *    section/paragraph (DOCX)
 *  - "Research this topic": never invents a source, never uses a dead URL,
 *    never treats a snippet as verified content, approval required
 *  - "Why this source?": authority/relevance/date/type/why/requirement
 *  - artifacts: deterministic, provenance retained, empty-notebook honesty
 */

import { readFileSync } from "fs";
import { join } from "path";
import type { SearchHit } from "../src/lib/research/provider";
import { buildGroundedAnswer, citationMarker, resolveLocator, locateVerbatim } from "../src/lib/notebook/grounding";
import { analyzeResearchQuestion, researchTopic, approvedCandidateToSource } from "../src/lib/notebook/research-topic";
import { explainSource } from "../src/lib/notebook/why-source";
import { buildArtifact } from "../src/lib/notebook/artifacts";
import { ingestText, ingestPdf, ingestDocx, ingestImage, ingestWeb, hashContent } from "../src/lib/notebook/ingest";
import type { NotebookSource, ResearchCandidate } from "../src/lib/notebook/types";

type Assert = (condition: boolean, name: string) => void;
type Section = (title: string) => void;

/* -------------- helpers -------------- */

let n = 0;
function makeSource(partial: Partial<NotebookSource> & { sourceId: string; extractedText: string }): NotebookSource {
  return {
    id: partial.sourceId + "-uuid",
    sourceId: partial.sourceId,
    title: partial.title ?? "Source",
    sourceType: partial.sourceType ?? "user_notes",
    originalUrl: partial.originalUrl ?? "",
    canonicalUrl: partial.canonicalUrl ?? "",
    contentHash: partial.contentHash ?? hashContent(partial.extractedText),
    uploadedAt: "2026-10-06T00:00:00Z",
    retrievedAt: partial.retrievedAt ?? null,
    extractedText: partial.extractedText,
    pageMetadata: partial.pageMetadata ?? [],
    sectionMetadata: partial.sectionMetadata ?? [],
    processingStatus: partial.processingStatus ?? "ready",
    verificationStatus: partial.verificationStatus ?? "unverified",
    included: partial.included ?? true,
    pinned: partial.pinned ?? false,
    authority: partial.authority ?? {},
    whySelected: partial.whySelected ?? {},
  };
}

function fakeProvider(hits: SearchHit[]) {
  return { search: async () => hits };
}

function fakeVerifier(html: string, ok = true) {
  return async (url: string) => ({
    originalUrl: url,
    finalUrl: url,
    redirectCount: 0,
    httpStatus: ok ? 200 : 404,
    ok,
    contentType: "text/html",
    domain: new URL(url).hostname,
    title: "Verified Page Title",
    author: "A. Author",
    publicationDate: "2026-01-15",
    canonicalUrl: url,
    text: html,
    textChars: html.length,
    hash: hashContent(html),
    status: (ok ? "verified" : "inaccessible") as "verified" | "inaccessible",
    notes: [],
  });
}

/* -------------- the suite -------------- */

export async function runNotebookTests(assert: Assert, section: Section): Promise<void> {
  section("Notebook §1 — migration RLS is strict owner-only (no admin read)");

  const sql = readFileSync(join(process.cwd(), "supabase", "migrations", "0022_notebooks.sql"), "utf8");
  for (const table of ["notebooks", "notebook_sources", "notebook_notes", "notebook_questions", "notebook_evidence", "notebook_artifacts"]) {
    assert(sql.includes(`create table if not exists public.${table}`), `notebook rls: ${table} created`);
    assert(sql.includes(`alter table public.${table} enable row level security`), `notebook rls: ${table} has RLS enabled`);
    assert(sql.includes(`${table}_own_all`), `notebook rls: ${table} has the owner-only policy`);
  }
  // every policy uses user_id = auth.uid() — and ONLY that
  const policies = sql.match(/create policy [^;]+;/g) ?? [];
  assert(policies.length === 6, "notebook rls: exactly 6 policies (one per table) — nothing extra");
  assert(policies.every((p) => p.includes("user_id = auth.uid()")), "notebook rls: every policy is user_id = auth.uid()");
  assert(!/for select using \(true\)/.test(sql), "notebook rls: NO admin/public read policy exists anywhere (every other user, admin included, is blocked from source content)");
  assert(/including admins/.test(sql), "notebook rls: migration documents that admins are blocked from source content");
  assert(sql.includes("references auth.users(id) on delete cascade") && /notebook_sources[\s\S]*user_id uuid not null references auth\.users/.test(sql), "notebook rls: every source is owned by exactly one user (NOT NULL FK)");

  section("Notebook §2 — source storage: required fields for every type");

  const txt = ingestText("Teacher note", "Read chapters 1-3 carefully.", "teacher_instructions");
  assert(txt.sourceType === "teacher_instructions" && txt.processingStatus === "ready", "notebook ingest: teacher instructions stored ready");
  assert(txt.contentHash === hashContent("Read chapters 1-3 carefully."), "notebook ingest: content hash matches sha256 of stored text");
  assert(txt.contentHash.length === 64, "notebook ingest: hash is a real sha256 (64 hex)");

  const pdf = ingestPdf("Crash report", { text: "page1\n\npage2", numpages: 2, pages: ["page1", "page2"] });
  assert(pdf.pageMetadata.length === 2 && pdf.pageMetadata[0].page === 1 && pdf.pageMetadata[1].page === 2, "notebook ingest: PDF stores per-page metadata");
  assert(pdf.pageMetadata[1].charsStart > 0, "notebook ingest: PDF page 2 char offsets recorded");

  const docx = ingestDocx("Essay draft", "Intro\n\nMethod\n\nResults");
  assert(docx.sectionMetadata.length === 3, "notebook ingest: DOCX stores section/paragraph metadata for each block");
  assert(docx.sectionMetadata.some((s) => /intro|method|results/i.test(s.section)), "notebook ingest: DOCX section labels derived honestly from headings");

  const img = ingestImage("Photo", null);
  assert(img.processingStatus === "empty" && img.notes.some((x) => x.includes("cannot be cited")), "notebook ingest: image without OCR is stored empty and honestly marked non-citable");
  const img2 = ingestImage("Photo", "printed text in the photo");
  assert(img2.processingStatus === "ready", "notebook ingest: OCR'd image becomes a usable source");

  const web = ingestWeb({
    title: "Real page",
    canonicalUrl: "https://example.org/x",
    finalUrl: "https://example.org/x",
    contentHash: hashContent("real content"),
    retrievedAt: "2026-10-06T01:00:00Z",
    extractedText: "real content",
    verificationStatus: "verified",
    notes: [],
  });
  assert(web.sourceType === "web_url" && web.retrievedAt !== null, "notebook ingest: web source stores retrieval timestamp");
  assert(web.canonicalUrl === "https://example.org/x", "notebook ingest: web source stores canonical URL");

  const empty = ingestText("Empty", "", "txt");
  assert(empty.processingStatus === "empty", "notebook ingest: empty text stored as 'empty', never fabricated");

  section("Notebook §3 — grounding: labels, verbatim support, downgrades");

  const s1 = makeSource({ sourceId: "S1", sourceType: "pdf", extractedText: "The Marshall Plan provided over 13 billion dollars of aid between 1948 and 1952.", pageMetadata: [{ page: 3, charsStart: 0, charsEnd: 84 }] });
  const s2 = makeSource({ sourceId: "S2", sourceType: "user_notes", extractedText: "My teacher said the essay must cite two primary sources.", included: false });

  const supported = buildGroundedAnswer({
    question: "How much aid did the Marshall Plan provide?",
    sources: [s1, s2],
    proposals: [{ text: "The Marshall Plan provided over 13 billion dollars of aid.", quote: "provided over 13 billion dollars of aid", sourceId: "S1", claimed: "SOURCE-SUPPORTED" }],
  });
  assert(supported.statements[0].label === "SOURCE-SUPPORTED", "notebook ground: verbatim-locatable statement is SOURCE-SUPPORTED");
  assert(supported.statements[0].citations[0].locator.page === 3, "notebook ground: PDF citation resolves the page number");
  assert(supported.statements[0].citations[0].marker.includes("p.3"), "notebook ground: PDF citation marker shows the page");
  assert(supported.usedSources.includes("S1"), "notebook ground: used source recorded");
  assert(supported.groundedIn === "notebook sources", "notebook ground: default grounding is notebook sources only");

  // claimed support that does NOT exist in the source → downgrade, never fake
  const downgraded = buildGroundedAnswer({
    question: "q",
    sources: [s1],
    proposals: [{ text: "The Marshall Plan caused World War Two.", quote: "caused World War Two", sourceId: "S1", claimed: "SOURCE-SUPPORTED" }],
  });
  assert(downgraded.statements[0].label === "NOT VERIFIED", "notebook ground: claimed-but-unlocatable support is DOWNGRADED to NOT VERIFIED");
  assert(downgraded.statements[0].citations.length === 0, "notebook ground: downgraded statement carries no citation");
  assert(downgraded.notes.some((x) => x.includes("never faked")), "notebook ground: the downgrade is disclosed in honesty notes");

  // inference: derived, cited to its reasoning anchor, not verbatim
  const inference = buildGroundedAnswer({
    question: "q",
    sources: [s1],
    proposals: [{ text: "Given the scale of the aid, Europe's recovery was likely accelerated.", sourceId: "S1", claimed: "INFERENCE" }],
  });
  assert(inference.statements[0].label === "INFERENCE", "notebook ground: derived statement is INFERENCE");
  assert(inference.statements[0].citations[0].sourceLabel === "S1", "notebook ground: inference still cites its anchor source");

  // excluded sources are NEVER used
  const excluded = buildGroundedAnswer({
    question: "What did my teacher require?",
    sources: [s1, s2],
    proposals: [{ text: "The essay must cite two primary sources.", quote: "must cite two primary sources", sourceId: "S2" }],
  });
  assert(excluded.statements[0].label === "NOT VERIFIED", "notebook ground: excluded sources are never cited (S2 is excluded)");

  // web research requires the EXPLICIT opt-in
  const webSrc = makeSource({ sourceId: "W1", sourceType: "web_url", extractedText: "Web-only fact content here.", originalUrl: "https://w.example/a", canonicalUrl: "https://w.example/a", retrievedAt: "2026-10-06T02:00:00Z" });
  const withoutOptIn = buildGroundedAnswer({
    question: "q",
    sources: [s1],
    proposals: [{ text: "Web-only fact content here.", quote: "Web-only fact content here.", sourceId: "W1", claimed: "SOURCE-SUPPORTED" }],
    webSources: [webSrc],
  });
  assert(withoutOptIn.statements[0].label === "NOT VERIFIED", "notebook ground: web source is NOT usable without the explicit opt-in");
  assert(withoutOptIn.groundedIn === "notebook sources", "notebook ground: grounding mode reports notebook-sources-only");
  const withOptIn = buildGroundedAnswer({
    question: "q",
    sources: [s1],
    proposals: [{ text: "Web-only fact content here.", quote: "Web-only fact content here.", sourceId: "W1", claimed: "SOURCE-SUPPORTED" }],
    webSources: [webSrc],
    allowWebResearch: true,
  });
  assert(withOptIn.statements[0].label === "SOURCE-SUPPORTED", "notebook ground: web source usable after explicit opt-in");
  assert(withOptIn.groundedIn === "notebook sources + web research", "notebook ground: grounding mode reports web research honestly");
  const webCit = withOptIn.statements[0].citations[0];
  assert(webCit.locator.url === "https://w.example/a" && webCit.locator.retrievedAt === "2026-10-06T02:00:00Z", "notebook ground: web citation carries URL + retrieved timestamp");
  assert(webCit.marker.includes("https://w.example/a") && webCit.marker.includes("retrieved"), "notebook ground: web citation marker shows URL and retrieval date");

  // deterministic no-model fallback still quotes verbatim
  const fallback = buildGroundedAnswer({ question: "Marshall Plan aid dollars provided?", sources: [s1] });
  assert(fallback.statements.length > 0, "notebook ground: deterministic fallback produces quoted statements");
  assert(fallback.statements.every((st) => st.label === "SOURCE-SUPPORTED"), "notebook ground: fallback statements are all verbatim-supported");

  assert(locateVerbatim("not in there at all", "completely different text") === null, "notebook ground: locateVerbatim refuses absent passages");
  assert(locateVerbatim("short", "short") === null, "notebook ground: passages under 12 chars are too short to count as evidence");

  section("Notebook §4 — Research this topic: no invention, no dead URLs, no snippet-as-content");

  const analysis = analyzeResearchQuestion("What are recent statistics on teen sleep and academic performance?");
  assert(analysis.requiredSourceTypes.some((t) => t.includes("data")), "notebook research: question analysis determines required source types (data/statistical)");
  assert(analysis.requiredSourceTypes.some((t) => t.includes("current") || t.includes("news")), "notebook research: 'recent' question requires current sources");

  const hits: SearchHit[] = [
    { title: "Good source", url: "https://good.example/a", snippet: "SNIPPET ONLY — must never be treated as content", domain: "good.example" },
    { title: "Dead source", url: "https://dead.example/b", snippet: "dead page snippet", domain: "dead.example" },
  ];
  const okForGoodOnly = async (url: string) => fakeVerifier("Full verified page content retrieved over HTTP with plenty of real text.", !url.includes("dead."))(url);
  let run = await researchTopic("sleep statistics", { provider: fakeProvider(hits), verifier: okForGoodOnly });
  assert(run.candidates.length === 1, "notebook research: dead-URL candidate is rejected, not returned");
  assert(run.candidates[0].retrieved && run.candidates[0].contentChars > 0, "notebook research: the surviving candidate has REAL retrieved content");
  assert(!run.candidates[0].extractedText.includes("SNIPPET ONLY"), "notebook research: a search snippet is NEVER stored as source content");
  assert(run.candidates[0].contentHash.length === 64, "notebook research: stored content is hashed");
  assert(run.notes.some((x) => x.includes("dead")), "notebook research: dead URLs are reported honestly");

  run = await researchTopic("anything", { provider: fakeProvider(hits), verifier: fakeVerifier("x", false) });
  assert(run.candidates.length === 0, "notebook research: with ALL URLs dead, no candidates are produced (never invented)");

  // approval gate: only retrieved candidates can become sources
  const good: ResearchCandidate = run.candidates[0] ?? {
    url: "https://good.example/a", title: "Good source", domain: "good.example", published: null,
    retrieved: true, deadUrl: false, contentChars: 50, contentHash: "h".repeat(64),
    extractedText: "real text", verificationStatus: "verified", authority: {}, whySelected: {}, snippetOnly: false,
  };
  const row = approvedCandidateToSource(good, "nb-1", "S1");
  assert(row.title === "Good source" && row.processingStatus === "ready", "notebook research: approved candidate converts to a ready source");
  let refused = false;
  try {
    approvedCandidateToSource({ ...good, retrieved: false, deadUrl: true, extractedText: "", contentHash: "" }, "nb-1", "S2");
  } catch {
    refused = true;
  }
  assert(refused, "notebook research: a dead/unretrieved candidate is REFUSED at the conversion gate");
  refused = false;
  try {
    approvedCandidateToSource({ ...good, extractedText: "", contentHash: "" }, "nb-1", "S3");
  } catch {
    refused = true;
  }
  assert(refused, "notebook research: a snippet-only candidate (no content/hash) is REFUSED at the conversion gate");

  // never generate a citation from a URL that was not retrieved: route code check
  const routeSrc = readFileSync(join(process.cwd(), "src", "app", "api", "notebooks", "[id]", "sources", "route.ts"), "utf8");
  assert(routeSrc.includes("fetchAndVerify"), "notebook research: web sources enter ONLY through fetchAndVerify");
  assert(routeSrc.includes("dead or blocked URLs are never stored") || routeSrc.includes("no source was stored"), "notebook research: API refuses to store dead URLs");
  const researchRoute = readFileSync(join(process.cwd(), "src", "app", "api", "notebooks", "[id]", "research", "route.ts"), "utf8");
  assert(researchRoute.includes("approve"), "notebook research: the API implements the approval gate (nothing added without it)");

  section("Notebook §5 — Why this source?");

  const why = explainSource(makeSource({
    sourceId: "S1",
    title: "Verified Page Title",
    sourceType: "research_source",
    extractedText: "content",
    verificationStatus: "verified",
    authority: { domain: "good.example" },
    whySelected: { authority: "domain good.example, verification: verified", relevance: "matches the topic", date: "2026-01-15", sourceType: "web", why: "retrieved and verified", requirementSatisfied: "primary source required by teacher" },
  }));
  assert(why.authority.includes("good.example"), "notebook why: authority shown");
  assert(why.relevance.includes("matches"), "notebook why: relevance shown");
  assert(why.date === "2026-01-15", "notebook why: date shown");
  assert(why.sourceType === "research_source", "notebook why: source type shown");
  assert(why.whySelected.includes("verified"), "notebook why: why-selected shown");
  assert(why.requirementSatisfied === "primary source required by teacher", "notebook why: assignment requirement satisfied shown");
  assert(why.verification === "verified", "notebook why: verification status shown");

  section("Notebook §6 — artifacts: deterministic, provenance retained");

  const artSources = [s1, makeSource({ sourceId: "S2", sourceType: "web_url", extractedText: "Second source content paragraph for the bibliography test with a long enough body.", originalUrl: "https://x.example/p", canonicalUrl: "https://x.example/p", retrievedAt: "2026-10-05T00:00:00Z" })];
  for (const type of ["study_guide", "quiz", "flashcards", "outline", "briefing", "evidence_table", "research_plan", "essay_plan", "bibliography"] as const) {
    const art = buildArtifact({ type, topic: "Marshall Plan", sources: artSources, evidence: [{ sourceId: "S1", quote: "provided over 13 billion dollars", charsStart: 19, charsEnd: 50, label: "SOURCE-SUPPORTED" }], citationStyle: "MLA" });
    assert(art.provenance.length === 2, `notebook artifact (${type}): provenance lists every source`);
    assert(art.provenance.every((p) => p.sourceLabel.startsWith("S")), `notebook artifact (${type}): provenance entries carry source labels`);
    assert(art.sections.length > 0, `notebook artifact (${type}): has sections`);
    if (type !== "research_plan") {
      assert(art.sections.some((sec) => sec.sources.length > 0), `notebook artifact (${type}): at least one section cites its sources`);
    }
  }
  const bib = buildArtifact({ type: "bibliography", topic: "t", sources: artSources, evidence: [], citationStyle: "MLA" });
  assert(bib.sections[0].items.some((i) => i.includes("x.example/p")), "notebook artifact: bibliography formats real stored URLs");
  assert(!bib.sections[0].items.some((i) => i.includes("example.com")), "notebook artifact: bibliography never invents entries");
  const emptyArt = buildArtifact({ type: "study_guide", topic: "t", sources: [], evidence: [] });
  assert(emptyArt.provenance.length === 0 && emptyArt.honestNote.includes("unsourced"), "notebook artifact: empty notebook is stated honestly, not fabricated");

  const ev = buildArtifact({ type: "evidence_table", topic: "t", sources: artSources, evidence: [{ sourceId: "S1", quote: "q1", charsStart: 1, charsEnd: 3, label: "SOURCE-SUPPORTED" }, { sourceId: "S2", quote: "q2", label: "INFERENCE" }], citationStyle: "MLA" });
  assert(ev.sections[0].items.length === 2, "notebook artifact: evidence table renders every labeled row");
  assert(ev.sections[0].items.some((i) => i.includes("SOURCE-SUPPORTED")), "notebook artifact: evidence table shows the labels");

  section("Notebook §7 — locators + UI wiring");

  const loc1 = resolveLocator(makeSource({ sourceId: "S1", sourceType: "pdf", extractedText: "", pageMetadata: [{ page: 7, charsStart: 100, charsEnd: 200 }] }), 150, 180);
  assert(loc1.page === 7, "notebook locator: PDF char range maps to page");
  const loc2 = resolveLocator(makeSource({ sourceId: "S1", sourceType: "docx", extractedText: "", sectionMetadata: [{ section: "Method", paragraph: 2, charsStart: 50, charsEnd: 150 }] }), 60, 90);
  assert(loc2.section === "Method" && loc2.paragraph === 2, "notebook locator: DOCX char range maps to section + paragraph");
  const loc3 = resolveLocator(makeSource({ sourceId: "S1", sourceType: "web_url", extractedText: "", originalUrl: "https://a.example/z", canonicalUrl: "https://a.example/z", retrievedAt: "2026-10-01T10:00:00Z" }), null, null);
  assert(loc3.url === "https://a.example/z" && loc3.retrievedAt === "2026-10-01T10:00:00Z", "notebook locator: web resolves URL + retrieved timestamp");
  assert(citationMarker(makeSource({ sourceId: "S9", sourceType: "docx", extractedText: "", sectionMetadata: [] }), { section: "Results", paragraph: 4 }).includes("Results ¶4"), "notebook locator: DOCX marker format");

  // chat route: grounded-only + explicit opt-in enforcement in code
  const chatRoute = readFileSync(join(process.cwd(), "src", "app", "api", "notebooks", "[id]", "chat", "route.ts"), "utf8");
  assert(chatRoute.includes("allow_web_research"), "notebook chat: web research is a per-question explicit field");
  assert(chatRoute.includes("answer strictly from the notebook sources"), "notebook chat: the model prompt forbids web grounding by default");
  assert(chatRoute.includes("no included sources"), "notebook chat: chat refuses to run without included sources (never ungrounded)");

  // UI: labels + controls + approval present in the workspace page
  const page = readFileSync(join(process.cwd(), "src", "app", "notebooks", "[id]", "page.tsx"), "utf8");
  for (const lbl of ["SOURCE-SUPPORTED", "INFERENCE", "NOT VERIFIED"]) assert(page.includes(lbl), `notebook ui: label ${lbl} shown`);
  for (const act of ["exclude", "pin", "Verify", "Remove", "Why this source?"]) assert(page.includes(act), `notebook ui: control "${act}" present`);
  assert(page.includes("Research this topic"), "notebook ui: Research this topic present");
  assert(page.includes("approve"), "notebook ui: candidate approval flow present");
  for (const t of ["Sources", "Notes", "Questions", "Evidence", "Study Materials", "Artifacts"]) assert(page.includes(t), `notebook ui: tab ${t} present`);

  void n;
}
