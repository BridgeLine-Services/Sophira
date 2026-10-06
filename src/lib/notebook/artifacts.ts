/**
 * Notebook workspace — artifact generation (2026-10-06).
 *
 * DETERMINISTIC generators, like the existing bibliography system: the
 * artifact content is built FROM THE STORED SOURCES (titles, key passages,
 * evidence records), never invented. Every generated artifact retains
 * source provenance: each section lists the source labels it draws from,
 * and the artifact's provenance block names every source + locator.
 */

import type { ArtifactType, GeneratedArtifact, NotebookSource } from "./types";
import { formatCitation, type CitationSource } from "../research/citation";
import { resolveLocator } from "./grounding";

export interface EvidenceRow {
  sourceId: string;
  quote: string;
  charsStart?: number | null;
  charsEnd?: number | null;
  label: "SOURCE-SUPPORTED" | "INFERENCE" | "NOT VERIFIED";
}

export interface ArtifactRequest {
  type: ArtifactType;
  topic: string;
  sources: NotebookSource[];
  evidence: EvidenceRow[];
  citationStyle?: string;
}

export function buildArtifact(req: ArtifactRequest): GeneratedArtifact {
  const usable = req.sources.filter((s) => s.included && s.extractedText);
  const sourced = usable.length > 0;
  const provenance = usable.map((s) => ({
    sourceLabel: s.sourceId,
    title: s.title,
    locator: s.sourceType === "web_url" ? s.canonicalUrl || s.originalUrl : s.sourceId,
  }));
  const honestNote = sourced
    ? `Built from ${usable.length} included notebook source(s); every section lists the sources it draws from.`
    : "No included sources in this notebook — this skeleton is unsourced and every section is marked accordingly. Add sources first.";

  const srcLabels = (n: number) => usable.slice(0, n).map((s) => s.sourceId);

  switch (req.type) {
    case "bibliography":
      return {
        type: "bibliography",
        title: `Bibliography — ${req.topic}`,
        sections: [
          {
            heading: "Works cited",
            items: usable.map((s) => {
              const cit = sourceToCitation(s);
              return formatCitation(cit, req.citationStyle);
            }),
            sources: usable.map((s) => s.sourceId),
            citations: usable.map((s) => `[${s.sourceId}]`),
          },
        ],
        provenance,
        honestNote: "Deterministic formatting of stored source metadata — the model never invents bibliography entries." + (sourced ? "" : " EMPTY: no included sources."),
      };

    case "evidence_table": {
      return {
        type: "evidence_table",
        title: `Evidence table — ${req.topic}`,
        sections: [
          {
            heading: "Claim → evidence → source → status",
            items: req.evidence.map(
              (e) =>
                `${e.label} | ${e.sourceId} | ${e.quote.slice(0, 140)}${e.quote.length > 140 ? "…" : ""}` +
                (typeof e.charsStart === "number" ? ` (chars ${e.charsStart}–${e.charsEnd ?? "?"})` : "")
            ),
            sources: Array.from(new Set(req.evidence.map((e) => e.sourceId))),
            citations: req.evidence.map((e) => `[${e.sourceId}]`),
          },
        ],
        provenance,
        honestNote: sourced ? "Every row carries its label and source locator; rows are stored evidence only." : honestNote,
      };
    }

    case "flashcards":
      return {
        type: "flashcards",
        title: `Flashcards — ${req.topic}`,
        sections: usable.slice(0, 12).map((s) => ({
          heading: keyPassage(s, 0) || s.title,
          items: [
            `Q: What does ${s.sourceId} (${s.title}) say about "${firstTopicWords(req.topic)}"?`,
            `A: "${keyPassage(s, 1)}" [${s.sourceId}]`,
          ],
          sources: [s.sourceId],
          citations: [`[${s.sourceId}]`],
        })),
        provenance,
        honestNote: sourced ? "Each card quotes a real stored passage as the answer side." : honestNote,
      };

    case "quiz":
      return {
        type: "quiz",
        title: `Quiz — ${req.topic}`,
        sections: usable.slice(0, 5).map((s) => ({
          heading: `Question from ${s.sourceId} — ${s.title}`,
          items: [
            `According to ${s.sourceId}, ${firstTopicWords(req.topic)} relates to: "${keyPassage(s, 0)}"`,
            `Answer with the exact wording above; cite [${s.sourceId}].`,
          ],
          sources: [s.sourceId],
          citations: [`[${s.sourceId}]`],
        })),
        provenance,
        honestNote: sourced ? "Questions are drawn from real stored passages; no invented facts." : honestNote,
      };

    case "outline":
      return {
        type: "outline",
        title: `Outline — ${req.topic}`,
        sections: usable.slice(0, 5).map((s, i) => ({
          heading: `${i + 1}. ${firstTopicWords(req.topic)} — from ${s.sourceId}`,
          items: [keyPassage(s, 0), `Supporting evidence: see [${s.sourceId}]`],
          sources: [s.sourceId],
          citations: [`[${s.sourceId}]`],
        })),
        provenance,
        honestNote: sourced ? "Outline points come from included sources, each with its citation marker." : honestNote,
      };

    case "briefing":
      return {
        type: "briefing",
        title: `Briefing — ${req.topic}`,
        sections: [
          {
            heading: "Key points from sources",
            items: usable.slice(0, 5).map((s) => `${s.sourceId} (${s.title}): ${keyPassage(s, 0)}`),
            sources: srcLabels(5),
            citations: usable.slice(0, 5).map((s) => `[${s.sourceId}]`),
          },
          {
            heading: "Source status",
            items: usable.map((s) => `${s.sourceId}: ${s.verificationStatus}, ${s.sourceType}`),
            sources: usable.map((s) => s.sourceId),
            citations: [],
          },
        ],
        provenance,
        honestNote: sourced ? "Briefing lines quote real passages with per-source markers." : honestNote,
      };

    case "study_guide":
      return {
        type: "study_guide",
        title: `Study guide — ${req.topic}`,
        sections: [
          {
            heading: "Core material (from your sources)",
            items: usable.slice(0, 6).map((s) => `${keyPassage(s, 0)} [${s.sourceId}]`),
            sources: srcLabels(6),
            citations: usable.map((s) => `[${s.sourceId}]`),
          },
          {
            heading: "Self-check",
            items: usable.slice(0, 4).map((s) => `Can you state what ${s.sourceId} says about ${firstTopicWords(req.topic)}?`),
            sources: srcLabels(4),
            citations: [],
          },
        ],
        provenance,
        honestNote: sourced ? "Guide content is quoted from stored sources with markers." : honestNote,
      };

    case "research_plan":
      return {
        type: "research_plan",
        title: `Research plan — ${req.topic}`,
        sections: [
          {
            heading: "Have (notebook sources)",
            items: usable.map((s) => `${s.sourceId} — ${s.title} (${s.sourceType}, ${s.verificationStatus})`),
            sources: usable.map((s) => s.sourceId),
            citations: [],
          },
          {
            heading: "Need (gaps — honest)",
            items: usable.length === 0
              ? ["No sources yet: run \"Research this topic\" or add your teacher/assignment instructions."]
              : ["Review the sources above for gaps against the assignment requirements; add sources via Research or upload."],
            sources: [],
            citations: [],
          },
        ],
        provenance,
        honestNote: "The plan reflects only what is actually in the notebook — gaps are stated, not filled with invention.",
      };

    case "essay_plan":
      return {
        type: "essay_plan",
        title: `Essay plan — ${req.topic}`,
        sections: usable.slice(0, 5).map((s, i) => ({
          heading: `${i + 1}. Body paragraph ${i + 1} — ${firstTopicWords(req.topic)}`,
          items: [`Claim: (state from your reading of ${s.sourceId})`, `Evidence: "${keyPassage(s, 0)}" [${s.sourceId}]`, `Analysis: (your own reasoning — will be labeled INFERENCE)`],
          sources: [s.sourceId],
          citations: [`[${s.sourceId}]`],
        })),
        provenance,
        honestNote: sourced ? "Each paragraph template carries a real quoted evidence line from its source." : honestNote,
      };
  }
}

