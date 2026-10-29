#!/usr/bin/env node
// RESEARCH RANKING BENCHMARK (Prompt 4) - measurement only, no logic change.
const { rankCandidatesForAssignment } = await import("../tests-dist/src/lib/research/authority.js");
const hit = (t, u) => ({ title: t, url: u, snippet: "synthetic snippet" });
const cases = [
  { id: "history-primary", spec: { topic: "New Deal", sourceType: "any" },
    hits: [hit("Blog take", "https://medium.com/p/1"), hit("FDR Library archive", "https://www.fdrlibrary.org/new-deal"),
           hit("JSTOR article", "https://www.jstor.org/stable/123"), hit("News recap", "https://www.cnn.com/x")] },
  { id: "teacher-primary-sources", spec: { topic: "Cold War", sourceType: "primary sources" },
    hits: [hit("Textbook chapter", "https://openstax.org/books/history"), hit("Truman Library memo", "https://www.trumanlibrary.gov/memo-1947"),
           hit("Encyclopedia", "https://www.britannica.com/cold-war")] },
  { id: "science", spec: { topic: "photosynthesis", sourceType: "peer-reviewed" },
    hits: [hit("Forum post", "https://reddit.com/r/bio"), hit("Nature paper", "https://www.nature.com/articles/s41586"),
           hit("Wikipedia", "https://en.wikipedia.org/wiki/Photosynthesis")] },
];
const rows = [];
for (const c of cases) {
  const r = rankCandidatesForAssignment(c.hits, c.spec);
  rows.push({ case: c.id, order: r.map((x) => new URL(x.hit.url).hostname.replace(/^www\./, "")).join(" > "),
    topTier: r[0]?.decision?.tier ?? null, why: String(r[0]?.decision?.reasons?.[0] ?? "").slice(0, 48) });
}
console.table(rows);
