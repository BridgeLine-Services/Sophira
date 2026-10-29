#!/usr/bin/env node
// RESEARCH RANKING BENCHMARK (Prompt 4) - measurement only, no logic change.
const { rankCandidatesForAssignment } = await import("../tests-dist/src/lib/research/authority.js");
// REALISM (2026-10-29 correction): the first version gave every candidate the
// same 18-char snippet, so evidence_quality was 0 for all and the ranking was
// decided by thin-snippet noise. Snippets now vary in length and carry figures,
// as a real search provider returns.
const hit = (t, u, snippet) => ({ title: t, url: u, snippet });
const cases = [
  { id: "history-primary", spec: { topic: "New Deal", sourceType: "any" },
    hits: [hit("Blog take", "https://medium.com/p/1", "A personal blog post reflecting on the New Deal era with opinions and anecdotes about the 1930s and its legacy in modern politics, roughly 900 words long."), hit("FDR Library archive", "https://www.fdrlibrary.org/new-deal", "The Franklin D. Roosevelt Presidential Library holds 1933-1940 records: 12 series of correspondence, 4,500 photographs and agency reports documenting New Deal programs."),
           hit("JSTOR article", "https://www.jstor.org/stable/123", "Peer-reviewed article analysing New Deal labour policy across 3 decades, drawing on 240 archival records and reporting quantitative findings from 1935-1941."), hit("News recap", "https://www.cnn.com/x", "A 2019 news summary revisiting New Deal comparisons in contemporary debate, quoting 6 historians and citing 2 recent books on the period.")] },
  { id: "teacher-primary-sources", spec: { topic: "Cold War", sourceType: "primary sources" },
    hits: [hit("Textbook chapter", "https://openstax.org/books/history", "Open textbook chapter surveying Cold War origins in 8 sections, with maps, timelines and 14 review questions for undergraduate survey courses."), hit("Truman Library memo", "https://www.trumanlibrary.gov/memo-1947", "Scanned 1947 memorandum from the Truman Library collections, 3 pages, with transcribed text of the original National Security Council discussion."),
           hit("Encyclopedia", "https://www.britannica.com/cold-war", "Encyclopedia entry summarising the Cold War in 1,200 words with a chronology and 9 references to further reading for general audiences.")] },
  { id: "science", spec: { topic: "photosynthesis", sourceType: "peer-reviewed" },
    hits: [hit("Forum post", "https://reddit.com/r/bio", "Discussion thread where 40 commenters share study tips for photosynthesis exams, with mnemonics and 2 links to YouTube revision videos."), hit("Nature paper", "https://www.nature.com/articles/s41586", "Peer-reviewed research article reporting measurements of photosynthetic quantum yield across 6 species, with 4 figures and 38 references."),
           hit("Wikipedia", "https://en.wikipedia.org/wiki/Photosynthesis", "Encyclopedia article describing light-dependent reactions and the Calvin cycle, with 120 citations and 7 diagrams for general readers.")] },
];
const rows = [];
for (const c of cases) {
  const r = rankCandidatesForAssignment(c.hits, c.spec);
  rows.push({ case: c.id, order: r.map((x) => new URL(x.hit.url).hostname.replace(/^www\./, "")).join(" > "),
    topTier: r[0]?.decision?.tier ?? null, why: String(r[0]?.decision?.reasons?.[0] ?? "").slice(0, 48) });
}
console.table(rows);