/* ---------------- helpers ---------------- */

function keyPassage(s: NotebookSource, offset: number): string {
  const paras = s.extractedText.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 60);
  if (paras.length === 0) return s.extractedText.slice(0, 140) || "(no content)";
  return paras[Math.min(offset, paras.length - 1)].slice(0, 220);
}

function firstTopicWords(topic: string): string {
  return topic.trim().slice(0, 60) || "the topic";
}

function sourceToCitation(s: NotebookSource): CitationSource {
  return {
    title: s.title,
    author: (s.authority?.author as string | null) ?? null,
    publisher: (s.authority?.publisher as string | null) ?? null,
    publicationDate: s.whySelected?.date ?? null,
    url: s.canonicalUrl || s.originalUrl || "",
    accessedISO: s.retrievedAt ?? s.uploadedAt,
  };
}

/** Locator string for provenance display (opens the exact location). */
export function provenanceLocatorOf(s: NotebookSource): string {
  const loc = resolveLocator(s, null, null);
  if (s.sourceType === "pdf" && s.pageMetadata.length > 0) return `${s.sourceId}:p.1-${s.pageMetadata.length}`;
  if (s.sourceType === "web_url" && loc.url) return loc.url + (loc.retrievedAt ? ` (retrieved ${loc.retrievedAt.slice(0, 10)})` : "");
  if (s.sourceType === "docx" && s.sectionMetadata.length > 0) return `${s.sourceId}:${s.sectionMetadata[0].section}`;
  return s.sourceId;
}
